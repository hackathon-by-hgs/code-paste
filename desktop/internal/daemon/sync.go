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
	"github.com/hackathon-by-hgs/code-paste/desktop/internal/queue"
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
	// port is where this agent listens, advertised over mDNS.
	port uint16

	mu       sync.RWMutex
	roster   *controlplane.PeerRoster
	sessions map[string]transport.Session // keyed by peer fingerprint

	// pending holds items copied while no peer was connected.
	//
	// Without this a copy made during the seconds before a peer connects — or
	// during a brief reconnect — is lost silently, which reads as "sync is
	// broken" even though everything is working. Bounded and lossy on purpose:
	// a stale clipboard item is worth less than unbounded memory.
	pending *queue.Ring
}

func newSyncEngine(
	clip clipboard.Provider,
	tp transport.Transport,
	disc discovery.Discoverer,
	log *slog.Logger,
	selfFingerprint string,
	port uint16,
) *syncEngine {
	return &syncEngine{
		clip:      clip,
		transport: tp,
		discover:  disc,
		log:       log,
		self:      selfFingerprint,
		port:      port,
		sessions:  make(map[string]transport.Session),
		pending:   queue.NewRing(8),
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

	count := 0
	if roster != nil {
		count = len(roster.Peers)
	}
	s.log.Debug("sync roster updated", "peers", count)
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

// addSession adopts a connection, reporting whether it was kept.
//
// An established session always wins over a duplicate. This matters more than
// it looks: when we dial an address hunting for peer X and peer Y answers, Y
// completes a valid handshake and its listener sees an inbound connection —
// which, if it replaced the live session, would tear down a working link every
// time we probed. Keeping the incumbent makes those probes harmless. A session
// that has genuinely died is removed by its own read loop, so nothing sticks.
func (s *syncEngine) addSession(session transport.Session) bool {
	fingerprint := agentcrypto.FingerprintOf(session.PeerKey())

	s.mu.Lock()
	if _, duplicate := s.sessions[fingerprint]; duplicate {
		s.mu.Unlock()
		_ = session.Close()
		return false
	}
	s.sessions[fingerprint] = session
	s.mu.Unlock()

	s.log.Info("peer connected", "fingerprint", fingerprint)

	// Anything copied while we had nobody to send it to goes now.
	s.flushPending(session)
	return true
}

// flushPending drains the buffer to a newly connected peer.
func (s *syncEngine) flushPending(session transport.Session) {
	for {
		item, ok := s.pending.Pop()
		if !ok {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		err := session.Send(ctx, &item)
		cancel()
		if err != nil {
			s.log.Warn("could not flush a buffered item", "error", err)
			return
		}
		s.log.Info("buffered clipboard sent", "bytes", len(item.Data))
	}
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

// sessionCount is the number of live sessions, authorized or not.
func (s *syncEngine) sessionCount() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.sessions)
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

	// Advertise before browsing so a peer already listening finds us at once.
	// A failure here is not fatal: discovery is a convenience, and a configured
	// peer address still works without it.
	if err := s.discover.Announce(ctx, s.self, s.port); err != nil {
		s.log.Warn("could not announce on the local network", "error", err)
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
			if s.addSession(session) {
				go s.receiveFrom(ctx, session)
			}
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
			if s.addSession(session) {
				go s.receiveFrom(ctx, session)
			}
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
			// Buffered rather than dropped: a peer may be seconds away from
			// connecting, and losing the copy would look like a broken agent.
			s.pending.Push(content)
			s.log.Debug("clipboard buffered; no authorized peer connected",
				"bytes", len(content.Data), "queued", s.pending.Len())
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
