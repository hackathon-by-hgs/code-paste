package transport

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"io"
	"net"
	"net/netip"
	"testing"
	"time"

	"github.com/hackathon-by-hgs/code-paste/desktop/internal/clipboard"
	"github.com/hackathon-by-hgs/code-paste/desktop/internal/discovery"
)

func keypair(t *testing.T) (ed25519.PublicKey, ed25519.PrivateKey) {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	return pub, priv
}

// runHandshake drives both sides over an in-memory pipe.
func runHandshake(t *testing.T, dialerKey, listenerKey ed25519.PrivateKey) (*handshakeResult, *handshakeResult, error) {
	t.Helper()
	clientConn, serverConn := net.Pipe()
	defer clientConn.Close()
	defer serverConn.Close()

	type outcome struct {
		res *handshakeResult
		err error
	}
	listenerDone := make(chan outcome, 1)

	go func() {
		res, err := listenerHandshake(serverConn, listenerKey)
		listenerDone <- outcome{res, err}
	}()

	dialerRes, dialerErr := dialerHandshake(clientConn, dialerKey)
	got := <-listenerDone

	if dialerErr != nil {
		return nil, nil, dialerErr
	}
	if got.err != nil {
		return nil, nil, got.err
	}
	return dialerRes, got.res, nil
}

func TestHandshakeAuthenticatesBothSides(t *testing.T) {
	dialerPub, dialerPriv := keypair(t)
	listenerPub, listenerPriv := keypair(t)

	dialerRes, listenerRes, err := runHandshake(t, dialerPriv, listenerPriv)
	if err != nil {
		t.Fatalf("handshake: %v", err)
	}

	// Each side learns the other's real identity.
	if !dialerRes.peerStatic.Equal(listenerPub) {
		t.Error("dialer did not learn the listener's key")
	}
	if !listenerRes.peerStatic.Equal(dialerPub) {
		t.Error("listener did not learn the dialer's key")
	}
}

func TestHandshakeDerivesMatchingDirectionalKeys(t *testing.T) {
	_, dialerPriv := keypair(t)
	_, listenerPriv := keypair(t)

	dialerRes, listenerRes, err := runHandshake(t, dialerPriv, listenerPriv)
	if err != nil {
		t.Fatalf("handshake: %v", err)
	}

	if !bytes.Equal(dialerRes.keys.dialerToListener, listenerRes.keys.dialerToListener) {
		t.Error("sides disagree on the dialer→listener key")
	}
	if !bytes.Equal(dialerRes.keys.listenerToDialer, listenerRes.keys.listenerToDialer) {
		t.Error("sides disagree on the listener→dialer key")
	}
	// Directional keys are what keep the two sides from reusing a nonce under
	// one key.
	if bytes.Equal(dialerRes.keys.dialerToListener, dialerRes.keys.listenerToDialer) {
		t.Error("the two directions must not share a key")
	}
}

// Fresh ephemerals every connection mean the session keys must never repeat,
// which is what gives forward secrecy.
func TestHandshakeKeysDifferPerSession(t *testing.T) {
	_, dialerPriv := keypair(t)
	_, listenerPriv := keypair(t)

	first, _, err := runHandshake(t, dialerPriv, listenerPriv)
	if err != nil {
		t.Fatalf("first handshake: %v", err)
	}
	second, _, err := runHandshake(t, dialerPriv, listenerPriv)
	if err != nil {
		t.Fatalf("second handshake: %v", err)
	}

	if bytes.Equal(first.keys.dialerToListener, second.keys.dialerToListener) {
		t.Error("two sessions produced the same key")
	}
}

// An impostor that does not hold the private key cannot complete a handshake,
// which is the whole basis of peer authentication.
func TestHandshakeRejectsAForgedSignature(t *testing.T) {
	_, dialerPriv := keypair(t)
	_, realListenerPriv := keypair(t)
	_, impostorPriv := keypair(t)

	clientConn, serverConn := net.Pipe()
	defer clientConn.Close()
	defer serverConn.Close()

	go func() {
		// The impostor presents someone else's static key but signs with its own.
		realPub := realListenerPriv.Public().(ed25519.PublicKey)
		_, _ = readFull(serverConn, 1)
		peerEph, _ := readFull(serverConn, x25519KeySize)
		peerStatic, _ := readFull(serverConn, ed25519KeySize)

		eph, _ := generateEphemeralForTest()
		script := transcript(peerEph, peerStatic, eph, realPub)
		_ = writeFull(serverConn,
			[]byte{handshakeVersion}, eph, realPub, ed25519.Sign(impostorPriv, script))
	}()

	if _, err := dialerHandshake(clientConn, dialerPriv); !errors.Is(err, ErrHandshakeFailed) {
		t.Fatalf("expected ErrHandshakeFailed, got %v", err)
	}
}

