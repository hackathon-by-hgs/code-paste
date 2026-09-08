package daemon

import (
	"context"
	"crypto/ed25519"
	"log/slog"
	"sync"
	"time"

	"github.com/hackathon-by-hgs/code-paste/desktop/internal/clipboard"
	"github.com/hackathon-by-hgs/code-paste/desktop/internal/controlplane"
	agentcrypto "github.com/hackathon-by-hgs/code-paste/desktop/internal/crypto"
	"github.com/hackathon-by-hgs/code-paste/desktop/internal/discovery"
	"github.com/hackathon-by-hgs/code-paste/desktop/internal/transport"
)

// dialInterval is how often we retry peers we are not currently connected to.
const dialInterval = 10 * time.Second

// syncEngine moves clipboard content between this device and its authorized
// peers.
//
// Authorization is checked in two independent places, and both are required:
//
//   - inbound: authorize() runs after the handshake has *proved* the peer's
//     key, and refuses any key not in the current roster
//   - outbound: content only goes to sessions whose peer key is still in the
//     roster at send time
//
// The second check is what makes revocation take effect on an already-open
// connection rather than only at the next reconnect.
type syncEngine struct {
	clip      clipboard.Provider
	transport transport.Transport
	discover  discovery.Discoverer
	log       *slog.Logger
	// self is this device's fingerprint, used to decide which side dials.
	self string

	mu       sync.RWMutex
	roster   *controlplane.PeerRoster
	sessions map[string]transport.Session // keyed by peer fingerprint
}

func newSyncEngine(
	clip clipboard.Provider,
	tp transport.Transport,
	disc discovery.Discoverer,
	log *slog.Logger,
	selfFingerprint string,
) *syncEngine {
	return &syncEngine{
		clip:      clip,
		transport: tp,
		discover:  disc,
		log:       log,
		self:      selfFingerprint,
		sessions:  make(map[string]transport.Session),
	}
}

// shouldDial decides which side of a pair opens the connection.
//
// Without this both agents dial each other, two sessions form between the same
// pair, and each side independently closes "the duplicate" — tearing down both
// and looping forever. Comparing fingerprints gives both ends the same answer
// with no negotiation: the lower one dials, the higher one waits.
func (s *syncEngine) shouldDial(peerFingerprint string) bool {
	return s.self < peerFingerprint
}

// setRoster installs a freshly verified roster and drops any live session whose
// peer is no longer listed.
func (s *syncEngine) setRoster(roster *controlplane.PeerRoster) {
	s.mu.Lock()
	s.roster = roster

	var dropped []transport.Session
	for fingerprint, session := range s.sessions {
		if !s.authorizedLocked(fingerprint) {
			dropped = append(dropped, session)
			delete(s.sessions, fingerprint)
		}
	}
	s.mu.Unlock()

	for _, session := range dropped {
		s.log.Info("peer no longer authorized; closing session")
		_ = session.Close()
	}
}

func (s *syncEngine) authorizedLocked(fingerprint string) bool {
	if s.roster == nil {
		return false
	}
	_, ok := controlplane.Authorizes(s.roster, fingerprint)
	return ok
}

// authorize is the inbound gate, called with a key the handshake already proved.
func (s *syncEngine) authorize(peerKey ed25519.PublicKey) bool {
	fingerprint := agentcrypto.FingerprintOf(peerKey)

	s.mu.RLock()
	ok := s.authorizedLocked(fingerprint)
	s.mu.RUnlock()

	if !ok {
		// Someone reached us and proved an identity we do not recognise.
		s.log.Warn("rejected an unauthorized peer", "fingerprint", fingerprint)
	}
	return ok
}

func (s *syncEngine) addSession(session transport.Session) {
	fingerprint := agentcrypto.FingerprintOf(session.PeerKey())

	s.mu.Lock()
	existing, duplicate := s.sessions[fingerprint]
	s.sessions[fingerprint] = session
	s.mu.Unlock()

	if duplicate {
		// Both sides dialled each other. Keep the newest and drop the old one
		// rather than sending every item twice.
		_ = existing.Close()
	}
	s.log.Info("peer connected", "fingerprint", fingerprint)
}

func (s *syncEngine) removeSession(fingerprint string, session transport.Session) {
	s.mu.Lock()
	if current, ok := s.sessions[fingerprint]; ok && current == session {
		delete(s.sessions, fingerprint)
	}
	s.mu.Unlock()

	_ = session.Close()
	s.log.Info("peer disconnected", "fingerprint", fingerprint)
}

// connectedTo reports whether a peer already has a live session.
func (s *syncEngine) connectedTo(fingerprint string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	_, ok := s.sessions[fingerprint]
	return ok
}

