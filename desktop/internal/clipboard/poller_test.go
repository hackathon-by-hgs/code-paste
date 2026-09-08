package clipboard

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestFileProviderWatchEmitsOnChange(t *testing.T) {
	path := filepath.Join(t.TempDir(), "clip.txt")
	if err := os.WriteFile(path, []byte("seed"), 0o600); err != nil {
		t.Fatalf("seed: %v", err)
	}

	provider := NewFile(path)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	changes, err := provider.Watch(ctx)
	if err != nil {
		t.Fatalf("watch: %v", err)
	}

	// The seed must NOT be emitted: it was already there when we started.
	select {
	case got := <-changes:
		t.Fatalf("seed content was emitted: %q", got.Data)
	case <-time.After(1 * time.Second):
	}

	if err := os.WriteFile(path, []byte("changed"), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}

	select {
	case got := <-changes:
		if string(got.Data) != "changed" {
			t.Errorf("got %q, want %q", got.Data, "changed")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("no change emitted")
	}
}

// Content written through the provider must not come back out of Watch, or two
// devices bounce the same item between them forever.
func TestWriteIsNotEchoedBack(t *testing.T) {
	path := filepath.Join(t.TempDir(), "clip.txt")
	provider := NewFile(path)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	changes, err := provider.Watch(ctx)
	if err != nil {
		t.Fatalf("watch: %v", err)
	}

	if err := provider.Write(ctx, &Content{ContentType: "text/plain", Data: []byte("from a peer")}); err != nil {
		t.Fatalf("write: %v", err)
	}

	select {
	case got := <-changes:
		t.Fatalf("peer content was echoed back: %q", got.Data)
	case <-time.After(2 * time.Second):
		// Correct: suppressed.
	}
}
