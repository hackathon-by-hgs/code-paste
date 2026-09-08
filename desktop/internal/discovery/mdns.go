package discovery

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"strings"
	"sync"
	"time"
)

// mDNS / DNS-SD discovery on the local link.
//
// Announces this agent as an instance of _codepaste._tcp.local and browses for
// others, answering PTR queries so discovery is mutual.
//
// The advertised fingerprint is a CLAIM, nothing more. A hostile device on the
// LAN can advertise any fingerprint it likes, so it only ever narrows which
// candidates are worth dialling. Authorization is the roster's job and identity
// is the handshake's; neither is weakened by anything here.

const (
	serviceType = "_codepaste._tcp.local"
	mdnsPort    = 5353
	responseTTL = 120
	// queryInterval is shorter than announceInterval: a starting agent should
	// find existing peers quickly, while steady-state LAN chatter stays low.
	queryInterval    = 5 * time.Second
	announceInterval = 30 * time.Second
)

var mdnsGroup = netip.AddrPortFrom(netip.MustParseAddr("224.0.0.251"), mdnsPort)

// link is one network interface we speak mDNS on.
//
// Every multicast-capable interface gets its own pair of sockets, because a
// machine with a VPN client, a hypervisor or WSL installed has several — and
// letting the system choose picks the wrong one. On this machine that was the
// difference between working discovery and silence: the default interface was a
// VPN adapter with no peers on it, while the real LAN sat on Wi-Fi.
type link struct {
	iface net.Interface
	addr  netip.Addr
	// recv is joined to the multicast group.
	recv *net.UDPConn
	// send is separate because Go's ListenMulticastUDP disables
	// IP_MULTICAST_LOOP, so packets sent from it never reach other sockets on
	// this host. Binding send to the interface address also pins the outgoing
	// route, rather than leaving it to the system.
	send *net.UDPConn
}

// MDNS announces this device and browses for peers.
type MDNS struct {
	instance    string
	fingerprint string
	port        uint16

	mu    sync.Mutex
	links []*link
	open  bool
}

// NewMDNS builds a responder/browser. instance should be stable for this
// device — the device id works well.
func NewMDNS(instance string) *MDNS {
	return &MDNS{instance: sanitiseInstance(instance)}
}

// sanitiseInstance keeps the label safe for a DNS name.
func sanitiseInstance(raw string) string {
	cleaned := strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-':
			return r
		default:
			return '-'
		}
	}, raw)
	if cleaned == "" {
		cleaned = "codepaste"
	}
	if len(cleaned) > 40 {
		cleaned = cleaned[:40]
	}
	return cleaned
}

func (m *MDNS) instanceName() string { return m.instance + "." + serviceType }
func (m *MDNS) hostName() string     { return m.instance + ".local" }

// openLinks binds sockets on every usable interface. Idempotent.
func (m *MDNS) openLinks() ([]*link, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.open {
		return m.links, nil
	}
	m.open = true

	interfaces, err := net.Interfaces()
	if err != nil {
		return nil, fmt.Errorf("enumerate interfaces: %w", err)
	}

	group := &net.UDPAddr{IP: net.IPv4(224, 0, 0, 251), Port: mdnsPort}

	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 ||
			iface.Flags&net.FlagMulticast == 0 ||
			iface.Flags&net.FlagLoopback != 0 {
			continue
		}

		addr, ok := interfaceAddr(iface)
		if !ok {
			continue
		}

		recv, err := net.ListenMulticastUDP("udp4", &iface, group)
		if err != nil {
			continue // this interface cannot join; others may still work
		}
		_ = recv.SetReadBuffer(maxMessageSize)

		send, err := net.ListenUDP("udp4", &net.UDPAddr{IP: addr.AsSlice()})
		if err != nil {
			_ = recv.Close()
			continue
		}

		m.links = append(m.links, &link{iface: iface, addr: addr, recv: recv, send: send})
	}

	if len(m.links) == 0 {
		return nil, errors.New("mdns: no multicast-capable interface available")
	}
	return m.links, nil
}

// Interfaces names the interfaces mDNS is active on, for diagnostics. On a
// machine with a VPN client or a hypervisor this is worth showing: discovery
// only reaches peers on a network that appears here.
func (m *MDNS) Interfaces() []string {
	links, err := m.openLinks()
	if err != nil {
		return nil
	}
	names := make([]string, 0, len(links))
	for _, l := range links {
		names = append(names, fmt.Sprintf("%s(%s)", l.iface.Name, l.addr))
	}
	return names
}

func interfaceAddr(iface net.Interface) (netip.Addr, bool) {
	addrs, err := iface.Addrs()
	if err != nil {
		return netip.Addr{}, false
	}
	for _, raw := range addrs {
		ipNet, ok := raw.(*net.IPNet)
		if !ok {
			continue
		}
		if v4 := ipNet.IP.To4(); v4 != nil {
			if addr, ok := netip.AddrFromSlice(v4); ok {
				return addr, true
			}
		}
	}
	return netip.Addr{}, false
}

func (m *MDNS) closeAll() {
	m.mu.Lock()
	links := m.links
	m.mu.Unlock()

	for _, l := range links {
		_ = l.recv.Close()
		_ = l.send.Close()
	}
}