// authorizedSessions snapshots the sessions still listed in the roster.
func (s *syncEngine) authorizedSessions() []transport.Session {
	s.mu.RLock()
	defer s.mu.RUnlock()

	out := make([]transport.Session, 0, len(s.sessions))
	for fingerprint, session := range s.sessions {
		if s.authorizedLocked(fingerprint) {
			out = append(out, session)
		}
	}
	return out
}

// run starts every sync goroutine and blocks until ctx ends.
func (s *syncEngine) run(ctx context.Context) error {
	inbound, err := s.transport.Listen(ctx, s.authorize)
	if err != nil {
		return err
	}

	go s.acceptLoop(ctx, inbound)
	go s.dialLoop(ctx)
	go s.watchLoop(ctx)

	<-ctx.Done()
	return ctx.Err()
}

func (s *syncEngine) acceptLoop(ctx context.Context, inbound <-chan transport.Session) {
	for {
		select {
		case <-ctx.Done():
			return
		case session, ok := <-inbound:
			if !ok {
				return
			}
			s.addSession(session)
			go s.receiveFrom(ctx, session)
		}
	}
}

// dialLoop keeps trying to reach peers we are not connected to.
func (s *syncEngine) dialLoop(ctx context.Context) {
	candidates, err := s.discover.Browse(ctx)
	if err != nil {
		s.log.Warn("discovery unavailable", "error", err)
		return
	}

	// A static list delivers its candidates once, so they are remembered and
	// retried on a timer rather than consumed and forgotten.
	var known []discovery.Candidate
	ticker := time.NewTicker(dialInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return

		case candidate, ok := <-candidates:
			if !ok {
				candidates = nil
				continue
			}
			known = append(known, candidate)
			s.tryDialAll(ctx, known)

		case <-ticker.C:
			s.tryDialAll(ctx, known)
		}
	}
}

// tryDialAll attempts every roster peer we lack a session for, at every known
// address. The roster supplies the identity to expect; the address only says
// where to knock.
func (s *syncEngine) tryDialAll(ctx context.Context, candidates []discovery.Candidate) {
	s.mu.RLock()
	roster := s.roster
	s.mu.RUnlock()

	if roster == nil {
		return // no roster means nobody is authorized
	}

	for _, peer := range roster.Peers {
		if s.connectedTo(peer.KeyFingerprint) || !s.shouldDial(peer.KeyFingerprint) {
			continue
		}
		expected, err := agentcrypto.ParsePublicKey(peer.PublicKey)
		if err != nil {
			s.log.Warn("roster peer has an unparseable key", "deviceId", peer.DeviceID)
			continue
		}

		for _, candidate := range candidates {
			dialCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			session, err := s.transport.Dial(dialCtx, candidate, expected)
			cancel()
			if err != nil {
				continue // wrong peer at that address, or nothing listening
			}
			s.addSession(session)
			go s.receiveFrom(ctx, session)
			break
		}
	}
}

// receiveFrom writes inbound clipboard content to the local clipboard.
func (s *syncEngine) receiveFrom(ctx context.Context, session transport.Session) {
	fingerprint := agentcrypto.FingerprintOf(session.PeerKey())
	defer s.removeSession(fingerprint, session)

	incoming, err := session.Receive(ctx)
	if err != nil {
		return
	}

	for content := range incoming {
		// Re-checked at delivery: a peer revoked while connected must stop
		// being able to write to this clipboard immediately.
		s.mu.RLock()
		allowed := s.authorizedLocked(fingerprint)
		s.mu.RUnlock()
		if !allowed {
			return
		}

		if err := s.clip.Write(ctx, &content); err != nil {
			s.log.Warn("could not write to clipboard", "error", err)
			continue
		}
		// Size, never content: what was copied must not reach a log.
		s.log.Info("clipboard received", "bytes", len(content.Data), "from", fingerprint)
	}
}

// watchLoop broadcasts local clipboard changes to authorized peers.
func (s *syncEngine) watchLoop(ctx context.Context) {
	changes, err := s.clip.Watch(ctx)
	if err != nil {
		s.log.Error("clipboard watch unavailable; local changes will not be sent", "error", err)
		return
	}

	for content := range changes {
		sessions := s.authorizedSessions()
		if len(sessions) == 0 {
			continue
		}

		for _, session := range sessions {
			sendCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
			err := session.Send(sendCtx, &content)
			cancel()
			if err != nil {
				s.log.Warn("could not send to peer", "error", err)
			}
		}
		s.log.Info("clipboard sent", "bytes", len(content.Data), "peers", len(sessions))
	}
}
