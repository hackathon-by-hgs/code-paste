package controlplane

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
)

func writeErr(w http.ResponseWriter, status int, code ErrorCode) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]any{"code": code, "message": "nope"},
	})
}

func writeTokens(w http.ResponseWriter, suffix string) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(TokenPair{
		AccessToken:  "access-" + suffix,
		RefreshToken: "refresh-" + suffix,
		TokenType:    "Bearer",
		ExpiresIn:    600,
	})
}

func TestClientAppendsAPIVersionToOrigin(t *testing.T) {
	for _, tc := range []struct{ in, want string }{
		{"https://api.test", "https://api.test/v1"},
		{"https://api.test/", "https://api.test/v1"},
		{"https://api.test/v1", "https://api.test/v1"},
		{"  https://api.test//  ", "https://api.test/v1"},
	} {
		if got := NewClient(tc.in, nil).baseURL; got != tc.want {
			t.Errorf("NewClient(%q).baseURL = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestClientSendsBearerTokenAndClientHeader(t *testing.T) {
	var gotAuth, gotClient string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotClient = r.Header.Get("X-CodePaste-Client")
		_ = json.NewEncoder(w).Encode(Me{Principal: "device"})
	}))
	defer srv.Close()

	c := NewClient(srv.URL, nil)
	c.SetTokens(Tokens{AccessToken: "access-1", RefreshToken: "refresh-1"})

	if _, err := c.GetMe(context.Background()); err != nil {
		t.Fatalf("GetMe: %v", err)
	}
	if gotAuth != "Bearer access-1" {
		t.Errorf("Authorization = %q", gotAuth)
	}
	if gotClient != ClientID {
		t.Errorf("X-CodePaste-Client = %q, want %q", gotClient, ClientID)
	}
}

func TestClientRefreshesOnceAndRetries(t *testing.T) {
	var refreshes int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/auth/refresh" {
			atomic.AddInt32(&refreshes, 1)
			writeTokens(w, "2")
			return
		}
		if r.Header.Get("Authorization") == "Bearer access-1" {
			writeErr(w, http.StatusUnauthorized, CodeTokenExpired)
			return
		}
		_ = json.NewEncoder(w).Encode(Me{Principal: "device"})
	}))
	defer srv.Close()

	var saved Tokens
	c := NewClient(srv.URL, func(t Tokens) { saved = t })
	c.SetTokens(Tokens{AccessToken: "access-1", RefreshToken: "refresh-1"})

	if _, err := c.GetMe(context.Background()); err != nil {
		t.Fatalf("GetMe: %v", err)
	}
	if refreshes != 1 {
		t.Errorf("refreshes = %d, want 1", refreshes)
	}
	if got := c.Tokens().AccessToken; got != "access-2" {
		t.Errorf("access token = %q, want access-2", got)
	}
	// Rotation must reach the caller, or a restart would present a dead token.
	if saved.RefreshToken != "refresh-2" {
		t.Errorf("persisted refresh token = %q, want refresh-2", saved.RefreshToken)
	}
}

// The agent runs several loops that can each hit a 401 at the same instant
// after a sleep or a network regain. Two concurrent refreshes would make the
// second a reuse and the server would revoke the whole family (ADR-004).
func TestClientIssuesOneRefreshForConcurrent401s(t *testing.T) {
	var refreshes int32
	release := make(chan struct{})

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/auth/refresh" {
			atomic.AddInt32(&refreshes, 1)
			<-release // hold it open so every caller piles up on the lock
			writeTokens(w, "2")
			return
		}
		if r.Header.Get("Authorization") == "Bearer access-1" {
			writeErr(w, http.StatusUnauthorized, CodeTokenExpired)
			return
		}
		_ = json.NewEncoder(w).Encode(Me{Principal: "device"})
	}))
	defer srv.Close()

	c := NewClient(srv.URL, nil)
	c.SetTokens(Tokens{AccessToken: "access-1", RefreshToken: "refresh-1"})

	var wg sync.WaitGroup
	errs := make([]error, 8)
	for i := range errs {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, errs[i] = c.GetMe(context.Background())
		}(i)
	}

	close(release)
	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Errorf("call %d failed: %v", i, err)
		}
	}
	if refreshes != 1 {
		t.Fatalf("refreshes = %d, want exactly 1", refreshes)
	}
}

func TestClientWipesTokensOnReuseWithoutRetrying(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		writeErr(w, http.StatusUnauthorized, CodeTokenReused)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, nil)
	c.SetTokens(Tokens{AccessToken: "access-1", RefreshToken: "refresh-1"})

	_, err := c.GetMe(context.Background())
	if CodeOf(err) != CodeTokenReused {
		t.Fatalf("code = %q, want token_reused", CodeOf(err))
	}
	if !IsFatal(err) {
		t.Error("token_reused must be fatal")
	}
	if c.Tokens().RefreshToken != "" {
		t.Error("expected tokens to be wiped")
	}
	if calls != 1 {
		t.Errorf("calls = %d, want 1 (no retry)", calls)
	}
}

func TestClientClearsSessionWhenRefreshItselfFails(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/auth/refresh" {
			writeErr(w, http.StatusUnauthorized, CodeUnauthenticated)
			return
		}
		writeErr(w, http.StatusUnauthorized, CodeTokenExpired)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, nil)
	c.SetTokens(Tokens{AccessToken: "access-1", RefreshToken: "refresh-1"})

	if _, err := c.GetMe(context.Background()); err == nil {
		t.Fatal("expected an error")
	}
	if c.Tokens().RefreshToken != "" {
		t.Error("a dead refresh family must clear local tokens")
	}
}

func TestClientReportsDeviceRevokedAsFatal(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeErr(w, http.StatusForbidden, CodeDeviceRevoked)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, nil)
	c.SetTokens(Tokens{AccessToken: "access-1", RefreshToken: "refresh-1"})

	_, err := c.GetSignedPeerSet(context.Background())
	if !IsFatal(err) {
		t.Fatalf("device_revoked must be fatal, got %v", err)
	}
	var apiErr *APIError
	if !asAPIError(err, &apiErr) || apiErr.Retryable() {
		t.Error("device_revoked must not be retryable")
	}
}

func TestClientDegradesNonJSONFailureToTypedError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte("<html>502</html>"))
	}))
	defer srv.Close()

	_, err := NewClient(srv.URL, nil).GetProtocol(context.Background())
	if CodeOf(err) != CodeInternal {
		t.Fatalf("code = %q, want internal", CodeOf(err))
	}
}

func TestProtocolPolicySupports(t *testing.T) {
	p := ProtocolPolicy{SupportedProtocolVersions: []int{1, 2}}
	if !p.Supports(1) || !p.Supports(2) {
		t.Error("expected 1 and 2 to be supported")
	}
	if p.Supports(3) {
		t.Error("expected 3 to be unsupported")
	}
}

func asAPIError(err error, target **APIError) bool {
	e, ok := err.(*APIError)
	if ok {
		*target = e
	}
	return ok
}
