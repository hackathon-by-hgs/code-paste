package transport

import (
	"context"
	"crypto/ed25519"
	"fmt"
	"net"
	"sync"
	"time"

	"github.com/hackathon-by-hgs/code-paste/desktop/internal/clipboard"
	"github.com/hackathon-by-hgs/code-paste/desktop/internal/discovery"
)

// handshakeTimeout bounds how long a half-open connection can tie up a slot.
const handshakeTimeout = 10 * time.Second

// TCP is the LAN peer transport: TCP carrying station-to-station authenticated,
// AES-256-GCM encrypted frames.
//
// It deliberately knows nothing about rosters. Callers decide authorization by
// inspecting the *verified* peer key this hands them — keeping the "who is
// this" question separate from the "may they" question.
type TCP struct {
	static ed25519.PrivateKey
	port   uint16
}

func NewTCP(static ed25519.PrivateKey, port uint16) *TCP {
	return &TCP{static: static, port: port}
}

// tcpSession is one authenticated connection.
type tcpSession struct {
	conn       net.Conn
	framer     *framer
	peerStatic ed25519.PublicKey

	closeOnce sync.Once
}

func (s *tcpSession) PeerKey() ed25519.PublicKey { return s.peerStatic }

func (s *tcpSession) Send(ctx context.Context, content *clipboard.Content) error {
	if deadline, ok := ctx.Deadline(); ok {
		_ = s.conn.SetWriteDeadline(deadline)
		defer func() { _ = s.conn.SetWriteDeadline(time.Time{}) }()
	}
	encoded, err := encodeContent(content)
	if err != nil {
		return err
	}
	return s.framer.writeFrame(encoded)
}

func (s *tcpSession) Receive(ctx context.Context) (<-chan clipboard.Content, error) {
	out := make(chan clipboard.Content)

	go func() {
		defer close(out)
		for {
			frame, err := s.framer.readFrame()
			if err != nil {
				// A read error ends the session: with GCM there is no way to
				// resynchronise a stream after a bad frame.
				return
			}
			content, err := decodeContent(frame)
			if err != nil {
				return
			}
			select {
			case out <- *content:
			case <-ctx.Done():
				return
			}
		}
	}()

	// Unblock the reader when the caller goes away.
	go func() {
		<-ctx.Done()
		_ = s.Close()
	}()

	return out, nil
}

func (s *tcpSession) Close() error {
	var err error
	s.closeOnce.Do(func() { err = s.conn.Close() })
	return err
}

// Dial connects to a candidate and completes the handshake.
//
// It fails unless the peer proves possession of expectedKey — a peer that
// merely *claims* the right identity gets no further than here.
func (t *TCP) Dial(ctx context.Context, candidate discovery.Candidate, expectedKey ed25519.PublicKey) (Session, error) {
	dialer := net.Dialer{Timeout: handshakeTimeout}
	conn, err := dialer.DialContext(ctx, "tcp", candidate.Addr.String())
	if err != nil {
		return nil, fmt.Errorf("dial peer: %w", err)
	}

	_ = conn.SetDeadline(time.Now().Add(handshakeTimeout))
	result, err := dialerHandshake(conn, t.static)
	if err != nil {
		_ = conn.Close()
		return nil, err
	}
	_ = conn.SetDeadline(time.Time{})

	if !result.peerStatic.Equal(expectedKey) {
		_ = conn.Close()
		return nil, fmt.Errorf("%w: peer authenticated as a different key", ErrPeerNotAuthorized)
	}

	// The dialer encrypts with the dialer→listener key and reads the other.
	f, err := newFramer(conn, result.keys.dialerToListener, result.keys.listenerToDialer)
	if err != nil {
		_ = conn.Close()
		return nil, err
	}
	return &tcpSession{conn: conn, framer: f, peerStatic: result.peerStatic}, nil
}

// Listen accepts inbound peer connections.
//
// authorize is consulted with the peer's *verified* key, after the handshake
// proved possession. Returning false drops the connection.
func (t *TCP) Listen(ctx context.Context, authorize func(ed25519.PublicKey) bool) (<-chan Session, error) {
	var lc net.ListenConfig
	listener, err := lc.Listen(ctx, "tcp", fmt.Sprintf(":%d", t.port))
	if err != nil {
		return nil, fmt.Errorf("listen: %w", err)
	}

	sessions := make(chan Session)

	go func() {
		<-ctx.Done()
		_ = listener.Close()
	}()

	go func() {
		defer close(sessions)
		for {
			conn, err := listener.Accept()
			if err != nil {
				return // listener closed
			}
			// One slow or hostile handshake must not stall the accept loop.
			go t.serve(ctx, conn, authorize, sessions)
		}
	}()

	return sessions, nil
}

func (t *TCP) serve(ctx context.Context, conn net.Conn, authorize func(ed25519.PublicKey) bool, out chan<- Session) {
	_ = conn.SetDeadline(time.Now().Add(handshakeTimeout))
	result, err := listenerHandshake(conn, t.static)
	if err != nil {
		_ = conn.Close()
		return
	}
	_ = conn.SetDeadline(time.Time{})

	if authorize == nil || !authorize(result.peerStatic) {
		_ = conn.Close()
		return
	}

	f, err := newFramer(conn, result.keys.listenerToDialer, result.keys.dialerToListener)
	if err != nil {
		_ = conn.Close()
		return
	}

	select {
	case out <- &tcpSession{conn: conn, framer: f, peerStatic: result.peerStatic}:
	case <-ctx.Done():
		_ = conn.Close()
	}
}

// Port reports the configured listen port.
func (t *TCP) Port() uint16 { return t.port }
