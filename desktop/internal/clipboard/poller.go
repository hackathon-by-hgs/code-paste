package clipboard

import (
	"bytes"
	"context"
	"crypto/sha256"
	"sync"
	"time"
)

// pollInterval is how often the OS clipboard is sampled. Every desktop OS
// either lacks a change notification or exposes one only through a native
// message loop, so polling is the portable option. 400ms is below the
// threshold where a paste feels delayed, and the work is a cheap read.
const pollInterval = 400 * time.Millisecond

// echoSuppressor stops the ping-pong.
//
// When a peer's content is written to this clipboard, the watcher sees a change
// and would send it straight back, whereupon the peer does the same, forever.
// Recording the digest of everything we write locally, and skipping a change
// that matches, breaks the loop.
type echoSuppressor struct {
	mu     sync.Mutex
	digest [32]byte
	set    bool
}

func (e *echoSuppressor) remember(content *Content) {
	sum := digestOf(content)
	e.mu.Lock()
	defer e.mu.Unlock()
	e.digest = sum
	e.set = true
}

// isEcho reports whether this content is the one we just wrote.
func (e *echoSuppressor) isEcho(content *Content) bool {
	sum := digestOf(content)
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.set && e.digest == sum
}

func digestOf(content *Content) [32]byte {
	h := sha256.New()
	h.Write([]byte(content.ContentType))
	h.Write([]byte{0})
	h.Write(content.Data)
	var out [32]byte
	copy(out[:], h.Sum(nil))
	return out
}

// readWriter is the per-platform surface each backend implements.
type readWriter interface {
	read() (*Content, error)
	write(*Content) error
}

// polled turns a read/write backend into a full Provider by sampling for
// changes. Shared by every platform so the echo and coalescing logic exists
// once rather than three times.
type polled struct {
	backend  readWriter
	suppress echoSuppressor
}

func newPolled(backend readWriter) *polled {
	return &polled{backend: backend}
}

func (p *polled) Read(context.Context) (*Content, error) {
	return p.backend.read()
}

func (p *polled) Write(_ context.Context, content *Content) error {
	// Remember before writing: the watcher may observe the change the instant
	// the write lands, and must already know to ignore it.
	p.suppress.remember(content)
	return p.backend.write(content)
}

func (p *polled) Watch(ctx context.Context) (<-chan Content, error) {
	// Seed from the current contents so the item already on the clipboard when
	// the agent starts is not immediately broadcast as though it were new.
	var last []byte
	var lastType string
	if current, err := p.backend.read(); err == nil {
		last, lastType = current.Data, current.ContentType
	}

	out := make(chan Content)

	go func() {
		defer close(out)
		ticker := time.NewTicker(pollInterval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}

			current, err := p.backend.read()
			if err != nil || current == nil {
				continue // a transient read failure is not worth killing the watcher
			}
			if current.ContentType == lastType && bytes.Equal(current.Data, last) {
				continue
			}

			last, lastType = current.Data, current.ContentType

			if p.suppress.isEcho(current) {
				continue // this is what a peer just sent us
			}
			if len(current.Data) == 0 {
				continue
			}

			select {
			case out <- *current:
			case <-ctx.Done():
				return
			}
		}
	}()

	return out, nil
}
