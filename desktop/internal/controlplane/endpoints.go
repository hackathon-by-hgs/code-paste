package controlplane

import (
	"context"
	"net/http"
)

// GetProtocol reports supported protocol versions and payload limits.
// Unauthenticated. Call it before pairing to find out whether this build is
// compatible, and never hardcode the limits — they are policy.
func (c *Client) GetProtocol(ctx context.Context) (*ProtocolPolicy, error) {
	var policy ProtocolPolicy
	if err := c.do(ctx, requestSpec{method: http.MethodGet, path: "/protocol"}, &policy); err != nil {
		return nil, err
	}
	return &policy, nil
}

// RegisterDevice redeems a pairing code minted by the web app.
//
// Authorised by the code, not a bearer token — the agent has no session yet.
// The response is the only time device credentials are issued, so the caller
// must persist them before doing anything else.
//
// A 401 here covers a wrong, expired *and* already-used code, identically and
// by design: do not try to tell the user which it was.
func (c *Client) RegisterDevice(ctx context.Context, req RegisterDeviceRequest) (*DeviceRegistration, error) {
	var registration DeviceRegistration
	spec := requestSpec{method: http.MethodPost, path: "/devices", body: req}
	if err := c.do(ctx, spec, &registration); err != nil {
		return nil, err
	}

	c.storeTokens(registration.Credentials)
	return &registration, nil
}

// GetMe returns the authenticated principal. `principal` is "device" for us.
func (c *Client) GetMe(ctx context.Context) (*Me, error) {
	var me Me
	spec := requestSpec{method: http.MethodGet, path: "/auth/me", auth: true}
	if err := c.do(ctx, spec, &me); err != nil {
		return nil, err
	}
	return &me, nil
}

// Heartbeat reports liveness. Callable only by the device itself.
//
// Carries no body — liveness is metadata, never content. Writes are coalesced
// server-side to roughly once every five minutes, so a tighter loop than that
// buys nothing.
func (c *Client) Heartbeat(ctx context.Context, deviceID string) error {
	spec := requestSpec{method: http.MethodPost, path: "/devices/" + deviceID + "/heartbeat", auth: true}
	return c.do(ctx, spec, nil)
}

// GetSignedPeerSet fetches the roster as opaque signed bytes.
//
// This returns the *unverified* envelope on purpose. Use RosterVerifier to turn
// it into a PeerRoster; nothing else in the agent may parse the payload.
func (c *Client) GetSignedPeerSet(ctx context.Context) (*SignedPeerRoster, error) {
	var signed SignedPeerRoster
	spec := requestSpec{method: http.MethodGet, path: "/authz/peer-set", auth: true}
	if err := c.do(ctx, spec, &signed); err != nil {
		return nil, err
	}
	return &signed, nil
}

// GetRosterKeys returns the public keys that sign rosters.
//
// Unauthenticated by design, so the agent can verify a cached roster while
// unable to authenticate. Cache these and match on KeyID so rotation does not
// break verification.
func (c *Client) GetRosterKeys(ctx context.Context) (*RosterKeyList, error) {
	var keys RosterKeyList
	if err := c.do(ctx, requestSpec{method: http.MethodGet, path: "/authz/roster-keys"}, &keys); err != nil {
		return nil, err
	}
	return &keys, nil
}
