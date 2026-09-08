//go:build !windows

package tty

// OwnsConsole is always false off Windows.
//
// macOS and Linux do not hand a GUI-launched binary its own console window that
// disappears on exit — a double-clicked binary either runs in the user's
// terminal app or not at all — so there is nothing to compensate for.
func OwnsConsole() bool { return false }
