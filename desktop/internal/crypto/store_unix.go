//go:build darwin || linux

package crypto

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

// macOS Keychain and Linux libsecret, driven through their command-line tools.
//
// Both have C APIs, but using them needs cgo, which would end static
// cross-compilation and force a build matrix per platform. `security` ships
// with macOS, and `secret-tool` is the standard libsecret client; shelling out
// keeps the release a single static binary.
//
// The secret never appears in an argument vector — it goes over stdin — so it
// cannot leak through the process table.

const keyringTimeout = 10 * time.Second

func newOSBackend() osBackend {
	if runtime.GOOS == "darwin" {
		return macKeychain{}
	}
	return libsecret{}
}

// --- macOS ------------------------------------------------------------------

type macKeychain struct{}

func (macKeychain) name() string { return "macOS Keychain" }

func (macKeychain) available() bool {
	_, err := exec.LookPath("security")
	return err == nil
}

func (macKeychain) get(service, account string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), keyringTimeout)
	defer cancel()

	// -w prints the raw password to stdout and nothing else.
	cmd := exec.CommandContext(ctx, "security", "find-generic-password",
		"-s", service, "-a", account, "-w")

	var out, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &stderr
	if err := cmd.Run(); err != nil {
		if strings.Contains(stderr.String(), "could not be found") {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("security find-generic-password: %w", err)
	}
	return bytes.TrimRight(out.Bytes(), "\n"), nil
}

func (m macKeychain) set(service, account string, secret []byte) error {
	ctx, cancel := context.WithTimeout(context.Background(), keyringTimeout)
	defer cancel()

	// -U updates an existing item; -w - reads the secret from stdin so it never
	// appears in the process table.
	cmd := exec.CommandContext(ctx, "security", "add-generic-password",
		"-s", service, "-a", account, "-U", "-w")
	cmd.Stdin = bytes.NewReader(secret)

	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("security add-generic-password: %w: %s", err, stderr.String())
	}
	return nil
}

func (macKeychain) del(service, account string) error {
	ctx, cancel := context.WithTimeout(context.Background(), keyringTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "security", "delete-generic-password",
		"-s", service, "-a", account)

	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		if strings.Contains(stderr.String(), "could not be found") {
			return nil // already gone
		}
		return fmt.Errorf("security delete-generic-password: %w", err)
	}
	return nil
}

// --- Linux ------------------------------------------------------------------

type libsecret struct{}

func (libsecret) name() string { return "libsecret (GNOME Keyring / KWallet)" }

// available requires both the tool and a session bus: secret-tool exists on
// plenty of headless boxes where no keyring daemon is listening, and calling it
// there hangs rather than failing.
func (libsecret) available() bool {
	if _, err := exec.LookPath("secret-tool"); err != nil {
		return false
	}
	if os.Getenv("DBUS_SESSION_BUS_ADDRESS") == "" && os.Getenv("XDG_RUNTIME_DIR") == "" {
		return false
	}
	return true
}

func (libsecret) get(service, account string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), keyringTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "secret-tool", "lookup", "service", service, "account", account)

	var out bytes.Buffer
	cmd.Stdout = &out
	if err := cmd.Run(); err != nil {
		// secret-tool exits non-zero and prints nothing when the item is absent.
		if out.Len() == 0 {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("secret-tool lookup: %w", err)
	}
	if out.Len() == 0 {
		return nil, ErrNotFound
	}
	return out.Bytes(), nil
}

func (libsecret) set(service, account string, secret []byte) error {
	ctx, cancel := context.WithTimeout(context.Background(), keyringTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "secret-tool", "store",
		"--label=Code Paste device identity", "service", service, "account", account)
	cmd.Stdin = bytes.NewReader(secret)

	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("secret-tool store: %w: %s", err, stderr.String())
	}
	return nil
}

func (libsecret) del(service, account string) error {
	ctx, cancel := context.WithTimeout(context.Background(), keyringTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "secret-tool", "clear", "service", service, "account", account)
	if err := cmd.Run(); err != nil {
		return nil // clear is best-effort; absent is the desired end state
	}
	return nil
}