func TestHandshakeRejectsAVersionMismatch(t *testing.T) {
	_, dialerPriv := keypair(t)

	clientConn, serverConn := net.Pipe()
	defer clientConn.Close()
	defer serverConn.Close()

	go func() {
		_, _ = readFull(serverConn, 1+x25519KeySize+ed25519KeySize)
		_ = writeFull(serverConn, []byte{99})
	}()

	if _, err := dialerHandshake(clientConn, dialerPriv); !errors.Is(err, ErrBadHandshakeVersion) {
		t.Fatalf("expected ErrBadHandshakeVersion, got %v", err)
	}
}

// --- frames ---------------------------------------------------------------

func TestFramesRoundTrip(t *testing.T) {
	sendKey := bytes.Repeat([]byte{1}, 32)
	recvKey := bytes.Repeat([]byte{2}, 32)

	var wire bytes.Buffer
	writer, err := newFramer(&wire, sendKey, recvKey)
	if err != nil {
		t.Fatalf("framer: %v", err)
	}
	reader, err := newFramer(&wire, recvKey, sendKey)
	if err != nil {
		t.Fatalf("framer: %v", err)
	}

	items := []clipboard.Content{
		{ContentType: "text/plain", Data: []byte("hello")},
		{ContentType: "text/plain", Data: []byte("")},
		{ContentType: "text/plain", Data: bytes.Repeat([]byte("x"), 100_000)},
		{ContentType: "text/plain", Data: []byte("unicode ✓ 日本語")},
	}

	for _, item := range items {
		encoded, err := encodeContent(&item)
		if err != nil {
			t.Fatalf("encode: %v", err)
		}
		if err := writer.writeFrame(encoded); err != nil {
			t.Fatalf("write: %v", err)
		}
	}

	for i, want := range items {
		frame, err := reader.readFrame()
		if err != nil {
			t.Fatalf("read %d: %v", i, err)
		}
		got, err := decodeContent(frame)
		if err != nil {
			t.Fatalf("decode %d: %v", i, err)
		}
		if got.ContentType != want.ContentType || !bytes.Equal(got.Data, want.Data) {
			t.Errorf("item %d round-tripped incorrectly", i)
		}
	}
}

// The ciphertext is authenticated, so a flipped bit must be detected rather
// than silently decrypted into corrupted clipboard content.
func TestFrameRejectsTamperedCiphertext(t *testing.T) {
	key := bytes.Repeat([]byte{3}, 32)

	var wire bytes.Buffer
	writer, _ := newFramer(&wire, key, key)
	if err := writer.writeFrame([]byte("secret")); err != nil {
		t.Fatalf("write: %v", err)
	}

	raw := wire.Bytes()
	raw[len(raw)-1] ^= 0xFF // flip a bit in the GCM tag

	reader, _ := newFramer(readOnly(raw), key, key)
	if _, err := reader.readFrame(); !errors.Is(err, ErrDecryptFailed) {
		t.Fatalf("expected ErrDecryptFailed, got %v", err)
	}
}

// A hostile length prefix must not make us allocate unbounded memory.
func TestFrameRejectsAnOversizeLengthPrefix(t *testing.T) {
	key := bytes.Repeat([]byte{4}, 32)
	header := []byte{0xFF, 0xFF, 0xFF, 0xFF} // ~4 GiB

	reader, _ := newFramer(readOnly(header), key, key)
	if _, err := reader.readFrame(); !errors.Is(err, ErrFrameTooLarge) {
		t.Fatalf("expected ErrFrameTooLarge, got %v", err)
	}
}

// Frames are counter-ordered, so a replayed frame fails to authenticate.
func TestFrameRejectsAReplayedFrame(t *testing.T) {
	key := bytes.Repeat([]byte{5}, 32)

	var wire bytes.Buffer
	writer, _ := newFramer(&wire, key, key)
	_ = writer.writeFrame([]byte("first"))

	replayed := append(bytes.Clone(wire.Bytes()), wire.Bytes()...)
	reader, _ := newFramer(readOnly(replayed), key, key)

	if _, err := reader.readFrame(); err != nil {
		t.Fatalf("first frame should decrypt: %v", err)
	}
	if _, err := reader.readFrame(); !errors.Is(err, ErrDecryptFailed) {
		t.Fatalf("a replayed frame must not authenticate, got %v", err)
	}
}

