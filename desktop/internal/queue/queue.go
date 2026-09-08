// Package queue holds outbound clipboard items awaiting delivery to peers.
//
// PARTIALLY IMPLEMENTED: an in-memory bounded ring is provided so the daemon
// has something real to code against. It is intentionally NOT durable.
//
// Persisting clipboard content to disk would turn a transient item into a
// lasting artifact and hand an attacker with disk access a clipboard history —
// exactly what this project exists to avoid. If durability is ever needed, it
// needs an ADR and encryption at rest, not a quiet change here.
package queue

import (
	"sync"

	"github.com/hackathon-by-hgs/code-paste/desktop/internal/clipboard"
)

// Ring is a fixed-capacity FIFO that drops the oldest item when full.
//
// Dropping beats blocking: a slow or absent peer must never stall the
// clipboard watcher, and a stale clipboard item has little value anyway.
type Ring struct {
	mu    sync.Mutex
	items []clipboard.Content
	cap   int
	// dropped counts items evicted unsent, for diagnostics.
	dropped int
}

func NewRing(capacity int) *Ring {
	if capacity < 1 {
		capacity = 1
	}
	return &Ring{items: make([]clipboard.Content, 0, capacity), cap: capacity}
}

// Push appends an item, evicting the oldest if the ring is full.
func (r *Ring) Push(item clipboard.Content) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if len(r.items) == r.cap {
		r.items = r.items[1:]
		r.dropped++
	}
	r.items = append(r.items, item)
}

// Pop removes and returns the oldest item.
func (r *Ring) Pop() (clipboard.Content, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if len(r.items) == 0 {
		return clipboard.Content{}, false
	}
	item := r.items[0]
	r.items = r.items[1:]
	return item, true
}

func (r *Ring) Len() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.items)
}

// Dropped reports how many items were evicted unsent.
func (r *Ring) Dropped() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.dropped
}

// Clear discards everything held. Called on revocation so no clipboard content
// outlives the agent's authorization.
func (r *Ring) Clear() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.items = r.items[:0]
}
