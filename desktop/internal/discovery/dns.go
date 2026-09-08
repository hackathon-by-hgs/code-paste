package discovery

import (
	"encoding/binary"
	"errors"
	"fmt"
	"net/netip"
	"strings"
)

// A minimal DNS wire codec, enough for DNS-SD over multicast.
//
// net.Resolver cannot do this: mDNS needs raw multicast packets, PTR/SRV/TXT
// records, and the ability to both ask and answer. Only the record types
// DNS-SD uses are implemented — this is not a general DNS library.

const (
	typeA   = 1
	typePTR = 12
	typeTXT = 16
	typeSRV = 33

	classIN = 1
	// flagResponse marks a message as an answer rather than a query.
	flagResponse = 0x8400 // QR=1, AA=1

	maxMessageSize = 9000
	// maxNamePointers bounds compression-pointer following, so a packet that
	// points at itself cannot spin forever.
	maxNamePointers = 16
)

var errMalformed = errors.New("mdns: malformed message")

type record struct {
	name  string
	rtype uint16
	data  []byte
	// parsed forms, filled by decode for the types we care about
	target string
	port   uint16
	addr   netip.Addr
	txt    []string
	ttl    uint32
}

type message struct {
	id        uint16
	response  bool
	questions []question
	answers   []record
}

type question struct {
	name  string
	qtype uint16
}

// --- encoding ---------------------------------------------------------------

// encodeName writes a domain name as length-prefixed labels. Compression is not
// used: mDNS packets here are small and correctness beats a few saved bytes.
func encodeName(buf []byte, name string) ([]byte, error) {
	for _, label := range strings.Split(strings.TrimSuffix(name, "."), ".") {
		if len(label) == 0 {
			continue
		}
		if len(label) > 63 {
			return nil, fmt.Errorf("mdns: label too long: %q", label)
		}
		buf = append(buf, byte(len(label)))
		buf = append(buf, label...)
	}
	return append(buf, 0), nil
}

func encodeQuery(name string, qtype uint16) ([]byte, error) {
	buf := make([]byte, 12)
	binary.BigEndian.PutUint16(buf[0:], 0) // id 0: mDNS responses are matched on content
	binary.BigEndian.PutUint16(buf[2:], 0) // flags: standard query
	binary.BigEndian.PutUint16(buf[4:], 1) // one question

	var err error
	if buf, err = encodeName(buf, name); err != nil {
		return nil, err
	}
	buf = binary.BigEndian.AppendUint16(buf, qtype)
	buf = binary.BigEndian.AppendUint16(buf, classIN)
	return buf, nil
}

// appendRecord writes one resource record with the given RDATA.
func appendRecord(buf []byte, name string, rtype uint16, ttl uint32, rdata []byte) ([]byte, error) {
	var err error
	if buf, err = encodeName(buf, name); err != nil {
		return nil, err
	}
	buf = binary.BigEndian.AppendUint16(buf, rtype)
	buf = binary.BigEndian.AppendUint16(buf, classIN)
	buf = binary.BigEndian.AppendUint32(buf, ttl)
	buf = binary.BigEndian.AppendUint16(buf, uint16(len(rdata)))
	return append(buf, rdata...), nil
}

func encodeTXT(entries []string) []byte {
	var out []byte
	for _, entry := range entries {
		if len(entry) > 255 {
			entry = entry[:255]
		}
		out = append(out, byte(len(entry)))
		out = append(out, entry...)
	}
	if len(out) == 0 {
		out = []byte{0}
	}
	return out
}

// --- decoding ---------------------------------------------------------------

// decodeName reads a possibly-compressed name, returning it and the offset just
// past it in the *containing* record.
func decodeName(msg []byte, offset int) (string, int, error) {
	var labels []string
	pointers := 0
	next := -1

	for {
		if offset < 0 || offset >= len(msg) {
			return "", 0, errMalformed
		}
		length := int(msg[offset])

		switch {
		case length == 0:
			offset++
			if next == -1 {
				next = offset
			}
			return strings.Join(labels, "."), next, nil

		case length&0xC0 == 0xC0:
			// Compression pointer: follow it, but remember where we were.
			if offset+1 >= len(msg) {
				return "", 0, errMalformed
			}
			if pointers++; pointers > maxNamePointers {
				return "", 0, errMalformed
			}
			if next == -1 {
				next = offset + 2
			}
			offset = int(binary.BigEndian.Uint16(msg[offset:]) & 0x3FFF)

		default:
			offset++
			if offset+length > len(msg) {
				return "", 0, errMalformed
			}
			labels = append(labels, string(msg[offset:offset+length]))
			offset += length
		}
	}
}

func decodeMessage(msg []byte) (*message, error) {
	if len(msg) < 12 {
		return nil, errMalformed
	}

	out := &message{
		id:       binary.BigEndian.Uint16(msg[0:]),
		response: binary.BigEndian.Uint16(msg[2:])&0x8000 != 0,
	}
	questionCount := int(binary.BigEndian.Uint16(msg[4:]))
	// Answer, authority and additional sections are all parsed the same way, and
	// mDNS scatters SRV/TXT/A across them, so they are read as one run.
	recordCount := int(binary.BigEndian.Uint16(msg[6:])) +
		int(binary.BigEndian.Uint16(msg[8:])) +
		int(binary.BigEndian.Uint16(msg[10:]))

	offset := 12
	for range questionCount {
		name, next, err := decodeName(msg, offset)
		if err != nil {
			return nil, err
		}
		offset = next + 4 // qtype + qclass
		if offset > len(msg) {
			return nil, errMalformed
		}
		out.questions = append(out.questions, question{name: name})
	}

	for range recordCount {
		rec, next, err := decodeRecord(msg, offset)
		if err != nil {
			// A record type we cannot parse is not fatal: take what we have.
			break
		}
		offset = next
		out.answers = append(out.answers, *rec)
	}

	return out, nil
}

func decodeRecord(msg []byte, offset int) (*record, int, error) {
	name, next, err := decodeName(msg, offset)
	if err != nil {
		return nil, 0, err
	}
	if next+10 > len(msg) {
		return nil, 0, errMalformed
	}

	rec := &record{
		name:  name,
		rtype: binary.BigEndian.Uint16(msg[next:]),
		ttl:   binary.BigEndian.Uint32(msg[next+4:]),
	}
	dataLen := int(binary.BigEndian.Uint16(msg[next+8:]))
	dataStart := next + 10
	if dataStart+dataLen > len(msg) {
		return nil, 0, errMalformed
	}
	rec.data = msg[dataStart : dataStart+dataLen]
	end := dataStart + dataLen

	switch rec.rtype {
	case typePTR:
		if rec.target, _, err = decodeName(msg, dataStart); err != nil {
			return nil, 0, err
		}

	case typeSRV:
		if dataLen < 7 {
			return nil, 0, errMalformed
		}
		rec.port = binary.BigEndian.Uint16(rec.data[4:])
		if rec.target, _, err = decodeName(msg, dataStart+6); err != nil {
			return nil, 0, err
		}

	case typeA:
		if dataLen != 4 {
			return nil, 0, errMalformed
		}
		rec.addr = netip.AddrFrom4([4]byte(rec.data))

	case typeTXT:
		for i := 0; i < len(rec.data); {
			length := int(rec.data[i])
			i++
			if i+length > len(rec.data) {
				break
			}
			rec.txt = append(rec.txt, string(rec.data[i:i+length]))
			i += length
		}
	}

	return rec, end, nil
}
