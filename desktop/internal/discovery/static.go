package discovery

import (
	"context"
	"fmt"
	"net/netip"
	"strings"
)

// Static is a configured list of peer addresses.
//
// mDNS is the eventual mechanism, but discovery is a *convenience*: it only
// suggests where to look. Authorization comes from the roster and the transport
// handshake, both of which apply identically to a hand-configured address. So a
// static list is a legitimate configuration, not a stub — it is also what makes
// the agent usable across subnets where multicast does not reach.
type Static struct {
	addrs []netip.AddrPort
}

// ParseStatic reads a comma-separated "host:port,host:port" list.
func ParseStatic(spec string) (*Static, error) {
	var addrs []netip.AddrPort

	for _, field := range strings.Split(spec, ",") {
		field = strings.TrimSpace(field)
		if field == "" {
			continue
		}
		addr, err := netip.ParseAddrPort(field)
		if err != nil {
			return nil, fmt.Errorf("peer address %q: %w", field, err)
		}
		addrs = append(addrs, addr)
	}
	return &Static{addrs: addrs}, nil
}

// Announce is a no-op: a statically configured peer needs no advertisement.
func (s *Static) Announce(context.Context, string, uint16) error { return nil }

// Browse emits the configured addresses once, then waits for ctx.
//
// The fingerprint is empty because a configured address makes no identity
// claim at all — the handshake establishes who is actually there, and the
// roster decides whether they are allowed.
func (s *Static) Browse(ctx context.Context) (<-chan Candidate, error) {
	out := make(chan Candidate)

	go func() {
		defer close(out)
		for _, addr := range s.addrs {
			select {
			case out <- Candidate{Addr: addr}:
			case <-ctx.Done():
				return
			}
		}
		<-ctx.Done()
	}()

	return out, nil
}

// Len reports how many peers are configured.
func (s *Static) Len() int { return len(s.addrs) }
