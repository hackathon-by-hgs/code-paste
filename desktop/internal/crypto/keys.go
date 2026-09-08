// Package crypto owns the device identity: an Ed25519 keypair whose private
// half never leaves this machine and is never transmitted to any endpoint.
package crypto

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
)

// Identity is the device's long-lived signing key.
type Identity struct {
	Public  ed25519.PublicKey
	private ed25519.PrivateKey
}

// GenerateIdentity creates a fresh keypair from the system CSPRNG.
func GenerateIdentity() (*Identity, error) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("generate ed25519 keypair: %w", err)
	}
	return &Identity{Public: pub, private: priv}, nil
}

// IdentityFromSeed rebuilds an identity from a stored 32-byte seed.
func IdentityFromSeed(seed []byte) (*Identity, error) {
	if len(seed) != ed25519.SeedSize {
		return nil, fmt.Errorf("bad seed length: got %d, want %d", len(seed), ed25519.SeedSize)
	}
	priv := ed25519.NewKeyFromSeed(seed)
	pub, ok := priv.Public().(ed25519.PublicKey)
	if !ok {
		return nil, fmt.Errorf("unexpected public key type")
	}
	return &Identity{Public: pub, private: priv}, nil
}

// Seed returns the 32 bytes needed to reconstruct the private key.
//
// This is secret material. It goes to a KeyStore and nowhere else — never a
// log, never a request body, never a crash report.
func (id *Identity) Seed() []byte {
	return id.private.Seed()
}

// Sign produces a detached signature, used to prove key possession during the
// transport handshake.
func (id *Identity) Sign(message []byte) []byte {
	return ed25519.Sign(id.private, message)
}

// PublicKeyBase64 encodes the public key the way the control plane expects.
//
// The contract is 32 raw bytes, base64 — pattern ^[A-Za-z0-9+/]{43}=$, i.e. 44
// characters. Note that the example in docs/CLIENT_RESPONSES.md §3 shows a
// 60-character SPKI/DER encoding ("MCowBQYDK2VwAyEA…"), which does not satisfy
// that pattern. The OpenAPI file is authoritative where the two disagree, so
// this emits the raw form.
func (id *Identity) PublicKeyBase64() string {
	return base64.StdEncoding.EncodeToString(id.Public)
}

// Fingerprint is the "sha256:<64 hex>" identifier used to match a peer against
// the roster.
func (id *Identity) Fingerprint() string {
	return FingerprintOf(id.Public)
}

// FingerprintOf computes a fingerprint over raw public key bytes.
func FingerprintOf(pub ed25519.PublicKey) string {
	sum := sha256.Sum256(pub)
	return "sha256:" + hex.EncodeToString(sum[:])
}

// ParsePublicKey decodes a base64 public key from a roster entry.
func ParsePublicKey(encoded string) (ed25519.PublicKey, error) {
	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, fmt.Errorf("decode public key: %w", err)
	}
	if len(raw) != ed25519.PublicKeySize {
		return nil, fmt.Errorf("bad public key length: got %d, want %d", len(raw), ed25519.PublicKeySize)
	}
	return ed25519.PublicKey(raw), nil
}

// PrivateKey exposes the signing key for the transport handshake.
//
// In-process use only. It is never serialised anywhere except the KeyStore, and
// never leaves this machine.
func (id *Identity) PrivateKey() ed25519.PrivateKey {
	return id.private
}
