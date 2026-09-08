//go:build darwin

package service

import (
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strings"
)

// macOS: a launchd LaunchAgent in ~/Library/LaunchAgents.
//
// A LaunchAgent (not a LaunchDaemon) because it must run in the user's GUI
// session — a daemon has no pasteboard access. launchd handles start-at-login
// and restart-on-crash, so the agent does not have to.

const plistName = Label + ".plist"

type launchdAgent struct{}

func newManager() Manager { return launchdAgent{} }

func (launchdAgent) Describe() string { return "launchd LaunchAgent (~/Library/LaunchAgents)" }

func plistPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve home directory: %w", err)
	}
	return filepath.Join(home, "Library", "LaunchAgents", plistName), nil
}

// domainTarget is the modern launchctl address for the current user's session.
func domainTarget() (string, error) {
	current, err := user.Current()
	if err != nil {
		return "", err
	}
	return "gui/" + current.Uid, nil
}

const plistTemplate = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>%s</string>
	<key>ProgramArguments</key>
	<array>
		<string>%s</string>
		<string>run</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<true/>
	<key>StandardOutPath</key>
	<string>%s</string>
	<key>StandardErrorPath</key>
	<string>%s</string>
</dict>
</plist>
`

func (l launchdAgent) Install(execPath string) error {
	path, err := plistPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create LaunchAgents directory: %w", err)
	}

	log, err := logPath("")
	if err != nil {
		return err
	}

	plist := fmt.Sprintf(plistTemplate, Label, execPath, log, log)
	if err := os.WriteFile(path, []byte(plist), 0o644); err != nil {
		return fmt.Errorf("write launch agent: %w", err)
	}

	// Unload an existing copy first so a re-install picks up a changed path.
	target, err := domainTarget()
	if err != nil {
		return err
	}
	_ = exec.Command("launchctl", "bootout", target+"/"+Label).Run()

	if out, err := exec.Command("launchctl", "bootstrap", target, path).CombinedOutput(); err != nil {
		// Older macOS lacks bootstrap; fall back to the legacy verb.
		if out2, err2 := exec.Command("launchctl", "load", "-w", path).CombinedOutput(); err2 != nil {
			return fmt.Errorf("load launch agent: %w: %s %s", err,
				strings.TrimSpace(string(out)), strings.TrimSpace(string(out2)))
		}
	}
	return nil
}

func (l launchdAgent) Uninstall() error {
	path, err := plistPath()
	if err != nil {
		return err
	}

	if target, err := domainTarget(); err == nil {
		_ = exec.Command("launchctl", "bootout", target+"/"+Label).Run()
	}
	_ = exec.Command("launchctl", "unload", "-w", path).Run()

	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("remove launch agent: %w", err)
	}
	return nil
}

func (l launchdAgent) Status() (State, error) {
	path, err := plistPath()
	if err != nil {
		return StateUnknown, err
	}
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return StateNotInstalled, nil
	}

	out, err := exec.Command("launchctl", "list").CombinedOutput()
	if err != nil {
		return StateUnknown, nil
	}
	for _, line := range strings.Split(string(out), "\n") {
		if !strings.Contains(line, Label) {
			continue
		}
		// "PID Status Label" — a numeric PID means it is running.
		fields := strings.Fields(line)
		if len(fields) > 0 && fields[0] != "-" {
			return StateRunning, nil
		}
		return StateStopped, nil
	}
	return StateStopped, nil
}
