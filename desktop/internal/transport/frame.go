package transport

import (
	"crypto/aes"
	"crypto/cipher"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"sync"

	"github.com/hackathon-by-hgs/code-paste/desktop/internal/clipboard"
)

// Frames are length-prefixed AES-256-GCM ciphertexts.
//
// Each direction has its own key and its own counter, so a nonce is never
// reused under one key. Counters start at zero and are per-session; the keys
// come from a fresh ephemeral exchange every connection, so there is no
// cross-session nonce risk.

const (
	// maxFrameSize bounds what a peer can make us allocate. 10 MiB is the
	// largest payload the contract permits, plus room for the envelope.
	maxFrameSize = 11 << 20
	nonceSize    = 12
)

var (
	ErrFrameTooLarge = errors.New("transport: frame exceeds maximum size")
	ErrDecryptFailed = errors.New("transport: frame failed authentication")
	ErrCounterWrap   = errors.New("transport: nonce counter exhausted")
)

// framer encrypts and decrypts over one connection.
type framer struct {
	rw io.ReadWriter

	sendMu   sync.Mutex
	sendAEAD cipher.AEAD
	sendSeq  uint64

	recvMu   sync.Mutex
	recvAEAD cipher.AEAD
	recvSeq  uint64
}

func newFramer(rw io.ReadWriter, sendKey, recvKey []byte) (*framer, error) {
	send, err := newAEAD(sendKey)
	if err != nil {
		return nil, err
	}
	recv, err := newAEAD(recvKey)
	if err != nil {
		return nil, err
	}
	return &framer{rw: rw, sendAEAD: send, recvAEAD: recv}, nil
}

func newAEAD(key []byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("aes: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("gcm: %w", err)
	}
	return aead, nil
}

func nonceFor(seq uint64) []byte {
	nonce := make([]byte, nonceSize)
	binary.BigEndian.PutUint64(nonce[4:], seq)
	return nonce
}

func (f *framer) writeFrame(plaintext []byte) error {
	f.sendMu.Lock()
	defer f.sendMu.Unlock()

	if f.sendSeq == ^uint64(0) {
		return ErrCounterWrap
	}
	sealed := f.sendAEAD.Seal(nil, nonceFor(f.sendSeq), plaintext, nil)
	f.sendSeq++

	if len(sealed) > maxFrameSize {
		return ErrFrameTooLarge
	}

	var header [4]byte
	binary.BigEndian.PutUint32(header[:], uint32(len(sealed)))
	if _, err := f.rw.Write(header[:]); err != nil {
		return fmt.Errorf("write frame header: %w", err)
	}
	if _, err := f.rw.Write(sealed); err != nil {
		return fmt.Errorf("write frame: %w", err)
	}
	return nil
}

func (f *framer) readFrame() ([]byte, error) {
	f.recvMu.Lock()
	defer f.recvMu.Unlock()

	var header [4]byte
	if _, err := io.ReadFull(f.rw, header[:]); err != nil {
		return nil, err // io.EOF here means a clean close
	}

	size := binary.BigEndian.Uint32(header[:])
	// Checked before allocating: a hostile length prefix must not be able to
	// make us reserve gigabytes.
	if size > maxFrameSize {
		return nil, ErrFrameTooLarge
	}

	sealed := make([]byte, size)
	if _, err := io.ReadFull(f.rw, sealed); err != nil {
		return nil, fmt.Errorf("read frame: %w", err)
	}

	plaintext, err := f.recvAEAD.Open(nil, nonceFor(f.recvSeq), sealed, nil)
	if err != nil {
		// Either corruption or tampering; both are fatal for this connection.
		return nil, ErrDecryptFailed
	}
	f.recvSeq++
	return plaintext, nil
}

// Wire encoding of one clipboard item:
//
//	contentTypeLen (1) || contentType || payload
//
// Deliberately not JSON: clipboard payloads are arbitrary bytes, and base64ing
// them to fit a JSON string would inflate every transfer by a third.
func encodeContent(content *clipboard.Content) ([]byte, error) {
	if len(content.ContentType) > 255 {
		return nil, errors.New("transport: content type too long")
	}
	out := make([]byte, 0, 1+len(content.ContentType)+len(content.Data))
	out = append(out, byte(len(content.ContentType)))
	out = append(out, content.ContentType...)
	out = append(out, content.Data...)
	return out, nil
}

func decodeContent(frame []byte) (*clipboard.Content, error) {
	if len(frame) < 1 {
		return nil, errors.New("transport: empty frame")
	}
	typeLen := int(frame[0])
	if len(frame) < 1+typeLen {
		return nil, errors.New("transport: truncated content type")
	}
	return &clipboard.Content{
		ContentType: string(frame[1 : 1+typeLen]),
		Data:        frame[1+typeLen:],
	}, nil
}
