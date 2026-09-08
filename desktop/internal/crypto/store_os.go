package crypto

import (
	"encoding/json"
	"fmt"
)

// The OS keystore.
//
// The contract requires the device seed and its tokens to live in platform
// secure storage — Keychain on macOS, Credential Manager on Windows, libsecret
// on Linux — rather than a file this user's own processes can read at will.
//
// Each backend stores one opaque blob under a single service/account name. The
// blob is the same JSON the file store used, so an existing FileStore identity
// can be migrated by reading it once and writing it here.

const (
	// serviceName is the key these credentials are filed under.
	serviceName = "code-paste-agent"
	// accountName distinguishes multiple agents on one machine (tests, or a
	// second account) when set via WithAccount.
	defaultAccount = "device-identity"
)

// osBackend is the per-platform surface. Implementations live in
// store_windows.go, store_darwin.go and store_linux.go.
type osBackend interface {
	// get returns ErrNotFound when nothing is stored.
	get(service, account string) ([]byte, error)
	set(service, account string, secret []byte) error
	del(service, account string) error
	// available reports whether this machine can actually use the backend.
	available() bool
	// name is what to call it in a log line.
	name() string
}

// OSStore persists a StoredIdentity in the platform credential store.
type OSStore struct {
	backend osBackend
	account string
}

// NewOSStore returns a keystore backed by the platform credential store, or an
// error when this machine has none available (a headless Linux box with no
// keyring daemon, say). Callers decide whether to fall back.
func NewOSStore(account string) (*OSStore, error) {
	if account == "" {
		account = defaultAccount
	}
	backend := newOSBackend()
	if !backend.available() {
		return nil, fmt.Errorf("%s is not available on this machine", backend.name())
	}
	return &OSStore{backend: backend, account: account}, nil
}

// Backend names the credential store in use, for diagnostics.
func (s *OSStore) Backend() string { return s.backend.name() }

func (s *OSStore) Load() (*StoredIdentity, error) {
	raw, err := s.backend.get(serviceName, s.account)
	if err != nil {
		return nil, err // ErrNotFound passes through unchanged
	}

	var stored StoredIdentity
	if err := json.Unmarshal(raw, &stored); err != nil {
		return nil, fmt.Errorf("parse stored identity: %w", err)
	}
	return &stored, nil
}

func (s *OSStore) Save(stored *StoredIdentity) error {
	raw, err := json.Marshal(stored)
	if err != nil {
		return fmt.Errorf("encode identity: %w", err)
	}
	return s.backend.set(serviceName, s.account, raw)
}

func (s *OSStore) Clear() error {
	return s.backend.del(serviceName, s.account)
}
