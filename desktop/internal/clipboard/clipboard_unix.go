//go:build darwin || linux

package clipboard

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"runtime"
	"time"
)

// macOS and Linux go through the standard command-line clipboard tools rather
// than linking against Cocoa or X11, which would require cgo and break the
// static cross-compilation the release build depends on.

const toolTimeout = 3 * time.Second

type command struct {
	name string
	args []string
}

type unixClipboard struct {
	copyCmd  command
	pasteCmd command
}

func (u unixClipboard) read() (*Content, error) {
	ctx, cancel := context.WithTimeout(context.Background(), toolTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, u.pasteCmd.name, u.pasteCmd.args...)
	var out bytes.Buffer
	cmd.Stdout = &out
	if err := cmd.Run(); err != nil {
		// An empty clipboard makes some tools exit non-zero; treat it as empty
		// rather than as a failure that would kill the watcher.
		return &Content{ContentType: "text/plain"}, nil
	}
	return &Content{ContentType: "text/plain", Data: out.Bytes()}, nil
}

func (u unixClipboard) write(content *Content) error {
	if content.ContentType != "text/plain" {
		return fmt.Errorf("%w: %s", ErrUnsupportedContentType, content.ContentType)
	}

	ctx, cancel := context.WithTimeout(context.Background(), toolTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, u.copyCmd.name, u.copyCmd.args...)
	cmd.Stdin = bytes.NewReader(content.Data)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("%s: %w", u.copyCmd.name, err)
	}
	return nil
}

func lookPath(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}

func newPlatformProvider() (Provider, error) {
	if runtime.GOOS == "darwin" {
		return newPolled(unixClipboard{
			copyCmd:  command{name: "pbcopy"},
			pasteCmd: command{name: "pbpaste"},
		}), nil
	}

	// Wayland first: on a Wayland session the X11 tools either fail or talk to
	// a compatibility layer that does not see native Wayland clients.
	switch {
	case lookPath("wl-copy") && lookPath("wl-paste"):
		return newPolled(unixClipboard{
			copyCmd:  command{name: "wl-copy"},
			pasteCmd: command{name: "wl-paste", args: []string{"--no-newline"}},
		}), nil
	case lookPath("xclip"):
		return newPolled(unixClipboard{
			copyCmd:  command{name: "xclip", args: []string{"-selection", "clipboard"}},
			pasteCmd: command{name: "xclip", args: []string{"-selection", "clipboard", "-o"}},
		}), nil
	case lookPath("xsel"):
		return newPolled(unixClipboard{
			copyCmd:  command{name: "xsel", args: []string{"--clipboard", "--input"}},
			pasteCmd: command{name: "xsel", args: []string{"--clipboard", "--output"}},
		}), nil
	}

	return nil, fmt.Errorf("%w: install wl-clipboard, xclip or xsel", ErrNotImplemented)
}
