// Package config resolves agent settings from the environment.
package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
)

// ErrMissingAPIURL is returned rather than defaulting to localhost. A silent
// fallback is how an agent ends up pointing at nothing.
var ErrMissingAPIURL = errors.New("CODEPASTE_API_URL is not set (control-plane origin, without /v1)")

// DefaultListenPort is the LAN peer port.
const DefaultListenPort = 47_800

type Config struct {
	// APIURL is the control-plane ORIGIN. /v1 is appended by the client.
	APIURL string
	// StateDir holds device credentials; empty means the OS user config dir.
	StateDir string
	LogLevel string

	// ListenPort is where this agent accepts peer connections.
	ListenPort uint16
	// Peers is a comma-separated host:port list. Empty means accept-only.
	Peers string
	// Clipboard selects the provider: "" / "os", or "file:<path>" for tests.
	Clipboard string
	// MDNS enables local-network discovery. On unless explicitly disabled.
	MDNS bool
	// KeyAccount names the credential-store entry, so two agents can coexist
	// on one machine without fighting over the same secret.
	KeyAccount string
}

func Load() (*Config, error) {
	apiURL := strings.TrimSpace(os.Getenv("CODEPASTE_API_URL"))
	if apiURL == "" {
		return nil, ErrMissingAPIURL
	}

	level := strings.TrimSpace(os.Getenv("CODEPASTE_LOG_LEVEL"))
	if level == "" {
		level = "info"
	}

	port := uint16(DefaultListenPort)
	if raw := strings.TrimSpace(os.Getenv("CODEPASTE_LISTEN_PORT")); raw != "" {
		parsed, err := strconv.ParseUint(raw, 10, 16)
		if err != nil || parsed == 0 {
			return nil, fmt.Errorf("CODEPASTE_LISTEN_PORT must be a port number, got %q", raw)
		}
		port = uint16(parsed)
	}

	return &Config{
		APIURL:     apiURL,
		StateDir:   strings.TrimSpace(os.Getenv("CODEPASTE_STATE_DIR")),
		LogLevel:   level,
		ListenPort: port,
		Peers:      strings.TrimSpace(os.Getenv("CODEPASTE_PEERS")),
		Clipboard:  strings.TrimSpace(os.Getenv("CODEPASTE_CLIPBOARD")),
		MDNS:       !strings.EqualFold(strings.TrimSpace(os.Getenv("CODEPASTE_MDNS")), "off"),
		KeyAccount: strings.TrimSpace(os.Getenv("CODEPASTE_KEY_ACCOUNT")),
	}, nil
}
