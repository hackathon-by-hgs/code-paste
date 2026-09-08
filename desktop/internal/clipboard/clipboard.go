// Package clipboard is the OS clipboard boundary.
//
// Backends are per-platform (see clipboard_windows.go, clipboard_unix.go) and
// all share the polling, change-detection and echo-suppression logic in
// poller.go. A file-backed provider (file.go) stands in for the OS clipboard so
// two agents can be demonstrated on one machine, where they would otherwise
// share a single real clipboard and prove nothing.
package clipboard

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

var (
	// ErrNotImplemented means no backend is available on this platform.
	ErrNotImplemented = errors.New("clipboard: no backend available for this platform")
	// ErrUnsupportedContentType means the backend cannot carry that type.
	ErrUnsupportedContentType = errors.New("clipboard: unsupported content type")
)

// Content is one clipboard item.
//
// Size limits are policy and come from the roster or GET /protocol — never a
// constant in this package.
type Content struct {
	ContentType string // "text/plain" | "image/png" | "image/jpeg"
	Data        []byte
}

// Provider reads and writes the clipboard.
//
// Implementations MUST NOT log Content.Data at any level — it is user clipboard
// content, which is exactly what this project exists to keep private.
type Provider interface {
	Read(ctx context.Context) (*Content, error)
	Write(ctx context.Context, content *Content) error

	// Watch emits an item each time the clipboard changes, closing the channel
	// when ctx is done. It must not re-emit content this agent just wrote, or
	// two devices bounce the same item back and forth forever.
	Watch(ctx context.Context) (<-chan Content, error)
}

// New builds a provider from a spec:
//
//	""            the real OS clipboard
//	"os"          the same, explicitly
//	"file:<path>" a file standing in for the clipboard, for single-machine tests
func New(spec string) (Provider, error) {
	switch {
	case spec == "" || spec == "os":
		return newPlatformProvider()
	case strings.HasPrefix(spec, "file:"):
		path := strings.TrimPrefix(spec, "file:")
		if path == "" {
			return nil, errors.New("clipboard: file: needs a path")
		}
		return NewFile(path), nil
	default:
		return nil, fmt.Errorf("clipboard: unknown provider %q", spec)
	}
}

// Unsupported fails cleanly where no backend exists.
type Unsupported struct{}

func (Unsupported) Read(context.Context) (*Content, error) { return nil, ErrNotImplemented }
func (Unsupported) Write(context.Context, *Content) error  { return ErrNotImplemented }
func (Unsupported) Watch(context.Context) (<-chan Content, error) {
	return nil, ErrNotImplemented
}
