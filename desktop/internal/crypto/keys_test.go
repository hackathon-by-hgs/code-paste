package crypto

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"regexp"
	"testing"
)

// The OpenAPI contract requires 32 raw bytes, base64: ^[A-Za-z0-9+/]{43}=$.
// Note the example in docs/CLIENT_RESPONSES.md §3 shows a 60-character SPKI
// encoding, which does NOT satisfy this pattern; the OpenAPI file wins.
var publicKeyPattern = regexp.MustCompile(`^[A-Za-z0-9+/]{43}=$`)

var fingerprintPattern = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)

func TestPublicKeyMatchesTheContractPattern(t *testing.T) {
	id, err := GenerateIdentity()
	if err != nil {
		t.Fatalf("generate: %v", err)
	}

	encoded := id.PublicKeyBase64()
	if !publicKeyPattern.MatchString(encoded) {
		t.Fatalf("public key %q does not match the contract pattern", encoded)
	}
	if len(encoded) != 44 {
		t.Errorf("encoded length = %d, want 44", len(encoded))
	}
}

func TestFingerprintMatchesTheContractPattern(t *testing.T) {
	id, err := GenerateIdentity()
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if fp := id.Fingerprint(); !fingerprintPattern.MatchString(fp) {
		t.Fatalf("fingerprint %q does not match the contract pattern", fp)
	}
}

func TestIdentityRoundTripsThroughItsSeed(t *testing.T) {
	original, err := GenerateIdentity()
	if err != nil {
		t.Fatalf("generate: %v", err)
	}

	restored, err := IdentityFromSeed(original.Seed())
	if err != nil {
		t.Fatalf("restore: %v", err)
	}

	if restored.PublicKeyBase64() != original.PublicKeyBase64() {
		t.Error("restored identity has a different public key")
	}
	if restored.Fingerprint() != original.Fingerprint() {
		t.Error("restored identity has a different fingerprint")
	}
}

func TestIdentityFromSeedRejectsAWrongLengthSeed(t *testing.T) {
	if _, err := IdentityFromSeed([]byte("too short")); err == nil {
		t.Fatal("expected an error for a short seed")
	}
}

func TestParsePublicKeyRejectsMalformedInput(t *testing.T) {
	id, _ := GenerateIdentity()

	if _, err := ParsePublicKey(id.PublicKeyBase64()); err != nil {
		t.Fatalf("valid key rejected: %v", err)
	}
	if _, err := ParsePublicKey("not base64!"); err == nil {
		t.Error("expected an error for non-base64 input")
	}
	// Right encoding, wrong length — an Ed25519 key is always 32 bytes.
	short := base64.StdEncoding.EncodeToString([]byte("only sixteen byte"))
	if _, err := ParsePublicKey(short); err == nil {
		t.Error("expected an error for a wrong-length key")
	}
}

func TestFileStoreRoundTripsAndClears(t *testing.T) {
	dir := t.TempDir()
	store, err := NewFileStore(dir)
	if err != nil {
		t.Fatalf("new store: %v", err)
	}

	if _, err := store.Load(); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound on an empty store, got %v", err)
	}

	id, _ := GenerateIdentity()
	want := &StoredIdentity{
		Seed:         id.Seed(),
		DeviceID:     "cp_dev_x",
		AccessToken:  "a",
		RefreshToken: "r",
	}
	if err := store.Save(want); err != nil {
		t.Fatalf("save: %v", err)
	}

	got, err := store.Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if got.DeviceID != want.DeviceID || got.RefreshToken != want.RefreshToken {
		t.Errorf("round trip mismatch: %+v", got)
	}

	// Overwriting must succeed — token rotation saves on every refresh.
	want.RefreshToken = "r2"
	if err := store.Save(want); err != nil {
		t.Fatalf("overwrite: %v", err)
	}
	if got, _ = store.Load(); got.RefreshToken != "r2" {
		t.Errorf("refresh token = %q, want r2", got.RefreshToken)
	}

	if err := store.Clear(); err != nil {
		t.Fatalf("clear: %v", err)
	}
	if _, err := store.Load(); err != ErrNotFound {
		t.Errorf("expected ErrNotFound after clear, got %v", err)
	}
	// Clearing twice is fine: revocation handling may run more than once.
	if err := store.Clear(); err != nil {
		t.Errorf("second clear should be a no-op, got %v", err)
	}
}

func TestFileStoreLeavesNoTempFileBehind(t *testing.T) {
	dir := t.TempDir()
	store, _ := NewFileStore(dir)
	id, _ := GenerateIdentity()

	if err := store.Save(&StoredIdentity{Seed: id.Seed(), DeviceID: "cp_dev_x"}); err != nil {
		t.Fatalf("save: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "identity.json.tmp")); !os.IsNotExist(err) {
		t.Error("temp file was left behind after a committed save")
	}
}
