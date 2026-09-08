//go:build windows

package service

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
)

// Windows: a hidden launcher in the user's Startup folder.
//
// Two mechanisms were considered and rejected:
//
//   - A Windows Service runs in session 0 with no access to the interactive
//     desktop, and therefore no access to the clipboard — which is the job.
//   - A Scheduled Task is the better fit on paper (it restarts on failure), but
//     `schtasks /create` returns "Access is denied" without elevation on a
//     default Windows 11 install. Putting a UAC prompt between the user and a
//     working clipboard defeats the point of making this seamless.
//
// The Startup folder needs no elevation, is plainly visible to the user, and
// uninstalls by deleting one file. The cost is no automatic restart if the
// agent crashes; it comes back at the next login.
//
// The launcher is a .vbs rather than the exe directly, because Windows would
// otherwise show a console window at every login.

const launcherName = "CodePasteAgent.vbs"

// vbsTemplate runs the agent hidden (0) without waiting (False), routing output
// to a log file.
//
// The redirect is why this goes through cmd rather than invoking the exe
// directly: WScript.Shell.Run cannot redirect streams, and a background process
// with nowhere to write its diagnostics is undebuggable — "it is not syncing"
// with no way to find out why.
const vbsTemplate = `' Code Paste clipboard agent — starts the background agent at login.
' Created by "agent install". Delete this file, or run "agent uninstall", to stop it.
CreateObject("WScript.Shell").Run "cmd /c """"%s"" run >> ""%s"" 2>&1""", 0, False
`

type windowsStartup struct{}

func newManager() Manager { return windowsStartup{} }

func (windowsStartup) Describe() string { return "Windows Startup folder (runs at login)" }

func startupPath() (string, error) {
	appData := os.Getenv("APPDATA")
	if appData == "" {
		return "", fmt.Errorf("APPDATA is not set")
	}
	dir := filepath.Join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup")
	return filepath.Join(dir, launcherName), nil
}

// hidden runs a command without flashing a console window.
func hidden(name string, args ...string) (string, error) {
	cmd := exec.Command(name, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.CombinedOutput()
	return string(out), err
}

func (w windowsStartup) Install(execPath string) error {
	path, err := startupPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create Startup folder: %w", err)
	}

	log, err := logPath("")
	if err != nil {
		return err
	}

	script := fmt.Sprintf(vbsTemplate, execPath, log)
	if err := os.WriteFile(path, []byte(script), 0o644); err != nil {
		return fmt.Errorf("write startup launcher: %w", err)
	}

	// Start it now rather than making the user log out and back in.
	if err := w.start(execPath); err != nil {
		return err
	}
	return nil
}

// start launches the agent detached, through the same hidden launcher the
// login path uses, so both routes behave identically.
func (w windowsStartup) start(execPath string) error {
	_ = w.stop(execPath) // no duplicate agents

	path, err := startupPath()
	if err != nil {
		return err
	}
	if _, err := hidden("wscript.exe", path); err != nil {
		return fmt.Errorf("start agent: %w", err)
	}
	return nil
}

// stop kills running copies of this executable — except this process.
//
// The exclusion is essential, not defensive: `agent uninstall` runs from the
// same binary, so an unfiltered taskkill terminates the very command doing the
// uninstalling, and the launcher never gets deleted.
func (w windowsStartup) stop(execPath string) error {
	name := filepath.Base(execPath)
	_, _ = hidden("taskkill", "/F", "/IM", name, "/FI", notSelf())
	return nil
}

// notSelf is a taskkill/tasklist filter excluding the current process.
func notSelf() string {
	return fmt.Sprintf("PID ne %d", os.Getpid())
}

func (w windowsStartup) Uninstall() error {
	path, err := startupPath()
	if err != nil {
		return err
	}

	// The launcher goes first. If stopping the agent were to fail — or to kill
	// this process — the file would otherwise survive and it would come back at
	// the next login.
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("remove startup launcher: %w", err)
	}

	if execPath, err := ExecutablePath(); err == nil {
		_ = w.stop(execPath)
	}
	return nil
}

func (w windowsStartup) Status() (State, error) {
	path, err := startupPath()
	if err != nil {
		return StateUnknown, err
	}
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return StateNotInstalled, nil
	}

	execPath, err := ExecutablePath()
	if err != nil {
		return StateUnknown, nil
	}

	// tasklist is the dependency-free way to ask "is it up?". Excluding this
	// process matters: `agent status` runs the same binary, so without the
	// filter it would always find itself and report running.
	base := filepath.Base(execPath)
	out, err := hidden("tasklist", "/fi", "imagename eq "+base, "/fi", notSelf(), "/nh")
	if err != nil {
		return StateUnknown, nil
	}
	if strings.Contains(strings.ToLower(out), strings.ToLower(base)) {
		return StateRunning, nil
	}
	return StateStopped, nil
}
