// Command agent is the Code Paste desktop clipboard agent.
//
//	agent pair <PAIRING-CODE> [device name]   redeem a code from the web app
//	agent run                                 maintain authorization
//	agent status                              show local pairing state
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/hackathon-by-hgs/code-paste/desktop/internal/config"
	"github.com/hackathon-by-hgs/code-paste/desktop/internal/controlplane"
	"github.com/hackathon-by-hgs/code-paste/desktop/internal/crypto"
	"github.com/hackathon-by-hgs/code-paste/desktop/internal/daemon"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	if len(os.Args) < 2 {
		usage()
		return errors.New("no command given")
	}

	cfg, err := config.Load()
	if err != nil {
		return err
	}

	logger := newLogger(cfg.LogLevel)

	store, err := crypto.NewFileStore(cfg.StateDir)
	if err != nil {
		return err
	}

	// The agent is constructed before the client so PersistTokens can be wired
	// as the rotation callback — a rotated token that is not saved is a token
	// that forces re-pairing on the next start.
	var agent *daemon.Agent
	client := controlplane.NewClient(cfg.APIURL, func(t controlplane.Tokens) {
		agent.PersistTokens(t)
	})
	agent = daemon.New(client, store, logger)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	switch os.Args[1] {
	case "pair":
		if len(os.Args) < 3 {
			return errors.New("usage: agent pair <PAIRING-CODE> [device name]")
		}
		name := defaultDeviceName()
		if len(os.Args) > 3 {
			name = strings.Join(os.Args[3:], " ")
		}
		if err := agent.Pair(ctx, strings.ToUpper(os.Args[2]), name); err != nil {
			return err
		}
		fmt.Println("Paired. Run `agent run` to start.")
		return nil

	case "run":
		if err := agent.Load(); err != nil {
			if errors.Is(err, daemon.ErrNotPaired) {
				return errors.New("not paired — mint a code in the web app, then run: agent pair <CODE>")
			}
			return err
		}
		logger.Info("agent starting", "api", cfg.APIURL)
		if err := agent.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
			return err
		}
		logger.Info("agent stopped")
		return nil

	case "status":
		if err := agent.Load(); err != nil {
			if errors.Is(err, daemon.ErrNotPaired) {
				fmt.Println("Not paired.")
				return nil
			}
			return err
		}
		fmt.Printf("Paired. State file: %s\n", store.Path())
		return nil

	default:
		usage()
		return fmt.Errorf("unknown command %q", os.Args[1])
	}
}

func usage() {
	fmt.Fprint(os.Stderr, `Code Paste desktop agent

  agent pair <PAIRING-CODE> [device name]   redeem a code minted in the web app
  agent run                                 maintain authorization
  agent status                              show local pairing state

Environment: see .env.example (CODEPASTE_API_URL is required).
`)
}

func newLogger(level string) *slog.Logger {
	var lvl slog.Level
	switch level {
	case "debug":
		lvl = slog.LevelDebug
	case "error":
		lvl = slog.LevelError
	default:
		lvl = slog.LevelInfo
	}
	// Text to stderr; no handler in this agent may be given clipboard content,
	// tokens, keys or pairing codes as attributes.
	return slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: lvl}))
}

func defaultDeviceName() string {
	host, err := os.Hostname()
	if err != nil || host == "" {
		return "Desktop"
	}
	return host
}
