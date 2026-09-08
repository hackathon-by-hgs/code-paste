package crypto

import (
	"errors"
	"fmt"
)

// KeyStoreInfo describes the store that was opened, so the agent can say plainly
// where its credentials live.
type KeyStoreInfo struct {
	// Description names the backend, e.g. "Windows Credential Manager".
	Description string
	// Secure is false for the file fallback. The caller should warn.
	Secure bool
	// Migrated is true when an identity was moved out of the file store.
	Migrated bool
}

// OpenKeyStore returns the best available store for this machine.
//
// Order matters: the platform credential store is tried first, and the plain
// file is only ever a fallback for a machine that genuinely has no keyring —
// a headless Linux box, typically. The fallback is reported rather than
// silently taken, because "my secrets are encrypted by the OS" and "my secrets
// are a file readable by anything running as me" are not interchangeable.
//
// An identity found in the old file store is migrated into the secure store and
// removed from disk, so existing agents do not have to re-pair.
func OpenKeyStore(account, fallbackDir string) (KeyStore, KeyStoreInfo, error) {
	osStore, osErr := NewOSStore(account)
	if osErr != nil {
		fileStore, err := NewFileStore(fallbackDir)
		if err != nil {
			return nil, KeyStoreInfo{}, err
		}
		return fileStore, KeyStoreInfo{
			Description: fmt.Sprintf("insecure file store at %s (%v)", fileStore.Path(), osErr),
			Secure:      false,
		}, nil
	}

	info := KeyStoreInfo{Description: osStore.Backend(), Secure: true}

	migrated, err := migrateFromFile(osStore, fallbackDir)
	if err != nil {
		// A failed migration must not block startup: the secure store is usable
		// and the worst case is the user pairs again.
		info.Description += fmt.Sprintf(" (migration from the file store failed: %v)", err)
		return osStore, info, nil
	}
	info.Migrated = migrated

	return osStore, info, nil
}

// migrateFromFile moves a file-store identity into the secure store, then
// deletes the file. It does nothing when the secure store already holds one.
func migrateFromFile(target KeyStore, fallbackDir string) (bool, error) {
	if _, err := target.Load(); err == nil {
		return false, nil // already have one; leave everything alone
	} else if !errors.Is(err, ErrNotFound) {
		return false, err
	}

	fileStore, err := NewFileStore(fallbackDir)
	if err != nil {
		return false, err
	}

	stored, err := fileStore.Load()
	if errors.Is(err, ErrNotFound) {
		return false, nil // nothing to migrate
	}
	if err != nil {
		return false, err
	}

	// Written before the old copy is removed: a crash between the two leaves a
	// duplicate, which is recoverable. The other order loses the identity.
	if err := target.Save(stored); err != nil {
		return false, err
	}
	if err := fileStore.Clear(); err != nil {
		return true, err
	}
	return true, nil
}
