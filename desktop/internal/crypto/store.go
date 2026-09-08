package crypto

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

// ErrNotFound means the agent has no stored identity yet and must pair.
var ErrNotFound = errors.New("no stored identity")

// KeyStore persists the device seed and its control-plane credentials.
//
// The contract requires platform secure storage — Keychain on macOS, Credential
// Manager on Windows, libsecret on Linux. That is deliberately behind an
// interface so the daemon does not care which is in use.
type KeyStore interface {
	Load() (*StoredIdentity, error)
	Save(*StoredIdentity) error
	Clear() error
}

// StoredIdentity is everything needed to resume as a registered device.
type StoredIdentity struct {
	Seed         []byte `json:"seed"`
	DeviceID     string `json:"deviceId"`
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
}

// FileStore is a development placeholder: a 0600 file under the state dir.
//
// NOT PRODUCTION SAFE. It protects against other users on the machine, not
// against anything running as this user. Replace it with an OS keychain
// implementation before shipping — that is the whole reason KeyStore is an
// interface. Tracked in HANDOFF.md.
type FileStore struct {
	path string
}

// NewFileStore places the file under dir, creating the directory 0700.
func NewFileStore(dir string) (*FileStore, error) {
	if dir == "" {
		base, err := os.UserConfigDir()
		if err != nil {
			return nil, fmt.Errorf("resolve user config dir: %w", err)
		}
		dir = filepath.Join(base, "code-paste")
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("create state dir: %w", err)
	}
	return &FileStore{path: filepath.Join(dir, "identity.json")}, nil
}

// Path exposes the file location for diagnostics. Never log its contents.
func (s *FileStore) Path() string { return s.path }

func (s *FileStore) Load() (*StoredIdentity, error) {
	raw, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("read identity: %w", err)
	}

	var stored StoredIdentity
	if err := json.Unmarshal(raw, &stored); err != nil {
		return nil, fmt.Errorf("parse identity: %w", err)
	}
	return &stored, nil
}

func (s *FileStore) Save(stored *StoredIdentity) error {
	raw, err := json.Marshal(stored)
	if err != nil {
		return fmt.Errorf("encode identity: %w", err)
	}

	// Write-then-rename so a crash mid-write cannot leave a truncated identity.
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return fmt.Errorf("write identity: %w", err)
	}
	if runtime.GOOS == "windows" {
		// Windows rename fails onto an existing file.
		_ = os.Remove(s.path)
	}
	if err := os.Rename(tmp, s.path); err != nil {
		return fmt.Errorf("commit identity: %w", err)
	}
	return nil
}

func (s *FileStore) Clear() error {
	err := os.Remove(s.path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("clear identity: %w", err)
	}
	return nil
}
