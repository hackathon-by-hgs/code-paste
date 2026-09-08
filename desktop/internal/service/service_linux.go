//go:build linux

package service

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// Linux: a systemd *user* unit.
//
// User-scoped, not system-wide: the agent needs the user's session bus to reach
// libsecret, and the user's display to reach the clipboard. A system unit has
// neither, and would also demand root to install.

const unitName = "codepaste-agent.service"

type systemdUser struct{}

func newManager() Manager { return systemdUser{} }

func (systemdUser) Describe() string { return "systemd user unit (~/.config/systemd/user)" }

func unitPath() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("resolve user config dir: %w", err)
	}
	return filepath.Join(base, "systemd", "user", unitName), nil
}

func systemctl(args ...string) (string, error) {
	out, err := exec.Command("systemctl", append([]string{"--user"}, args...)...).CombinedOutput()
	return string(out), err
}

const unitTemplate = `[Unit]
Description=%s
Documentation=https://github.com/hackathon-by-hgs/code-paste
After=graphical-session.target

[Service]
Type=simple
ExecStart=%s run
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`

func (s systemdUser) Install(execPath string) error {
	if _, err := exec.LookPath("systemctl"); err != nil {
		return fmt.Errorf("%w: systemd not found", ErrUnsupported)
	}

	path, err := unitPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create systemd user directory: %w", err)
	}

	unit := fmt.Sprintf(unitTemplate, DisplayName, execPath)
	if err := os.WriteFile(path, []byte(unit), 0o644); err != nil {
		return fmt.Errorf("write systemd unit: %w", err)
	}

	if out, err := systemctl("daemon-reload"); err != nil {
		return fmt.Errorf("systemctl daemon-reload: %w: %s", err, strings.TrimSpace(out))
	}
	if out, err := systemctl("enable", "--now", unitName); err != nil {
		return fmt.Errorf("systemctl enable: %w: %s", err, strings.TrimSpace(out))
	}

	// Without lingering the unit stops at logout, which defeats the point on a
	// machine the user logs out of. Best effort: it needs polkit and may be
	// declined, and the service still works for the current session either way.
	if username := os.Getenv("USER"); username != "" {
		_ = exec.Command("loginctl", "enable-linger", username).Run()
	}
	return nil
}

func (s systemdUser) Uninstall() error {
	_, _ = systemctl("disable", "--now", unitName)

	path, err := unitPath()
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("remove systemd unit: %w", err)
	}
	_, _ = systemctl("daemon-reload")
	return nil
}

func (s systemdUser) Status() (State, error) {
	path, err := unitPath()
	if err != nil {
		return StateUnknown, err
	}
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return StateNotInstalled, nil
	}

	// `is-active` exits non-zero when inactive, which is information, not a
	// failure — so the output is what matters, not the exit code.
	out, _ := systemctl("is-active", unitName)
	switch strings.TrimSpace(out) {
	case "active":
		return StateRunning, nil
	case "inactive", "failed":
		return StateStopped, nil
	default:
		return StateUnknown, nil
	}
}
