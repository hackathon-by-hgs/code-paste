// Package config resolves agent settings from the environment.
package config

import (
	"errors"
	"os"
	"strings"
)

// ErrMissingAPIURL is returned rather than defaulting to localhost. A silent
// fallback is how an agent ends up pointing at nothing.
var ErrMissingAPIURL = errors.New("CODEPASTE_API_URL is not set (control-plane origin, without /v1)")

type Config struct {
	// APIURL is the control-plane ORIGIN. /v1 is appended by the client.
	APIURL string
	// StateDir holds device credentials; empty means the OS user config dir.
	StateDir string
	LogLevel string
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

	return &Config{
		APIURL:   apiURL,
		StateDir: strings.TrimSpace(os.Getenv("CODEPASTE_STATE_DIR")),
		LogLevel: level,
	}, nil
}
