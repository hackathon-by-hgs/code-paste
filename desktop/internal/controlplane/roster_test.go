package controlplane

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"testing"
	"time"
)

const testDeviceID = "cp_dev_01h2xcejqtf2nbrexx3vqjhp41"

type signer struct {
	keyID string
	pub   ed25519.PublicKey
	priv  ed25519.PrivateKey
}

func newSigner(t *testing.T) signer {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	return signer{keyID: "cp_rk_01h2xcejqtf2nbrexx3vqjhp4a", pub: pub, priv: priv}
}

func (s signer) keyList() *RosterKeyList {
	return &RosterKeyList{Keys: []RosterKey{{
		KeyID:     s.keyID,
		Algorithm: "ed25519",
		PublicKey: base64.StdEncoding.EncodeToString(s.pub),
	}}}
}

func (s signer) sign(t *testing.T, roster PeerRoster) *SignedPeerRoster {
	t.Helper()
	payload, err := json.Marshal(roster)
	if err != nil {
		t.Fatalf("marshal roster: %v", err)
	}
	return &SignedPeerRoster{
		Payload: base64.StdEncoding.EncodeToString(payload),
		Signature: RosterSignature{
			Algorithm: "ed25519",
			KeyID:     s.keyID,
			Value:     base64.StdEncoding.EncodeToString(ed25519.Sign(s.priv, payload)),
		},
	}
}

func validRoster(version int64, expiresAt time.Time) PeerRoster {
	return PeerRoster{
		ProtocolVersion: 1,
		RosterVersion:   version,
		IssuedAt:        time.Now().UTC().Format(time.RFC3339),
		ExpiresAt:       expiresAt.UTC().Format(time.RFC3339),
		Self:            RosterSelf{DeviceID: testDeviceID, UserID: "cp_usr_x"},
		Peers: []Peer{{
			DeviceID:       "cp_dev_peer",
			KeyFingerprint: "sha256:aa",
		}},
	}
}

func newVerifier(t *testing.T, s signer) *RosterVerifier {
	t.Helper()
	v := NewRosterVerifier(testDeviceID)
	if err := v.TrustKeys(s.keyList()); err != nil {
		t.Fatalf("trust keys: %v", err)
	}
	return v
}

func TestVerifyAcceptsAValidRoster(t *testing.T) {
	s := newSigner(t)
	v := newVerifier(t, s)

	signed := s.sign(t, validRoster(42, time.Now().Add(5*time.Minute)))
	roster, err := v.Verify(signed, time.Now())
	if err != nil {
		t.Fatalf("expected acceptance, got %v", err)
	}
	if roster.RosterVersion != 42 || len(roster.Peers) != 1 {
		t.Fatalf("unexpected roster: %+v", roster)
	}
}

func TestVerifyRejectsATamperedPayload(t *testing.T) {
	s := newSigner(t)
	v := newVerifier(t, s)

	signed := s.sign(t, validRoster(42, time.Now().Add(5*time.Minute)))

	// Swap in a roster that adds an unauthorized peer, keeping the signature.
	tampered := validRoster(42, time.Now().Add(5*time.Minute))
	tampered.Peers = append(tampered.Peers, Peer{DeviceID: "cp_dev_evil", KeyFingerprint: "sha256:ff"})
	raw, _ := json.Marshal(tampered)
	signed.Payload = base64.StdEncoding.EncodeToString(raw)

	if _, err := v.Verify(signed, time.Now()); !errors.Is(err, ErrBadSignature) {
		t.Fatalf("expected ErrBadSignature, got %v", err)
	}
}

func TestVerifyRejectsAnUnknownSigningKey(t *testing.T) {
	trusted := newSigner(t)
	attacker := newSigner(t)
	attacker.keyID = "cp_rk_attackerattackerattacker"

	v := newVerifier(t, trusted)

	// Correctly signed — by the wrong key.
	signed := attacker.sign(t, validRoster(42, time.Now().Add(5*time.Minute)))
	if _, err := v.Verify(signed, time.Now()); !errors.Is(err, ErrUnknownSigningKey) {
		t.Fatalf("expected ErrUnknownSigningKey, got %v", err)
	}
}

func TestVerifyRejectsARosterIssuedToAnotherDevice(t *testing.T) {
	s := newSigner(t)
	v := newVerifier(t, s)

	roster := validRoster(42, time.Now().Add(5*time.Minute))
	roster.Self.DeviceID = "cp_dev_somebodyelse"

	if _, err := v.Verify(s.sign(t, roster), time.Now()); !errors.Is(err, ErrWrongDevice) {
		t.Fatalf("expected ErrWrongDevice, got %v", err)
	}
}

// A replayed older roster carries a perfectly valid signature. Version
// monotonicity is the only thing preventing a revoked peer being reinstated.
func TestVerifyRejectsARolledBackRosterVersion(t *testing.T) {
	s := newSigner(t)
	v := newVerifier(t, s)

	if _, err := v.Verify(s.sign(t, validRoster(42, time.Now().Add(5*time.Minute))), time.Now()); err != nil {
		t.Fatalf("seed roster rejected: %v", err)
	}

	older := s.sign(t, validRoster(41, time.Now().Add(5*time.Minute)))
	if _, err := v.Verify(older, time.Now()); !errors.Is(err, ErrRosterRollback) {
		t.Fatalf("expected ErrRosterRollback, got %v", err)
	}
}

func TestVerifyAcceptsTheSameVersionAgain(t *testing.T) {
	s := newSigner(t)
	v := newVerifier(t, s)

	roster := validRoster(42, time.Now().Add(5*time.Minute))
	if _, err := v.Verify(s.sign(t, roster), time.Now()); err != nil {
		t.Fatalf("first accept failed: %v", err)
	}
	// Re-fetching before anything changes is normal, not an attack.
	if _, err := v.Verify(s.sign(t, roster), time.Now()); err != nil {
		t.Fatalf("expected same version to be accepted, got %v", err)
	}
}

func TestVerifyRejectsAnExpiredRoster(t *testing.T) {
	s := newSigner(t)
	v := newVerifier(t, s)

	signed := s.sign(t, validRoster(42, time.Now().Add(-time.Second)))
	if _, err := v.Verify(signed, time.Now()); !errors.Is(err, ErrRosterExpired) {
		t.Fatalf("expected ErrRosterExpired, got %v", err)
	}
}

func TestVerifyRejectsANonEd25519Signature(t *testing.T) {
	s := newSigner(t)
	v := newVerifier(t, s)

	signed := s.sign(t, validRoster(42, time.Now().Add(5*time.Minute)))
	signed.Signature.Algorithm = "hmac-sha256"

	if _, err := v.Verify(signed, time.Now()); !errors.Is(err, ErrUnsupportedAlgo) {
		t.Fatalf("expected ErrUnsupportedAlgo, got %v", err)
	}
}

func TestAuthorizesMatchesOnFingerprint(t *testing.T) {
	roster := validRoster(1, time.Now().Add(time.Minute))

	if _, ok := Authorizes(&roster, "sha256:aa"); !ok {
		t.Fatal("expected the listed fingerprint to be authorized")
	}
	if _, ok := Authorizes(&roster, "sha256:ff"); ok {
		t.Fatal("expected an unlisted fingerprint to be rejected")
	}
	if _, ok := Authorizes(nil, "sha256:aa"); ok {
		t.Fatal("expected a nil roster to authorize nobody")
	}
}