// Announce publishes this device until ctx ends, and answers peer queries.
func (m *MDNS) Announce(ctx context.Context, fingerprint string, port uint16) error {
	m.fingerprint = fingerprint
	m.port = port

	links, err := m.openLinks()
	if err != nil {
		return err
	}

	go func() {
		<-ctx.Done()
		m.closeAll()
	}()

	// Unsolicited on start, then periodically: a peer already listening learns
	// about us without having to ask.
	go func() {
		ticker := time.NewTicker(announceInterval)
		defer ticker.Stop()
		for {
			m.broadcastAnnouncement(links)
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()

	return nil
}

// announcementFor builds the packet for one interface. The A record carries
// that interface's address, so a peer is told where to reach us on the network
// it actually shares with us.
func (m *MDNS) announcementFor(addr netip.Addr) ([]byte, error) {
	buf := make([]byte, 12)
	// Header: response, 3 answers (PTR, SRV, TXT), 1 additional (A).
	buf[2], buf[3] = flagResponse>>8, flagResponse&0xFF
	buf[6], buf[7] = 0, 3
	buf[10], buf[11] = 0, 1

	ptr, err := encodeName(nil, m.instanceName())
	if err != nil {
		return nil, err
	}
	if buf, err = appendRecord(buf, serviceType, typePTR, responseTTL, ptr); err != nil {
		return nil, err
	}

	// SRV: priority, weight, port, target host.
	srv := make([]byte, 6)
	srv[4], srv[5] = byte(m.port>>8), byte(m.port)
	if srv, err = encodeName(srv, m.hostName()); err != nil {
		return nil, err
	}
	if buf, err = appendRecord(buf, m.instanceName(), typeSRV, responseTTL, srv); err != nil {
		return nil, err
	}

	// TXT: the claimed fingerprint. Untrusted; a hint only.
	txt := encodeTXT([]string{"fp=" + m.fingerprint})
	if buf, err = appendRecord(buf, m.instanceName(), typeTXT, responseTTL, txt); err != nil {
		return nil, err
	}

	if buf, err = appendRecord(buf, m.hostName(), typeA, responseTTL, addr.AsSlice()); err != nil {
		return nil, err
	}

	return buf, nil
}

func (m *MDNS) broadcastAnnouncement(links []*link) {
	target := net.UDPAddrFromAddrPort(mdnsGroup)
	for _, l := range links {
		packet, err := m.announcementFor(l.addr)
		if err != nil {
			continue
		}
		_, _ = l.send.WriteToUDP(packet, target)
	}
}

// Browse emits peer candidates as they are discovered.
func (m *MDNS) Browse(ctx context.Context) (<-chan Candidate, error) {
	links, err := m.openLinks()
	if err != nil {
		return nil, err
	}

	out := make(chan Candidate)

	go func() {
		query, err := encodeQuery(serviceType, typePTR)
		if err != nil {
			return
		}
		target := net.UDPAddrFromAddrPort(mdnsGroup)
		ticker := time.NewTicker(queryInterval)
		defer ticker.Stop()
		for {
			for _, l := range links {
				_, _ = l.send.WriteToUDP(query, target)
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()

	var wg sync.WaitGroup
	for _, l := range links {
		wg.Add(1)
		go func(l *link) {
			defer wg.Done()
			m.readLoop(ctx, l, links, out)
		}(l)
	}

	go func() {
		wg.Wait()
		close(out)
	}()

	return out, nil
}

func (m *MDNS) readLoop(ctx context.Context, l *link, all []*link, out chan<- Candidate) {
	buf := make([]byte, maxMessageSize)

	for {
		if ctx.Err() != nil {
			return
		}
		_ = l.recv.SetReadDeadline(time.Now().Add(2 * time.Second))
		n, src, err := l.recv.ReadFromUDP(buf)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			continue // read deadline; loop so ctx is rechecked
		}

		msg, err := decodeMessage(buf[:n])
		if err != nil {
			continue
		}

		// Answer other agents' queries so discovery works both ways.
		if !msg.response {
			for _, q := range msg.questions {
				if strings.EqualFold(strings.TrimSuffix(q.name, "."), serviceType) {
					m.broadcastAnnouncement(all)
					break
				}
			}
			continue
		}

		for _, candidate := range m.candidatesFrom(msg, src) {
			select {
			case out <- candidate:
			case <-ctx.Done():
				return
			}
		}
	}
}

// candidatesFrom pulls peers out of a response, skipping our own announcement.
func (m *MDNS) candidatesFrom(msg *message, src *net.UDPAddr) []Candidate {
	var (
		port        uint16
		fingerprint string
		addr        netip.Addr
		isOurs      bool
	)

	for _, rec := range msg.answers {
		switch rec.rtype {
		case typePTR:
			if strings.HasPrefix(rec.target, m.instance+".") {
				isOurs = true
			}
		case typeSRV:
			// Only our service type; the LAN carries plenty of other mDNS.
			if !strings.Contains(rec.name, serviceType) {
				continue
			}
			port = rec.port
		case typeA:
			addr = rec.addr
		case typeTXT:
			for _, entry := range rec.txt {
				if after, ok := strings.CutPrefix(entry, "fp="); ok {
					fingerprint = after
				}
			}
		}
	}

	if isOurs || port == 0 {
		return nil
	}

	// Prefer the advertised A record; fall back to the packet's source address,
	// which is where the peer demonstrably is.
	if !addr.IsValid() && src != nil {
		if from, ok := netip.AddrFromSlice(src.IP.To4()); ok {
			addr = from
		}
	}
	if !addr.IsValid() {
		return nil
	}

	return []Candidate{{
		KeyFingerprint: fingerprint,
		Addr:           netip.AddrPortFrom(addr, port),
	}}
}
