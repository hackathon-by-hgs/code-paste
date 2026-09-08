// Package daemon wires the agent together: pairing, credential storage, and
// the loops that keep authorization fresh.
//
// What is NOT here yet is the sync path itself — clipboard watch, discovery and
// peer transport are stubs, so the agent currently maintains a verified roster
// and does nothing with it. That is deliberate: authorization is the part that
// has to be right before any byte moves.
package daemon

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"runtime"
	"time"

	"github.com/hackathon-by-hgs/code-paste/desktop/internal/controlplane"
	agentcrypto "github.com/hackathon-by-hgs/code-paste/desktop/internal/crypto"
)

// ErrNotPaired means no stored identity: the user must pair first.
var ErrNotPaired = errors.New("agent is not paired")

// heartbeatInterval matches the server's coalescing window. Anything tighter is
// discarded server-side and buys nothing.
const heartbeatInterval = 5 * time.Minute

// rosterRefreshSlack re-fetches this long before expiry, so a slow network does
// not leave the agent briefly unauthorized.
const rosterRefreshSlack = 60 * time.Second

// Agent owns the device identity and its authorization state.
type Agent struct {
	client   *controlplane.Client
	store    agentcrypto.KeyStore
	log      *slog.Logger
	identity *agentcrypto.Identity
	deviceID string
	verifier *controlplane.RosterVerifier

	roster *controlplane.PeerRoster
}

func New(client *controlplane.Client, store agentcrypto.KeyStore, log *slog.Logger) *Agent {
	return &Agent{client: client, store: store, log: log}
}

// Pair redeems a pairing code minted by the web app.
//
// Generates the keypair locally first: the private half never leaves this
// machine, and the control plane only ever sees the public half.
func (a *Agent) Pair(ctx context.Context, pairingCode, deviceName string) error {
	policy, err := a.client.GetProtocol(ctx)
	if err != nil {
		return fmt.Errorf("check protocol policy: %w", err)
	}
	if !policy.Supports(controlplane.ProtocolVersion) {
		return fmt.Errorf("server does not support protocol v%d (supports %v) — update this agent",
			controlplane.ProtocolVersion, policy.SupportedProtocolVersions)
	}

	identity, err := agentcrypto.GenerateIdentity()
	if err != nil {
		return err
	}

	registration, err := a.client.RegisterDevice(ctx, controlplane.RegisterDeviceRequest{
		PairingCode:     pairingCode,
		Name:            deviceName,
		Platform:        platform(),
		AppVersion:      "0.1.0",
		ProtocolVersion: controlplane.ProtocolVersion,
		PublicKey:       identity.PublicKeyBase64(),
		Capabilities: controlplane.Capabilities{
			ContentTypes: []string{"text/plain"},
		},
	})
	if err != nil {
		return fmt.Errorf("register device: %w", err)
	}

	tokens := a.client.Tokens()
	stored := &agentcrypto.StoredIdentity{
		Seed:         identity.Seed(),
		DeviceID:     registration.Device.ID,
		AccessToken:  tokens.AccessToken,
		RefreshToken: tokens.RefreshToken,
	}
	if err := a.store.Save(stored); err != nil {
		// The credentials exist server-side but we cannot persist them, so the
		// device would be orphaned. Say so loudly rather than appearing to work.
		return fmt.Errorf("device registered but credentials could not be saved: %w", err)
	}

	a.identity = identity
	a.deviceID = registration.Device.ID
	a.log.Info("paired", "deviceId", registration.Device.ID, "fingerprint", identity.Fingerprint())
	return nil
}

// Load restores a previously paired identity.
func (a *Agent) Load() error {
	stored, err := a.store.Load()
	if errors.Is(err, agentcrypto.ErrNotFound) {
		return ErrNotPaired
	}
	if err != nil {
		return err
	}

	identity, err := agentcrypto.IdentityFromSeed(stored.Seed)
	if err != nil {
		return fmt.Errorf("restore identity: %w", err)
	}

	a.identity = identity
	a.deviceID = stored.DeviceID
	a.client.SetTokens(controlplane.Tokens{
		AccessToken:  stored.AccessToken,
		RefreshToken: stored.RefreshToken,
	})
	return nil
}

// PersistTokens is the callback handed to the control-plane client so rotated
// tokens survive a restart. A dropped rotation means re-pairing.
func (a *Agent) PersistTokens(tokens controlplane.Tokens) {
	if a.identity == nil {
		return
	}
	stored := &agentcrypto.StoredIdentity{
		Seed:         a.identity.Seed(),
		DeviceID:     a.deviceID,
		AccessToken:  tokens.AccessToken,
		RefreshToken: tokens.RefreshToken,
	}
	if err := a.store.Save(stored); err != nil {
		a.log.Error("could not persist rotated tokens", "error", err)
	}
}

