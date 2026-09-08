// Package clipboard is the OS clipboard boundary.
//
// NOT IMPLEMENTED. This package defines the interface the daemon codes against
// so the rest of the agent can be built and tested without an OS dependency.
// Implementing it needs a per-platform backend (macOS NSPasteboard, Windows
// clipboard API, Linux X11/Wayland) and is the first thing to pick up.
package clipboard

import (
	"context"
	"errors"
)

// ErrNotImplemented marks the unimplemented platform backends.
var ErrNotImplemented = errors.New("clipboard: not implemented for this platform")

// Content is one clipboard item. Only MVP content types are permitted; the
// authoritative size limits come from the roster, never from a constant here.
type Content struct {
	ContentType string // "text/plain" | "image/png" | "image/jpeg"
	Data        []byte
}

// Provider reads and writes the OS clipboard.
//
// Implementations MUST NOT log Content.Data at any level — it is user clipboard
// content, which is exactly what this project exists to keep private.
type Provider interface {
	// Read returns the current clipboard content.
	Read(ctx context.Context) (*Content, error)

	// Write replaces the clipboard content with data received from a peer.
	Write(ctx context.Context, content *Content) error

	// Watch emits an item each time the OS clipboard changes. It closes the
	// channel when ctx is done. Implementations should coalesce rapid changes
	// and must not emit content this agent just wrote, or two devices will
	// bounce the same item back and forth forever.
	Watch(ctx context.Context) (<-chan Content, error)
}

// Unsupported is a Provider that fails cleanly on platforms with no backend
// yet, so the daemon degrades instead of panicking.
type Unsupported struct{}

func (Unsupported) Read(context.Context) (*Content, error) { return nil, ErrNotImplemented }
func (Unsupported) Write(context.Context, *Content) error  { return ErrNotImplemented }
func (Unsupported) Watch(context.Context) (<-chan Content, error) {
	return nil, ErrNotImplemented
}
