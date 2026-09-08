package transport

import (
	"crypto/ecdh"
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
)

// Station-to-station handshake.
//
// Each side proves possession of its long-term Ed25519 key by signing a
// transcript that contains BOTH ephemeral X25519 keys. Signing the transcript
// rather than a bare nonce is what binds the authentication to this specific
// session: a signature captured from another connection covers different
// ephemeral keys and will not verify here, so it cannot be replayed.
//
// Confidentiality comes from the ephemeral X25519 exchange, which also gives
// forward secrecy — recovering a device's long-term private key later does not
// decrypt traffic already captured.
//
// Roles: the dialer speaks first. Both sides end up with the peer's verified
// static public key, which the caller then checks against the roster.

const (
	handshakeVersion = 1
	// transcriptLabel domain-separates these signatures from any other use of
	// the same device key.
	transcriptLabel = "codepaste-handshake-v1"
	keyLabel        = "codepaste-frame-keys-v1"

	x25519KeySize  = 32
	ed25519KeySize = ed25519.PublicKeySize
)

var (
	ErrBadHandshakeVersion = errors.New("transport: unsupported handshake version")
	ErrBadPeerKey          = errors.New("transport: malformed peer key")
)

// sessionKeys are directional, so the two sides never encrypt under the same
// key with the same counter.
type sessionKeys struct {
	dialerToListener []byte
	listenerToDialer []byte
}

type handshakeResult struct {
	peerStatic ed25519.PublicKey
	keys       sessionKeys
}

// transcript is the exact byte string both sides sign.
func transcript(dialerEph, dialerStatic, listenerEph, listenerStatic []byte) []byte {
	out := make([]byte, 0, len(transcriptLabel)+4*32)
	out = append(out, transcriptLabel...)
	out = append(out, dialerEph...)
	out = append(out, dialerStatic...)
	out = append(out, listenerEph...)
	out = append(out, listenerStatic...)
	return out
}

func deriveKeys(shared, transcriptBytes []byte) sessionKeys {
	salt := sha256.Sum256(transcriptBytes)
	material := hkdf(shared, salt[:], []byte(keyLabel), 64)
	return sessionKeys{
		dialerToListener: material[:32],
		listenerToDialer: material[32:],
	}
}

// hkdf is RFC 5869 extract-and-expand over SHA-256.
//
// Written out rather than imported: the agent has no third-party dependencies,
// and this keeps the key schedule auditable in one place.
func hkdf(secret, salt, info []byte, length int) []byte {
	extract := hmac.New(sha256.New, salt)
	extract.Write(secret)
	prk := extract.Sum(nil)

	var out, block []byte
	for counter := byte(1); len(out) < length; counter++ {
		expand := hmac.New(sha256.New, prk)
		expand.Write(block)
		expand.Write(info)
		expand.Write([]byte{counter})
		block = expand.Sum(nil)
		out = append(out, block...)
	}
	return out[:length]
}

func writeFull(w io.Writer, chunks ...[]byte) error {
	for _, chunk := range chunks {
		if _, err := w.Write(chunk); err != nil {
			return fmt.Errorf("handshake write: %w", err)
		}
	}
	return nil
}

func readFull(r io.Reader, n int) ([]byte, error) {
	buf := make([]byte, n)
	if _, err := io.ReadFull(r, buf); err != nil {
		return nil, fmt.Errorf("handshake read: %w", err)
	}
	return buf, nil
}

// dialerHandshake runs the initiating side.
func dialerHandshake(rw io.ReadWriter, static ed25519.PrivateKey) (*handshakeResult, error) {
	staticPub, ok := static.Public().(ed25519.PublicKey)
	if !ok {
		return nil, errors.New("transport: bad static key")
	}

	eph, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("generate ephemeral key: %w", err)
	}

	// -> version || eph || static
	if err := writeFull(rw, []byte{handshakeVersion}, eph.PublicKey().Bytes(), staticPub); err != nil {
		return nil, err
	}

	// <- version || eph || static || signature
	version, err := readFull(rw, 1)
	if err != nil {
		return nil, err
	}
	if version[0] != handshakeVersion {
		return nil, fmt.Errorf("%w: %d", ErrBadHandshakeVersion, version[0])
	}

	peerEphBytes, err := readFull(rw, x25519KeySize)
	if err != nil {
		return nil, err
	}
	peerStatic, err := readFull(rw, ed25519KeySize)
	if err != nil {
		return nil, err
	}
	peerSig, err := readFull(rw, ed25519.SignatureSize)
	if err != nil {
		return nil, err
	}

	script := transcript(eph.PublicKey().Bytes(), staticPub, peerEphBytes, peerStatic)

	// The peer proves it holds the private half of the key it just claimed.
	// Whether that key is *authorized* is the caller's decision, made against
	// the roster — this only establishes who is on the other end.
	if !ed25519.Verify(peerStatic, script, peerSig) {
		return nil, ErrHandshakeFailed
	}

	if err := writeFull(rw, ed25519.Sign(static, script)); err != nil {
		return nil, err
	}

	peerEph, err := ecdh.X25519().NewPublicKey(peerEphBytes)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrBadPeerKey, err)
	}
	shared, err := eph.ECDH(peerEph)
	if err != nil {
		return nil, fmt.Errorf("ecdh: %w", err)
	}

	return &handshakeResult{peerStatic: peerStatic, keys: deriveKeys(shared, script)}, nil
}

// listenerHandshake runs the accepting side.
func listenerHandshake(rw io.ReadWriter, static ed25519.PrivateKey) (*handshakeResult, error) {
	staticPub, ok := static.Public().(ed25519.PublicKey)
	if !ok {
		return nil, errors.New("transport: bad static key")
	}

	version, err := readFull(rw, 1)
	if err != nil {
		return nil, err
	}
	if version[0] != handshakeVersion {
		return nil, fmt.Errorf("%w: %d", ErrBadHandshakeVersion, version[0])
	}

	peerEphBytes, err := readFull(rw, x25519KeySize)
	if err != nil {
		return nil, err
	}
	peerStatic, err := readFull(rw, ed25519KeySize)
	if err != nil {
		return nil, err
	}

	eph, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("generate ephemeral key: %w", err)
	}

	script := transcript(peerEphBytes, peerStatic, eph.PublicKey().Bytes(), staticPub)

	// <- version || eph || static || signature
	if err := writeFull(rw,
		[]byte{handshakeVersion},
		eph.PublicKey().Bytes(),
		staticPub,
		ed25519.Sign(static, script),
	); err != nil {
		return nil, err
	}

	peerSig, err := readFull(rw, ed25519.SignatureSize)
	if err != nil {
		return nil, err
	}
	if !ed25519.Verify(peerStatic, script, peerSig) {
		return nil, ErrHandshakeFailed
	}

	peerEph, err := ecdh.X25519().NewPublicKey(peerEphBytes)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrBadPeerKey, err)
	}
	shared, err := eph.ECDH(peerEph)
	if err != nil {
		return nil, fmt.Errorf("ecdh: %w", err)
	}

	return &handshakeResult{peerStatic: peerStatic, keys: deriveKeys(shared, script)}, nil
}

// generateEphemeralForTest exposes an ephemeral public key to the test that
// impersonates a peer. Not used by the protocol itself.
func generateEphemeralForTest() ([]byte, error) {
	key, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	return key.PublicKey().Bytes(), nil
}
