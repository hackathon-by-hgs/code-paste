package controlplane

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	agentcrypto "github.com/hackathon-by-hgs/code-paste/desktop/internal/crypto"
)

// Roster verification failures. Each one means "keep the roster you already
// have and do not sync with anyone new" — never "carry on".
var (
	ErrUnknownSigningKey = errors.New("roster signed by an unknown key id")
	ErrBadSignature      = errors.New("roster signature verification failed")
	ErrWrongDevice       = errors.New("roster was issued to a different device")
	ErrRosterRollback    = errors.New("roster version went backwards")
	ErrRosterExpired     = errors.New("roster has expired")
	ErrUnsupportedAlgo   = errors.New("unsupported roster signature algorithm")
)

// RosterVerifier turns signed bytes into a trusted roster.
//
// The order of checks below is mandated by docs/CLIENT_RESPONSES.md §4 and is
// not an implementation detail:
//
//  1. verify the signature over the exact decoded bytes
//  2. only then parse the JSON
//  3. check self.deviceId is us
//  4. check rosterVersion has not gone backwards
//  5. check expiresAt is in the future
//
// Parsing before verifying would run the JSON decoder over attacker-controlled
// bytes. Skipping (3) accepts a roster minted for a different device. Skipping
// (4) lets an attacker replay an older roster to reinstate a revoked peer.
type RosterVerifier struct {
	deviceID string

	mu       sync.Mutex
	keys     map[string]ed25519.PublicKey
	lastSeen int64
}

// NewRosterVerifier builds a verifier bound to this device's id.
func NewRosterVerifier(deviceID string) *RosterVerifier {
	return &RosterVerifier{deviceID: deviceID, keys: make(map[string]ed25519.PublicKey)}
}

// TrustKeys installs the signing keys from GET /authz/roster-keys.
// Matching is by key id so that rotation does not break verification.
func (v *RosterVerifier) TrustKeys(list *RosterKeyList) error {
	next := make(map[string]ed25519.PublicKey, len(list.Keys))

	for _, key := range list.Keys {
		if key.Algorithm != "ed25519" {
			return fmt.Errorf("%w: %s", ErrUnsupportedAlgo, key.Algorithm)
		}
		parsed, err := agentcrypto.ParsePublicKey(key.PublicKey)
		if err != nil {
			return fmt.Errorf("roster key %s: %w", key.KeyID, err)
		}
		next[key.KeyID] = parsed
	}

	v.mu.Lock()
	defer v.mu.Unlock()
	v.keys = next
	return nil
}

// Verify checks a signed roster and returns it only if every check passes.
func (v *RosterVerifier) Verify(signed *SignedPeerRoster, now time.Time) (*PeerRoster, error) {
	if signed.Signature.Algorithm != "ed25519" {
		return nil, fmt.Errorf("%w: %s", ErrUnsupportedAlgo, signed.Signature.Algorithm)
	}

	// (1) Decode to the exact bytes that were signed, and verify over those.
	payload, err := base64.StdEncoding.DecodeString(signed.Payload)
	if err != nil {
		return nil, fmt.Errorf("decode roster payload: %w", err)
	}
	signature, err := base64.StdEncoding.DecodeString(signed.Signature.Value)
	if err != nil {
		return nil, fmt.Errorf("decode roster signature: %w", err)
	}

	v.mu.Lock()
	key, known := v.keys[signed.Signature.KeyID]
	lastSeen := v.lastSeen
	v.mu.Unlock()

	if !known {
		return nil, fmt.Errorf("%w: %s", ErrUnknownSigningKey, signed.Signature.KeyID)
	}
	if !ed25519.Verify(key, payload, signature) {
		return nil, ErrBadSignature
	}

	// (2) Only now is it safe to parse.
	var roster PeerRoster
	if err := json.Unmarshal(payload, &roster); err != nil {
		return nil, fmt.Errorf("parse roster payload: %w", err)
	}

	// (3) A roster minted for another device tells us nothing about our own
	// authorization, however valid its signature.
	if roster.Self.DeviceID != v.deviceID {
		return nil, fmt.Errorf("%w: issued to %s", ErrWrongDevice, roster.Self.DeviceID)
	}

	// (4) A lower version is a rollback attempt — an old roster still carries a
	// valid signature, so this is the only thing standing between a replayed
	// roster and a revoked peer being trusted again.
	if roster.RosterVersion < lastSeen {
		return nil, fmt.Errorf("%w: got %d, already saw %d", ErrRosterRollback, roster.RosterVersion, lastSeen)
	}

	// (5) Expiry is what makes stale authorization self-healing.
	expiresAt, err := time.Parse(time.RFC3339, roster.ExpiresAt)
	if err != nil {
		return nil, fmt.Errorf("parse roster expiresAt: %w", err)
	}
	if !now.Before(expiresAt) {
		return nil, fmt.Errorf("%w at %s", ErrRosterExpired, roster.ExpiresAt)
	}

	v.mu.Lock()
	if roster.RosterVersion > v.lastSeen {
		v.lastSeen = roster.RosterVersion
	}
	v.mu.Unlock()

	return &roster, nil
}

// Authorizes reports whether a peer discovered on the LAN may be talked to.
//
// This answers only "is this identity authorized". It is NOT sufficient on its
// own: the transport handshake must still prove the peer holds the private key
// matching this fingerprint. Discovery says the device exists, the roster says
// the identity is authorized, the handshake says it really is that identity —
// all three, always.
func Authorizes(roster *PeerRoster, keyFingerprint string) (*Peer, bool) {
	if roster == nil {
		return nil, false
	}
	for i := range roster.Peers {
		if roster.Peers[i].KeyFingerprint == keyFingerprint {
			return &roster.Peers[i], true
		}
	}
	return nil, false
}
