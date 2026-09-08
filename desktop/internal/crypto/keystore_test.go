package crypto

import (
	"errors"
	"testing"
)

// The OS store is the whole point of this package's storage layer, so when the
// machine has one, exercise it for real rather than mocking it away.
func TestOSStoreRoundTrip(t *testing.T) {
	store, err := NewOSStore("codepaste-test-account")
	if err != nil {
		t.Skipf("no OS credential store here: %v", err)
	}
	t.Cleanup(func() { _ = store.Clear() })

	_ = store.Clear()
	if _, err := store.Load(); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound on an empty store, got %v", err)
	}

	id, err := GenerateIdentity()
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	want := &StoredIdentity{
		Seed:         id.Seed(),
		DeviceID:     "cp_dev_test",
		AccessToken:  "access",
		RefreshToken: "refresh",
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
	// The seed must survive exactly, or the device identity is lost.
	restored, err := IdentityFromSeed(got.Seed)
	if err != nil || restored.Fingerprint() != id.Fingerprint() {
		t.Errorf("seed did not survive storage")
	}

	// Overwriting must work: token rotation saves on every refresh.
	want.RefreshToken = "rotated"
	if err := store.Save(want); err != nil {
		t.Fatalf("overwrite: %v", err)
	}
	if got, _ = store.Load(); got.RefreshToken != "rotated" {
		t.Errorf("refresh token = %q, want rotated", got.RefreshToken)
	}

	if err := store.Clear(); err != nil {
		t.Fatalf("clear: %v", err)
	}
	if _, err := store.Load(); !errors.Is(err, ErrNotFound) {
		t.Errorf("expected ErrNotFound after clear, got %v", err)
	}
	// Revocation handling may clear more than once.
	if err := store.Clear(); err != nil {
		t.Errorf("second clear should be a no-op, got %v", err)
	}
}

// An agent that already paired must not be forced to pair again when the
// secure store becomes available.
func TestOpenKeyStoreMigratesFromTheFileStore(t *testing.T) {
	dir := t.TempDir()

	fileStore, err := NewFileStore(dir)
	if err != nil {
		t.Fatalf("file store: %v", err)
	}
	id, _ := GenerateIdentity()
	seeded := &StoredIdentity{Seed: id.Seed(), DeviceID: "cp_dev_migrate", RefreshToken: "r1"}
	if err := fileStore.Save(seeded); err != nil {
		t.Fatalf("seed: %v", err)
	}

	if probe, err := NewOSStore("codepaste-migrate-test"); err != nil {
		t.Skipf("no OS credential store here: %v", err)
	} else {
		_ = probe.Clear()
		t.Cleanup(func() { _ = probe.Clear() })
	}

	store, info, err := OpenKeyStore("codepaste-migrate-test", dir)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if !info.Secure {
		t.Fatalf("expected the secure store, got %s", info.Description)
	}
	if !info.Migrated {
		t.Error("expected the file identity to be migrated")
	}

	got, err := store.Load()
	if err != nil {
		t.Fatalf("load after migration: %v", err)
	}
	if got.DeviceID != "cp_dev_migrate" {
		t.Errorf("device id = %q", got.DeviceID)
	}

	// The plaintext copy must be gone, not merely superseded.
	if _, err := fileStore.Load(); !errors.Is(err, ErrNotFound) {
		t.Error("the file copy must be removed after migration")
	}
}
