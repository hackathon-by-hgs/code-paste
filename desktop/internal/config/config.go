// Package config resolves agent settings.
//
// Three sources, in precedence order:
//
//  1. environment variables — for developers and one-off overrides
//  2. the saved config file — written by `agent install`, read by the service
//  3. values baked in at build time via -ldflags
//
// (2) and (3) exist so a user never has to set an environment variable. A
// background service started at login has no shell to inherit one from, so
// anything it needs must be resolvable without.
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// DefaultAPIURL is set at build time:
//
//	-ldflags "-X github.com/hackathon-by-hgs/code-paste/desktop/internal/config.DefaultAPIURL=https://…"
//
// A build without it still works; the user supplies the URL once and `install`
// saves it.
var DefaultAPIURL = ""

// ErrMissingAPIURL is returned rather than defaulting to localhost. A silent
// fallback is how an agent ends up pointing at nothing.
var ErrMissingAPIURL = errors.New(
	"no control-plane URL: set CODEPASTE_API_URL once, or use a build with one compiled in")

// DefaultListenPort is the LAN peer port.
const DefaultListenPort = 47_800

const configFileName = "config.json"

type Config struct {
	// APIURL is the control-plane ORIGIN. /v1 is appended by the client.
	APIURL string `json:"apiUrl"`
	// StateDir holds fallback credentials; empty means the OS user config dir.
	StateDir string `json:"stateDir,omitempty"`
	LogLevel string `json:"logLevel,omitempty"`

	// ListenPort is where this agent accepts peer connections.
	ListenPort uint16 `json:"listenPort,omitempty"`
	// Peers is a comma-separated host:port list. Empty means mDNS only.
	Peers string `json:"peers,omitempty"`
	// Clipboard selects the provider: "" / "os", or "file:<path>" for tests.
	Clipboard string `json:"clipboard,omitempty"`
	// MDNS enables local-network discovery. On unless explicitly disabled.
	MDNS bool `json:"mdns"`
	// KeyAccount names the credential-store entry, so two agents can coexist
	// on one machine without fighting over the same secret.
	KeyAccount string `json:"keyAccount,omitempty"`
}

// Dir is where the agent keeps its config file.
func Dir() (string, error) {
	if override := env("CODEPASTE_STATE_DIR"); override != "" {
		return override, nil
	}
	base, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("resolve user config dir: %w", err)
	}
	return filepath.Join(base, "code-paste"), nil
}

// Path is the config file location.
func Path() (string, error) {
	dir, err := Dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, configFileName), nil
}

// loadFile reads the saved config, returning a zero value when absent or
// unreadable — a corrupt file must not stop the agent starting.
func loadFile() (Config, bool) {
	path, err := Path()
	if err != nil {
		return Config{}, false
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return Config{}, false
	}
	var saved Config
	if err := json.Unmarshal(raw, &saved); err != nil {
		return Config{}, false
	}
	return saved, true
}

// Save persists the resolved config so a background service can start without
// any environment at all.
func (c *Config) Save() error {
	dir, err := Dir()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create config dir: %w", err)
	}

	raw, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return fmt.Errorf("encode config: %w", err)
	}

	// 0600: no secrets here today, but it sits beside things that are.
	if err := os.WriteFile(filepath.Join(dir, configFileName), raw, 0o600); err != nil {
		return fmt.Errorf("write config: %w", err)
	}
	return nil
}

func env(name string) string { return strings.TrimSpace(os.Getenv(name)) }

// pick returns the first non-empty value.
func pick(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

func Load() (*Config, error) {
	saved, hasSaved := loadFile()

	apiURL := pick(env("CODEPASTE_API_URL"), saved.APIURL, DefaultAPIURL)
	if apiURL == "" {
		return nil, ErrMissingAPIURL
	}

	port := uint16(DefaultListenPort)
	if saved.ListenPort != 0 {
		port = saved.ListenPort
	}
	if raw := env("CODEPASTE_LISTEN_PORT"); raw != "" {
		parsed, err := strconv.ParseUint(raw, 10, 16)
		if err != nil || parsed == 0 {
			return nil, fmt.Errorf("CODEPASTE_LISTEN_PORT must be a port number, got %q", raw)
		}
		port = uint16(parsed)
	}

	// mDNS defaults on. A saved file records a deliberate choice, so it wins
	// over the default; the environment still wins over both.
	mdns := true
	if hasSaved {
		mdns = saved.MDNS
	}
	if raw := env("CODEPASTE_MDNS"); raw != "" {
		mdns = !strings.EqualFold(raw, "off")
	}

	return &Config{
		APIURL:     apiURL,
		StateDir:   pick(env("CODEPASTE_STATE_DIR"), saved.StateDir),
		LogLevel:   pick(env("CODEPASTE_LOG_LEVEL"), saved.LogLevel, "info"),
		ListenPort: port,
		Peers:      pick(env("CODEPASTE_PEERS"), saved.Peers),
		Clipboard:  pick(env("CODEPASTE_CLIPBOARD"), saved.Clipboard),
		MDNS:       mdns,
		KeyAccount: pick(env("CODEPASTE_KEY_ACCOUNT"), saved.KeyAccount),
	}, nil
}
