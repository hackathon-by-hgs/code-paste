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
	"github.com/hackathon-by-hgs/code-paste/desktop/internal/service"
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

	// --no-service opts out of the background install, for a foreground run or
	// for anyone who prefers to manage the supervisor themselves.
	noService := false
	args := make([]string, 0, len(os.Args))
	for _, arg := range os.Args {
		if arg == "--no-service" {
			noService = true
			continue
		}
		args = append(args, arg)
	}
	os.Args = args

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

		// Persist what we resolved, so the background service — which starts at
		// login with no shell and therefore no environment — can find it.
		if err := cfg.Save(); err != nil {
			return fmt.Errorf("device paired but its settings could not be saved: %w", err)
		}

		fmt.Println("Paired.")
		if noService {
			fmt.Println("Run `agent run` to start syncing, or `agent install` to run it in the background.")
			return nil
		}
		if err := installService(); err != nil {
			// Pairing succeeded; only the convenience failed. Say which.
			fmt.Fprintf(os.Stderr, "warning: could not start the background service: %v\n", err)
			fmt.Println("Run `agent run` to sync in this terminal instead.")
			return nil
		}
		fmt.Println("Syncing in the background, and at every login. Nothing else to do.")
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
		// The background state is reported either way: "not paired" and
		// "paired but not running" need different fixes, and the user should
		// not have to guess which they are looking at.
		defer printServiceStatus()

		if err := agent.Load(); err != nil {
			if errors.Is(err, daemon.ErrNotPaired) {
				fmt.Println("Not paired. Mint a code under \"My Devices\" and run: agent pair <CODE>")
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

	case "install":
		if err := cfg.Save(); err != nil {
			return err
		}
		if err := installService(); err != nil {
			return err
		}
		fmt.Printf("Installed. %s\n", service.New().Describe())
		return nil

	case "uninstall":
		if err := service.New().Uninstall(); err != nil {
			return err
		}
		fmt.Println("Background service removed. Pairing and credentials are untouched.")
		return nil

	default:
		usage()
		return fmt.Errorf("unknown command %q", os.Args[1])
	}
}

// printServiceStatus reports whether the agent runs in the background.
func printServiceStatus() {
	manager := service.New()
	state, err := manager.Status()
	if err != nil {
		return
	}
	fmt.Printf("Background: %s (%s)\n", state, manager.Describe())
	if state == service.StateNotInstalled {
		fmt.Println("  run: agent install   — to sync in the background and at every login")
	}
}

// installService registers the running binary to start at login and starts it.
func installService() error {
	execPath, err := service.ExecutablePath()
	if err != nil {
		return err
	}
	return service.New().Install(execPath)
}

func usage() {
	fmt.Fprint(os.Stderr, `Code Paste desktop agent

  agent pair <PAIRING-CODE> [name]   redeem a code, then sync in the background
  agent status                       pairing and background-service state
  agent peers                        who may receive this clipboard
  agent install                      start at login (pair does this for you)
  agent uninstall                    stop starting at login
  agent run                          sync in this terminal instead

The pairing code comes from "My Devices" in the web app, NOT the session join
code shown beside a Session ID in the sharing panel — the two look identical.

Flags:
  --no-service            with pair: do not install the background service

Environment (all optional; see .env.example). A release build has the
control-plane URL compiled in, and pair saves everything else, so a normal
install needs none of these:
  CODEPASTE_API_URL       control-plane origin, without /v1
  CODEPASTE_LISTEN_PORT   peer port (default 47800)
  CODEPASTE_PEERS         comma-separated host:port peers, when mDNS cannot reach
  CODEPASTE_MDNS          "off" to disable local-network discovery
  CODEPASTE_CLIPBOARD     "os" (default) or "file:<path>" for one-machine tests
  CODEPASTE_KEY_ACCOUNT   credential-store account, to run two agents on one host
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
