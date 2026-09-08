package discovery

import (
	"context"
	"errors"
	"sync"
)

// Multi runs several discoverers at once and merges their candidates.
//
// mDNS and a static list are complements, not alternatives: mDNS makes the
// common case seamless, while a configured address still reaches a peer on
// another subnet, or on a network where multicast is filtered — which is
// common on corporate and guest wifi.
type Multi struct {
	sources []Discoverer
}

func NewMulti(sources ...Discoverer) *Multi {
	return &Multi{sources: sources}
}

// Announce publishes on every source, tolerating individual failures.
//
// mDNS failing (no multicast route, a firewall) must not stop the agent: the
// static path still works, and discovery is not what makes anything secure.
func (m *Multi) Announce(ctx context.Context, fingerprint string, port uint16) error {
	var errs []error
	for _, source := range m.sources {
		if err := source.Announce(ctx, fingerprint, port); err != nil {
			errs = append(errs, err)
		}
	}
	if len(errs) == len(m.sources) && len(errs) > 0 {
		return errors.Join(errs...)
	}
	return nil
}

// Browse fans in every source onto one channel, closing it when all are done.
func (m *Multi) Browse(ctx context.Context) (<-chan Candidate, error) {
	out := make(chan Candidate)

	var wg sync.WaitGroup
	started := 0

	for _, source := range m.sources {
		channel, err := source.Browse(ctx)
		if err != nil {
			continue // a source that cannot start is skipped, not fatal
		}
		started++
		wg.Add(1)

		go func(in <-chan Candidate) {
			defer wg.Done()
			for candidate := range in {
				select {
				case out <- candidate:
				case <-ctx.Done():
					return
				}
			}
		}(channel)
	}

	if started == 0 {
		close(out)
		return out, errors.New("discovery: no source could start")
	}

	go func() {
		wg.Wait()
		close(out)
	}()

	return out, nil
}