// --- end to end over a real socket ----------------------------------------

func TestTCPRoundTripBetweenAuthorizedPeers(t *testing.T) {
	alicePub, alicePriv := keypair(t)
	bobPub, bobPriv := keypair(t)

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	port := freePort(t)
	bob := NewTCP(bobPriv, port)

	// Bob accepts only Alice.
	inbound, err := bob.Listen(ctx, func(key ed25519.PublicKey) bool {
		return key.Equal(alicePub)
	})
	if err != nil {
		t.Fatalf("listen: %v", err)
	}

	alice := NewTCP(alicePriv, 0)
	candidate := discovery.Candidate{
		Addr: netip.MustParseAddrPort(netip.AddrPortFrom(netip.MustParseAddr("127.0.0.1"), port).String()),
	}

	session, err := alice.Dial(ctx, candidate, bobPub)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer session.Close()

	var bobSession Session
	select {
	case bobSession = <-inbound:
	case <-time.After(10 * time.Second):
		t.Fatal("listener never produced a session")
	}
	defer bobSession.Close()

	received, err := bobSession.Receive(ctx)
	if err != nil {
		t.Fatalf("receive: %v", err)
	}

	want := "clipboard content over the wire"
	if err := session.Send(ctx, &clipboard.Content{ContentType: "text/plain", Data: []byte(want)}); err != nil {
		t.Fatalf("send: %v", err)
	}

	select {
	case got := <-received:
		if string(got.Data) != want {
			t.Errorf("got %q, want %q", got.Data, want)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("content never arrived")
	}
}

// Dialling an address where a *different* peer answers must fail, even though
// that peer completes a perfectly valid handshake of its own.
func TestTCPDialRejectsTheWrongPeerIdentity(t *testing.T) {
	_, alicePriv := keypair(t)
	_, bobPriv := keypair(t)
	strangerPub, _ := keypair(t)

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	port := freePort(t)
	bob := NewTCP(bobPriv, port)
	if _, err := bob.Listen(ctx, func(ed25519.PublicKey) bool { return true }); err != nil {
		t.Fatalf("listen: %v", err)
	}

	alice := NewTCP(alicePriv, 0)
	candidate := discovery.Candidate{
		Addr: netip.AddrPortFrom(netip.MustParseAddr("127.0.0.1"), port),
	}

	_, err := alice.Dial(ctx, candidate, strangerPub)
	if !errors.Is(err, ErrPeerNotAuthorized) {
		t.Fatalf("expected ErrPeerNotAuthorized, got %v", err)
	}
}

// The inbound gate drops a peer the roster does not list, however valid its
// handshake.
func TestTCPListenerDropsUnauthorizedPeer(t *testing.T) {
	_, alicePriv := keypair(t)
	bobPub, bobPriv := keypair(t)

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	port := freePort(t)
	bob := NewTCP(bobPriv, port)
	inbound, err := bob.Listen(ctx, func(ed25519.PublicKey) bool { return false })
	if err != nil {
		t.Fatalf("listen: %v", err)
	}

	alice := NewTCP(alicePriv, 0)
	candidate := discovery.Candidate{
		Addr: netip.AddrPortFrom(netip.MustParseAddr("127.0.0.1"), port),
	}

	// The dial itself may succeed — rejection happens after the handshake.
	if session, err := alice.Dial(ctx, candidate, bobPub); err == nil {
		defer session.Close()
	}

	select {
	case session, ok := <-inbound:
		if ok {
			session.Close()
			t.Fatal("an unauthorized peer produced a session")
		}
	case <-time.After(2 * time.Second):
		// No session: correct.
	}
}

// readOnly adapts a byte slice to the io.ReadWriter the framer takes; writes
// during these decrypt-side tests go nowhere.
func readOnly(data []byte) io.ReadWriter {
	return struct {
		io.Reader
		io.Writer
	}{bytes.NewReader(data), io.Discard}
}

func freePort(t *testing.T) uint16 {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve port: %v", err)
	}
	defer listener.Close()
	return uint16(listener.Addr().(*net.TCPAddr).Port)
}
