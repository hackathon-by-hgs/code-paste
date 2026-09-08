package clipboard

import (
	"errors"
	"os"
	"path/filepath"
)

// File is a file standing in for the OS clipboard.
//
// Two agents on one machine share a single real clipboard, so a same-machine
// demo of clipboard *sync* proves nothing: the content is already in both
// places. Pointing one agent at a file gives the second endpoint somewhere
// independent to land, which makes the round trip observable:
//
//	agent A (real clipboard)  <--LAN-->  agent B (file)
//
// Copy something on the desktop and it appears in the file; write the file and
// it lands on the real clipboard, ready to paste.
//
// Testing aid only. It is not secure storage: the content sits in plaintext on
// disk, which is exactly what the real product avoids.
type File struct {
	*polled
	path string
}

func NewFile(path string) *File {
	backend := &fileBackend{path: path}
	return &File{polled: newPolled(backend), path: path}
}

// Path is where this provider reads and writes.
func (f *File) Path() string { return f.path }

type fileBackend struct {
	path string
}

func (b *fileBackend) read() (*Content, error) {
	data, err := os.ReadFile(b.path)
	if errors.Is(err, os.ErrNotExist) {
		return &Content{ContentType: "text/plain"}, nil
	}
	if err != nil {
		return nil, err
	}
	return &Content{ContentType: "text/plain", Data: data}, nil
}

func (b *fileBackend) write(content *Content) error {
	if err := os.MkdirAll(filepath.Dir(b.path), 0o700); err != nil {
		return err
	}
	// 0600: this file holds clipboard content.
	return os.WriteFile(b.path, content.Data, 0o600)
}
