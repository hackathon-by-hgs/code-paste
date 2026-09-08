//go:build windows

package clipboard

import (
	"fmt"
	"syscall"
	"time"
	"unsafe"
)

// Windows clipboard via user32/kernel32.
//
// Called through syscall.NewLazyDLL rather than golang.org/x/sys/windows to
// keep the agent dependency-free. Only CF_UNICODETEXT is handled; images are a
// separate format and are not in the MVP content set.

var (
	user32   = syscall.NewLazyDLL("user32.dll")
	kernel32 = syscall.NewLazyDLL("kernel32.dll")

	openClipboard      = user32.NewProc("OpenClipboard")
	closeClipboard     = user32.NewProc("CloseClipboard")
	emptyClipboard     = user32.NewProc("EmptyClipboard")
	getClipboardData   = user32.NewProc("GetClipboardData")
	setClipboardData   = user32.NewProc("SetClipboardData")
	isClipboardaFormat = user32.NewProc("IsClipboardFormatAvailable")

	globalAlloc  = kernel32.NewProc("GlobalAlloc")
	globalFree   = kernel32.NewProc("GlobalFree")
	globalLock   = kernel32.NewProc("GlobalLock")
	globalUnlock = kernel32.NewProc("GlobalUnlock")
)

const (
	cfUnicodeText = 13
	gmemMoveable  = 0x0002
)

type windowsClipboard struct{}

// open retries briefly: the clipboard is a single global resource and another
// process may hold it for a moment. Failing a whole poll tick over that would
// make the watcher unreliable.
func (windowsClipboard) open() error {
	var lastErr error
	for attempt := 0; attempt < 10; attempt++ {
		ret, _, err := openClipboard.Call(0)
		if ret != 0 {
			return nil
		}
		lastErr = err
		time.Sleep(10 * time.Millisecond)
	}
	return fmt.Errorf("open clipboard: %v", lastErr)
}

func (c windowsClipboard) read() (*Content, error) {
	available, _, _ := isClipboardaFormat.Call(cfUnicodeText)
	if available == 0 {
		// Not text — an image or nothing at all. Report empty rather than
		// erroring; the poller treats it as "no text to sync".
		return &Content{ContentType: "text/plain"}, nil
	}

	if err := c.open(); err != nil {
		return nil, err
	}
	defer closeClipboard.Call()

	handle, _, err := getClipboardData.Call(cfUnicodeText)
	if handle == 0 {
		return nil, fmt.Errorf("get clipboard data: %v", err)
	}

	ptr, _, err := globalLock.Call(handle)
	if ptr == 0 {
		return nil, fmt.Errorf("lock clipboard memory: %v", err)
	}
	defer globalUnlock.Call(handle)

	text := syscall.UTF16ToString(utf16SliceAt(ptr))
	return &Content{ContentType: "text/plain", Data: []byte(text)}, nil
}

func (c windowsClipboard) write(content *Content) error {
	if content.ContentType != "text/plain" {
		return fmt.Errorf("%w: %s", ErrUnsupportedContentType, content.ContentType)
	}

	encoded, err := syscall.UTF16FromString(string(content.Data))
	if err != nil {
		return fmt.Errorf("encode clipboard text: %w", err)
	}

	if err := c.open(); err != nil {
		return err
	}
	defer closeClipboard.Call()

	if ret, _, err := emptyClipboard.Call(); ret == 0 {
		return fmt.Errorf("empty clipboard: %v", err)
	}

	size := uintptr(len(encoded) * 2)
	handle, _, err := globalAlloc.Call(gmemMoveable, size)
	if handle == 0 {
		return fmt.Errorf("allocate clipboard memory: %v", err)
	}

	ptr, _, err := globalLock.Call(handle)
	if ptr == 0 {
		globalFree.Call(handle)
		return fmt.Errorf("lock clipboard memory: %v", err)
	}
	copy(unsafe.Slice((*uint16)(unsafe.Pointer(ptr)), len(encoded)), encoded)
	globalUnlock.Call(handle)

	if ret, _, err := setClipboardData.Call(cfUnicodeText, handle); ret == 0 {
		globalFree.Call(handle)
		return fmt.Errorf("set clipboard data: %v", err)
	}
	// Ownership passed to the clipboard on success — freeing here would be a
	// double free.
	return nil
}

// utf16SliceAt walks a NUL-terminated UTF-16 string of unknown length.
func utf16SliceAt(ptr uintptr) []uint16 {
	const maxChars = 1 << 22 // 4M chars: far above any sane clipboard text
	slice := unsafe.Slice((*uint16)(unsafe.Pointer(ptr)), maxChars)
	for i, v := range slice {
		if v == 0 {
			return slice[:i]
		}
	}
	return slice
}

func newPlatformProvider() (Provider, error) {
	return newPolled(windowsClipboard{}), nil
}
