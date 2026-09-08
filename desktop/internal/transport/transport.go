// Package transport is the authenticated, encrypted peer-to-peer channel that
// actually carries clipboard content.
//
// NOT IMPLEMENTED.
//
// Requirements this must satisfy (docs/RULES.md §3, ADR-001):
//   - Mutual authentication: each side proves possession of the private key
//     matching the Ed25519 public key the roster lists for it. A signature over
//     a fresh, per-connection challenge — never a replayable constant.
//   - Encrypted in transit. The LAN is not a trust boundary.
//   - No server involvement: clipboard bytes never reach the control plane.
//   - The interface must permit a future relay (RULES.md §3.5), so nothing here
//     may assume the peer is link-local.
package transport

import (
	"context"
	"crypto/ed25519"
	"errors"

	"github.com/hackathon-by-hgs/code-paste/desktop/internal/clipboard"
	"github.com/hackathon-by-hgs/code-paste/desktop/internal/discovery"
)

var (
	ErrNotImplemented    = errors.New("transport: not implemented")
	ErrHandshakeFailed   = errors.New("transport: peer failed to prove key possession")
	ErrPeerNotAuthorized = errors.New("transport: peer is not in the current roster")
)

// Session is an authenticated connection to one verified peer.
type Session interface {
	// PeerKey is the peer's static key, already proven by the handshake.
	// Match it against the roster to decide authorization.
	PeerKey() ed25519.PublicKey
	// Send delivers clipboard content to the peer.
	Send(ctx context.Context, content *clipboard.Content) error
	// Receive yields content sent by the peer until ctx ends.
	Receive(ctx context.Context) (<-chan clipboard.Content, error)
	Close() error
}

// Transport dials and accepts peer connections.
type Transport interface {
	// Dial connects to a candidate and completes the handshake. It MUST fail
	// with ErrHandshakeFailed unless the peer proves possession of expectedKey.
	Dial(ctx context.Context, candidate discovery.Candidate, expectedKey ed25519.PublicKey) (Session, error)

	// Listen accepts inbound peer connections. The authorize callback is
	// consulted with the *verified* public key of a peer that has already
	// completed the handshake; returning false must drop the connection.
	Listen(ctx context.Context, authorize func(ed25519.PublicKey) bool) (<-chan Session, error)
}

// Disabled is a no-op Transport, used when peer syncing is switched off.
type Disabled struct{}

func (Disabled) Dial(context.Context, discovery.Candidate, ed25519.PublicKey) (Session, error) {
	return nil, ErrNotImplemented
}

func (Disabled) Listen(ctx context.Context, _ func(ed25519.PublicKey) bool) (<-chan Session, error) {
	// A closed channel rather than an error: a disabled transport is a valid
	// configuration, so the daemon should idle, not fail.
	sessions := make(chan Session)
	close(sessions)
	return sessions, nil
}
