// Package service registers the agent to run in the background at login.
//
// ADR-002 asks for a "native/background-capable agent as the primary seamless
// client". A foreground CLI is not that: close the terminal and syncing stops,
// reboot and it is gone. This package is what closes that gap.
//
// Each platform uses its own supervisor rather than a cross-platform daemon
// library — Scheduled Tasks, launchd and systemd already do restart-on-crash
// and start-at-login properly, and reimplementing that badly would be worse
// than using them.
//
// Deliberately user-scoped, not system-wide. The agent holds credentials in the
// *user's* credential store and syncs the *user's* clipboard, so it must run as
// that user. It also means installing needs no administrator rights.
package service

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// Label identifies the service across all three platforms.
const Label = "com.codepaste.agent"

// DisplayName is what a human sees in Task Scheduler or a service list.
const DisplayName = "Code Paste Clipboard Agent"

var (
	// ErrNotInstalled means there is nothing registered to remove or query.
	ErrNotInstalled = errors.New("service is not installed")
	// ErrUnsupported means this platform has no supervisor implementation.
	ErrUnsupported = errors.New("background service is not supported on this platform")
)

// State is what the supervisor reports.
type State string

const (
	StateRunning      State = "running"
	StateStopped      State = "stopped"
	StateNotInstalled State = "not installed"
	StateUnknown      State = "unknown"
)

// Manager registers, removes and inspects the background service.
type Manager interface {
	// Install registers the agent to start at login and starts it now.
	// It replaces any existing registration, so it is safe to re-run.
	Install(execPath string) error
	// Uninstall stops the agent and removes the registration. Removing
	// something already absent is not an error.
	Uninstall() error
	// Status reports what the supervisor thinks.
	Status() (State, error)
	// Describe names the mechanism, for a human-readable status line.
	Describe() string
}

// New returns the manager for this platform.
func New() Manager { return newManager() }

// ExecutablePath resolves the absolute path of the running binary, following
// symlinks so a service does not end up pinned to a link that later moves.
func ExecutablePath() (string, error) {
	path, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("locate executable: %w", err)
	}
	if resolved, err := filepath.EvalSymlinks(path); err == nil {
		path = resolved
	}
	return filepath.Abs(path)
}

// logPath is where the background service writes its output. A service with no
// terminal needs somewhere to put diagnostics, or troubleshooting is guesswork.
func logPath(stateDir string) (string, error) {
	if stateDir == "" {
		base, err := os.UserConfigDir()
		if err != nil {
			return "", err
		}
		stateDir = filepath.Join(base, "code-paste")
	}
	if err := os.MkdirAll(stateDir, 0o700); err != nil {
		return "", err
	}
	return filepath.Join(stateDir, "agent.log"), nil
}