// prepare confirms we hold a device token and installs the roster signing keys.
func (a *Agent) prepare(ctx context.Context) error {
	if a.identity == nil {
		return ErrNotPaired
	}

	me, err := a.client.GetMe(ctx)
	if err != nil {
		return fmt.Errorf("identify principal: %w", err)
	}
	if me.Principal != "device" {
		// A browser token cannot fetch a roster; failing here beats a 403 loop.
		return fmt.Errorf("expected a device token, got principal %q", me.Principal)
	}

	a.verifier = controlplane.NewRosterVerifier(a.deviceID)
	keys, err := a.client.GetRosterKeys(ctx)
	if err != nil {
		return fmt.Errorf("fetch roster signing keys: %w", err)
	}
	if err := a.verifier.TrustKeys(keys); err != nil {
		return fmt.Errorf("trust roster signing keys: %w", err)
	}
	return nil
}

// FetchRoster does one verified roster fetch and returns it.
//
// This is the "who can receive my clipboard data" answer, for operators.
func (a *Agent) FetchRoster(ctx context.Context) (*controlplane.PeerRoster, error) {
	if err := a.prepare(ctx); err != nil {
		return nil, err
	}
	if _, err := a.refreshRoster(ctx); err != nil {
		return nil, err
	}
	return a.roster, nil
}

// DeviceID is this agent's device id.
func (a *Agent) DeviceID() string { return a.deviceID }

// Fingerprint is this agent's own key fingerprint.
func (a *Agent) Fingerprint() string {
	if a.identity == nil {
		return ""
	}
	return a.identity.Fingerprint()
}

// Run maintains authorization until ctx is cancelled.
func (a *Agent) Run(ctx context.Context) error {
	if err := a.prepare(ctx); err != nil {
		return err
	}

	go a.heartbeatLoop(ctx)
	return a.rosterLoop(ctx)
}

// rosterLoop keeps a verified roster current and drops authorization when it
// cannot.
func (a *Agent) rosterLoop(ctx context.Context) error {
	for {
		wait, err := a.refreshRoster(ctx)

		switch {
		case err == nil:
			a.log.Debug("roster refreshed", "peers", len(a.roster.Peers), "version", a.roster.RosterVersion)

		case controlplane.IsFatal(err):
			// device_revoked or token_reused: authorization is gone for good.
			a.log.Error("authorization revoked; wiping credentials", "code", controlplane.CodeOf(err))
			a.stopSyncing()
			_ = a.store.Clear()
			return err

		default:
			// Unreachable or rejected. The previous roster stays valid until it
			// expires; past that we must stop rather than trust the LAN.
			a.log.Warn("roster refresh failed", "error", err)
			if a.rosterExpired(time.Now()) {
				a.log.Warn("roster expired and cannot be refreshed; syncing halted")
				a.stopSyncing()
			}
			wait = 30 * time.Second
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(wait):
		}
	}
}

// refreshRoster fetches, verifies, and reports how long until the next refresh.
func (a *Agent) refreshRoster(ctx context.Context) (time.Duration, error) {
	signed, err := a.client.GetSignedPeerSet(ctx)
	if err != nil {
		return 0, err
	}

	roster, err := a.verifier.Verify(signed, time.Now())
	if err != nil {
		// A roster that fails verification is not a lesser roster — it is not a
		// roster. Keep whatever we already trusted.
		return 0, fmt.Errorf("roster verification failed: %w", err)
	}
	a.roster = roster

	expiresAt, err := time.Parse(time.RFC3339, roster.ExpiresAt)
	if err != nil {
		return time.Minute, nil
	}
	wait := time.Until(expiresAt) - rosterRefreshSlack
	if wait < 10*time.Second {
		wait = 10 * time.Second
	}
	return wait, nil
}

func (a *Agent) rosterExpired(now time.Time) bool {
	if a.roster == nil {
		return true
	}
	expiresAt, err := time.Parse(time.RFC3339, a.roster.ExpiresAt)
	if err != nil {
		return true
	}
	return !now.Before(expiresAt)
}

// stopSyncing drops the trusted roster. With no roster, no peer is authorized.
func (a *Agent) stopSyncing() {
	a.roster = nil
}

// Roster returns the currently trusted roster, or nil when syncing is halted.
func (a *Agent) Roster() *controlplane.PeerRoster { return a.roster }

func (a *Agent) heartbeatLoop(ctx context.Context) {
	ticker := time.NewTicker(heartbeatInterval)
	defer ticker.Stop()

	for {
		if err := a.client.Heartbeat(ctx, a.deviceID); err != nil && ctx.Err() == nil {
			a.log.Debug("heartbeat failed", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// platform maps GOOS onto the contract's platform enum.
func platform() string {
	switch runtime.GOOS {
	case "darwin":
		return "macos"
	case "windows":
		return "windows"
	default:
		return "linux"
	}
}
