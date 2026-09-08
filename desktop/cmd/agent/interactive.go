package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/hackathon-by-hgs/code-paste/desktop/internal/crypto"
	"github.com/hackathon-by-hgs/code-paste/desktop/internal/daemon"
	"github.com/hackathon-by-hgs/code-paste/desktop/internal/service"
)

// interactive is what a double-click gets.
//
// Someone who downloads an .exe and opens it should not be shown a usage screen
// that vanishes before it can be read. They want the thing set up, so this asks
// for the one piece of information only they have — the pairing code — and does
// the rest.
func interactive(ctx context.Context, agent *daemon.Agent, storeInfo crypto.KeyStoreInfo) error {
	fmt.Println()
	fmt.Println("  Code Paste — clipboard agent")
	fmt.Println("  ────────────────────────────")
	fmt.Println()

	// Already set up? Then report, offer to finish anything missing, and stop.
	if err := agent.Load(); err == nil {
		return interactiveStatus(agent, storeInfo)
	} else if !errors.Is(err, daemon.ErrNotPaired) {
		return waitThenFail(err)
	}

	fmt.Println("  This device is not paired yet.")
	fmt.Println()
	fmt.Println("  1. Open the web app and sign in")
	fmt.Println("  2. Go to My Devices and choose \"+ Pair Device\"")
	fmt.Println("  3. Type the 8-character code below")
	fmt.Println()
	fmt.Println("  The code lasts 5 minutes and works once. It is NOT the session")
	fmt.Println("  join code shown beside a Session ID in the sharing panel.")
	fmt.Println()

	code, err := prompt("  Pairing code: ")
	if err != nil {
		return waitThenFail(err)
	}
	code = strings.ToUpper(strings.TrimSpace(code))
	if code == "" {
		return waitThenFail(errors.New("no code entered"))
	}
	if strings.HasPrefix(strings.ToLower(code), "cp_ses_") {
		return waitThenFail(errors.New(
			"that is a share-session id, not a pairing code — get one from My Devices"))
	}

	name, err := prompt(fmt.Sprintf("  Name for this device [%s]: ", defaultDeviceName()))
	if err != nil {
		return waitThenFail(err)
	}
	if strings.TrimSpace(name) == "" {
		name = defaultDeviceName()
	}

	fmt.Println()
	fmt.Println("  Pairing…")

	if err := agent.Pair(ctx, code, strings.TrimSpace(name)); err != nil {
		return waitThenFail(err)
	}
	if err := savedConfig.Save(); err != nil {
		return waitThenFail(fmt.Errorf("paired, but settings could not be saved: %w", err))
	}

	fmt.Println("  Paired.")

	if err := installService(); err != nil {
		fmt.Println()
		fmt.Printf("  Paired, but the background service could not start: %v\n", err)
		fmt.Println("  Run this file again to retry.")
		return waitThenClose(nil)
	}

	fmt.Println("  Started, and it will start again every time you log in.")
	fmt.Println()
	fmt.Println("  Copy something here and it appears on your other devices.")
	fmt.Println("  You can close this window.")
	return waitThenClose(nil)
}

// interactiveStatus is the double-click path for an already-paired device.
func interactiveStatus(agent *daemon.Agent, storeInfo crypto.KeyStoreInfo) error {
	fmt.Println("  This device is already paired.")
	fmt.Println()
	fmt.Printf("    device       %s\n", agent.DeviceID())
	fmt.Printf("    credentials  %s\n", storeInfo.Description)

	manager := service.New()
	state, _ := manager.Status()
	fmt.Printf("    background   %s\n", state)
	fmt.Println()

	if state != service.StateRunning {
		fmt.Println("  Starting it…")
		if err := installService(); err != nil {
			fmt.Printf("  Could not start it: %v\n", err)
			return waitThenClose(nil)
		}
		fmt.Println("  Started, and it will start again every time you log in.")
	} else {
		fmt.Println("  Syncing is running. Nothing to do.")
	}

	fmt.Println()
	fmt.Println("  You can close this window.")
	return waitThenClose(nil)
}

func prompt(label string) (string, error) {
	fmt.Print(label)
	line, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if err != nil {
		// EOF with no input: treat as an empty answer rather than a failure, so
		// a piped or closed stdin does not look like a crash.
		return strings.TrimSpace(line), nil
	}
	return strings.TrimSpace(line), nil
}

// waitThenClose holds the window open. Without it Windows closes the console
// the instant this returns, and the user sees a flash and nothing else.
func waitThenClose(err error) error {
	fmt.Println()
	fmt.Print("  Press Enter to close… ")
	_, _ = bufio.NewReader(os.Stdin).ReadString('\n')
	return err
}

func waitThenFail(err error) error {
	fmt.Println()
	fmt.Printf("  Problem: %v\n", err)
	return waitThenClose(err)
}
