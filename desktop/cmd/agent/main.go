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

	"github.com/hackathon-by-hgs/code-paste/desktop/internal/clipboard"
	"github.com/hackathon-by-hgs/code-paste/desktop/internal/config"
	"github.com/hackathon-by-hgs/code-paste/desktop/internal/controlplane"
	"github.com/hackathon-by-hgs/code-paste/desktop/internal/crypto"
	"github.com/hackathon-by-hgs/code-paste/desktop/internal/daemon"
	"github.com/hackathon-by-hgs/code-paste/desktop/internal/discovery"
	"github.com/hackathon-by-hgs/code-paste/desktop/internal/transport"
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

	store, storeInfo, err := crypto.OpenKeyStore(cfg.KeyAccount, cfg.StateDir)
	if err != nil {
		return err
	}
	if !storeInfo.Secure {
		// Said plainly rather than buried: the difference between OS-encrypted
		// credentials and a readable file is not a detail.
		fmt.Fprintf(os.Stderr,
			"warning: no OS credential store available; falling back to an %s\n", storeInfo.Description)
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
		code := strings.ToUpper(strings.TrimSpace(os.Args[2]))

		// A session id means the user copied from the sharing panel. The join
		// code beside it is the same 8-character alphabet as a pairing code, so
		// nothing about the code itself would catch the mistake — say so here
		// rather than letting the server answer with a bare 401.
		if strings.HasPrefix(strings.ToLower(code), "cp_ses_") {
			return errors.New("that is a share-session id, not a pairing code — mint one under \"My Devices\" in the web app")
		}

		name := defaultDeviceName()
		if len(os.Args) > 3 {
			name = strings.Join(os.Args[3:], " ")
		}
		if err := agent.Pair(ctx, code, name); err != nil {
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

		clip, err := clipboard.New(cfg.Clipboard)
		if err != nil {
			return err
		}
		static, err := discovery.ParseStatic(cfg.Peers)
		if err != nil {
			return err
		}

		// mDNS for the seamless case, the static list for networks that filter
		// multicast or peers on another subnet. Either alone is enough.
		sources := []discovery.Discoverer{static}
		var mdnsLinks []string
		if cfg.MDNS {
			mdns := discovery.NewMDNS(agent.DeviceID())
			mdnsLinks = mdns.Interfaces()
			sources = append(sources, mdns)
		}

		agent.EnableSync(
			clip,
			transport.NewTCP(agent.PrivateKey(), cfg.ListenPort),
			discovery.NewMulti(sources...),
			cfg.ListenPort,
		)

		logger.Info("agent starting",
			"api", cfg.APIURL,
			"listen", cfg.ListenPort,
			"mdns", mdnsLinks,
			"staticPeers", static.Len(),
			"clipboard", clipboardLabel(cfg.Clipboard),
			"keystore", storeInfo.Description,
			"fingerprint", agent.Fingerprint(),
		)
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
		fmt.Printf("Paired.\n  device      %s\n  fingerprint %s\n  credentials %s\n",
			agent.DeviceID(), agent.Fingerprint(), storeInfo.Description)
		if storeInfo.Migrated {
			fmt.Println("  (migrated out of the old file store into secure storage)")
		}
		return nil

	case "peers":
		if err := agent.Load(); err != nil {
			if errors.Is(err, daemon.ErrNotPaired) {
				return errors.New("not paired — run: agent pair <CODE>")
			}
			return err
		}
		roster, err := agent.FetchRoster(ctx)
		if err != nil {
			return err
		}
		fmt.Printf("Roster version %d, expires %s\n", roster.RosterVersion, roster.ExpiresAt)
		if len(roster.Peers) == 0 {
			fmt.Println("No peers. Pair another device to this account.")
			return nil
		}
		fmt.Printf("%d peer(s) authorised to exchange clipboard data:\n", len(roster.Peers))
		for _, p := range roster.Peers {
			fmt.Printf("  %s  %-8s  %s  scope=%s\n", p.DeviceID, p.Platform, p.KeyFingerprint, p.Scope)
		}
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
  agent peers                               who may receive this clipboard
  agent status                              show local pairing state

The pairing code comes from "My Devices" in the web app, NOT the session join
code shown beside a Session ID in the sharing panel — the two look identical.

Environment (see .env.example):
  CODEPASTE_API_URL       required — control-plane origin, without /v1
  CODEPASTE_LISTEN_PORT   peer port (default 47800)
  CODEPASTE_PEERS         comma-separated host:port peers, for when mDNS cannot reach
  CODEPASTE_MDNS          "off" to disable local-network discovery (default on)
  CODEPASTE_CLIPBOARD     "os" (default) or "file:<path>" for one-machine tests
  CODEPASTE_KEY_ACCOUNT   credential-store account name, to run two agents on one host
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

func clipboardLabel(spec string) string {
	if spec == "" {
		return "os"
	}
	return spec
}

func defaultDeviceName() string {
	host, err := os.Hostname()
	if err != nil || host == "" {
		return "Desktop"
	}
	return host
}
