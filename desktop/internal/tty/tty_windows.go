//go:build windows

// Package tty answers one question: did a human double-click this, or run it
// from a shell?
//
// It matters because the two want opposite things. A shell user running
// `agent` with no arguments wants usage printed and the process to exit. A user
// who double-clicked the .exe in Explorer gets a console window that closes
// before they can read a single character — which looks exactly like a crash.
package tty

import (
	"syscall"
	"unsafe"
)

var (
	kernel32              = syscall.NewLazyDLL("kernel32.dll")
	getConsoleProcessList = kernel32.NewProc("GetConsoleProcessList")
)

// OwnsConsole reports whether this process created the console it is attached
// to — which on Windows means it was launched from Explorer rather than from an
// existing shell.
//
// GetConsoleProcessList returns every process attached to the console. Exactly
// one means we are alone in a window Windows opened for us, and that window
// will vanish the moment we return. More than one means a shell is attached
// too, so output survives.
func OwnsConsole() bool {
	var pids [8]uint32
	count, _, _ := getConsoleProcessList.Call(
		uintptr(unsafe.Pointer(&pids[0])),
		uintptr(len(pids)),
	)
	return count == 1
}
