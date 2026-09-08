// Package discovery finds candidate peers on the local network.
//
// NOT IMPLEMENTED. Intended backend is mDNS/DNS-SD.
//
// Discovery is NOT authorization. Everything this package returns is an
// unverified claim: a hostile device on the LAN can advertise any fingerprint
// it likes. A peer becomes trustworthy only after the roster lists its
// fingerprint AND the transport handshake proves it holds the matching private
// key. Never skip either check because a device "was found on our network".
package discovery

import (
	"context"
	"errors"
	"net/netip"
)

var ErrNotImplemented = errors.New("discovery: not implemented")

// Candidate is an unverified peer advertisement.
type Candidate struct {
	// KeyFingerprint as advertised. Must be matched against the roster before
	// it means anything.
	KeyFingerprint string
	Addr           netip.AddrPort
	// DeviceID as advertised — untrusted, for logging correlation only.
	DeviceID string
}

// Discoverer announces this device and watches for others.
type Discoverer interface {
	// Announce publishes this device's fingerprint on the LAN until ctx ends.
	Announce(ctx context.Context, fingerprint string, port uint16) error

	// Browse emits candidates as they appear, closing the channel when ctx ends.
	Browse(ctx context.Context) (<-chan Candidate, error)
}

// Disabled is a no-op Discoverer for builds without a backend.
type Disabled struct{}

func (Disabled) Announce(context.Context, string, uint16) error { return ErrNotImplemented }
func (Disabled) Browse(context.Context) (<-chan Candidate, error) {
	return nil, ErrNotImplemented
}
