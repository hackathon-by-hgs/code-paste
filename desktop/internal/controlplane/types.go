// Package controlplane is the client for the control plane described by
// contracts/openapi/control-plane.yaml (pinned by CONTRACTS_VERSION).
//
// It handles identity, device registration and authorization. It carries no
// clipboard content in either direction — that is the data plane's job.
package controlplane

// Structs here intentionally omit `,omitempty` on required fields and ignore
// unknown response fields: new optional fields ship inside /v1 (ADR-008), and a
// strict decoder would break the agent on a backend deploy.

type ProtocolPolicy struct {
	APIVersion                string         `json:"apiVersion"`
	SupportedProtocolVersions []int          `json:"supportedProtocolVersions"`
	CurrentProtocolVersion    int            `json:"currentProtocolVersion"`
	ContractsVersion          string         `json:"contractsVersion"`
	Limits                    map[string]int `json:"limits"`
}

// Supports reports whether the server accepts the protocol version we speak.
func (p ProtocolPolicy) Supports(version int) bool {
	for _, v := range p.SupportedProtocolVersions {
		if v == version {
			return true
		}
	}
	return false
}

type User struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	CreatedAt string `json:"createdAt"`
}

type TokenPair struct {
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
	TokenType    string `json:"tokenType"`
	ExpiresIn    int    `json:"expiresIn"`
	User         User   `json:"user"`
}

type Capabilities struct {
	ContentTypes    []string `json:"contentTypes"`
	MaxPayloadBytes int      `json:"maxPayloadBytes,omitempty"`
}

type Device struct {
	ID              string       `json:"id"`
	Name            string       `json:"name"`
	Platform        string       `json:"platform"`
	AppVersion      string       `json:"appVersion"`
	ProtocolVersion int          `json:"protocolVersion"`
	PublicKey       string       `json:"publicKey"`
	KeyFingerprint  string       `json:"keyFingerprint"`
	Capabilities    Capabilities `json:"capabilities"`
	SyncEnabled     bool         `json:"syncEnabled"`
	Revoked         bool         `json:"revoked"`
	RevokedAt       *string      `json:"revokedAt"`
	LastSeenAt      *string      `json:"lastSeenAt"`
	CreatedAt       string       `json:"createdAt"`
}

// RegisterDeviceRequest is authorised by a pairing code, not a bearer token —
// the agent has no session yet.
type RegisterDeviceRequest struct {
	PairingCode     string       `json:"pairingCode"`
	Name            string       `json:"name"`
	Platform        string       `json:"platform"`
	AppVersion      string       `json:"appVersion"`
	ProtocolVersion int          `json:"protocolVersion"`
	PublicKey       string       `json:"publicKey"`
	Capabilities    Capabilities `json:"capabilities"`
}

// DeviceRegistration is the only time device credentials are issued.
type DeviceRegistration struct {
	Device      Device    `json:"device"`
	Credentials TokenPair `json:"credentials"`
}

type Me struct {
	User      User    `json:"user"`
	Principal string  `json:"principal"` // "browser" | "device"
	Device    *Device `json:"device"`
}

// SignedPeerRoster is detached-signed opaque bytes. Verify before parsing.
type SignedPeerRoster struct {
	Payload   string          `json:"payload"` // base64 of the UTF-8 JSON PeerRoster
	Signature RosterSignature `json:"signature"`
}

type RosterSignature struct {
	Algorithm string `json:"algorithm"`
	KeyID     string `json:"keyId"`
	Value     string `json:"value"`
}

type RosterKey struct {
	KeyID     string `json:"keyId"`
	Algorithm string `json:"algorithm"`
	PublicKey string `json:"publicKey"`
}

type RosterKeyList struct {
	Keys []RosterKey `json:"keys"`
}

// PeerRoster is the decoded payload — only ever produced after a successful
// signature check. See roster.go.
type PeerRoster struct {
	ProtocolVersion int            `json:"protocolVersion"`
	RosterVersion   int64          `json:"rosterVersion"`
	IssuedAt        string         `json:"issuedAt"`
	ExpiresAt       string         `json:"expiresAt"`
	Self            RosterSelf     `json:"self"`
	Peers           []Peer         `json:"peers"`
	Limits          map[string]int `json:"limits"`
}

type RosterSelf struct {
	DeviceID       string `json:"deviceId"`
	UserID         string `json:"userId"`
	KeyFingerprint string `json:"keyFingerprint"`
}

type Peer struct {
	DeviceID        string       `json:"deviceId"`
	UserID          string       `json:"userId"`
	PublicKey       string       `json:"publicKey"`
	KeyFingerprint  string       `json:"keyFingerprint"`
	Platform        string       `json:"platform"`
	ProtocolVersion int          `json:"protocolVersion"`
	Capabilities    Capabilities `json:"capabilities"`
	Scope           string       `json:"scope"`
	SessionID       *string      `json:"sessionId"`
}
