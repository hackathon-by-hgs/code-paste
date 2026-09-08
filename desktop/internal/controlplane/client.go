package controlplane

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ClientID is sent as X-CodePaste-Client for diagnostics: <domain>/<appVersion>.
const ClientID = "desktop/0.1.0"

// ProtocolVersion is the clipboard protocol this build implements. It is
// independent of the API version and travels in payloads.
const ProtocolVersion = 1

// Tokens is the device-bound credential pair.
type Tokens struct {
	AccessToken  string
	RefreshToken string
}

// TokensChanged is called whenever rotation produces a new pair, so the caller
// can persist it. A dropped rotation means the stored refresh token is dead and
// the next start has to re-pair.
type TokensChanged func(Tokens)

// refreshCall lets every waiter observe the result of one shared refresh
// without racing a later one.
type refreshCall struct {
	done chan struct{}
	err  error
}

// Client talks to the control plane. Safe for concurrent use.
type Client struct {
	baseURL  string
	http     *http.Client
	onChange TokensChanged

	mu      sync.Mutex
	tokens  Tokens
	pending *refreshCall
}

// NewClient takes the control-plane ORIGIN; /v1 is appended here so an API
// version bump (ADR-008) is a one-line change.
func NewClient(origin string, onChange TokensChanged) *Client {
	base := strings.TrimRight(strings.TrimSpace(origin), "/")
	if !strings.HasSuffix(base, "/v1") {
		base += "/v1"
	}
	return &Client{
		baseURL:  base,
		http:     &http.Client{Timeout: 30 * time.Second},
		onChange: onChange,
	}
}

// SetTokens installs credentials loaded from the key store.
func (c *Client) SetTokens(t Tokens) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.tokens = t
}

// Tokens returns the current pair.
func (c *Client) Tokens() Tokens {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.tokens
}

// ClearTokens drops the session. Called when the family is dead.
func (c *Client) ClearTokens() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.tokens = Tokens{}
}

func (c *Client) storeTokens(pair TokenPair) {
	next := Tokens{AccessToken: pair.AccessToken, RefreshToken: pair.RefreshToken}

	c.mu.Lock()
	c.tokens = next
	onChange := c.onChange
	c.mu.Unlock()

	if onChange != nil {
		onChange(next)
	}
}

type requestSpec struct {
	method string
	path   string
	body   any
	auth   bool
}

func (c *Client) newRequest(ctx context.Context, spec requestSpec, token string) (*http.Request, error) {
	var reader io.Reader
	if spec.body != nil {
		encoded, err := json.Marshal(spec.body)
		if err != nil {
			return nil, fmt.Errorf("encode request: %w", err)
		}
		reader = bytes.NewReader(encoded)
	}

	req, err := http.NewRequestWithContext(ctx, spec.method, c.baseURL+spec.path, reader)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}

	req.Header.Set("X-CodePaste-Client", ClientID)
	if spec.body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	return req, nil
}

// do performs a request, refreshing and retrying once on an expired token.
func (c *Client) do(ctx context.Context, spec requestSpec, out any) error {
	token := ""
	if spec.auth {
		token = c.Tokens().AccessToken
	}

	res, err := c.send(ctx, spec, token)
	if err != nil {
		return err
	}

	if res.StatusCode == http.StatusUnauthorized && spec.auth && c.Tokens().RefreshToken != "" {
		apiErr := c.toAPIError(res)

		// A reused token means the family is already revoked server-side.
		// Wipe and stop; retrying cannot help and hides a compromise signal.
		if apiErr.Code == CodeTokenReused {
			c.ClearTokens()
			return apiErr
		}

		if apiErr.Code != CodeTokenExpired && apiErr.Code != CodeUnauthenticated {
			return apiErr
		}

		// Pass the token that actually failed, so a 401 that another goroutine
		// has already resolved does not trigger a second rotation.
		if err := c.refreshOnce(ctx, token); err != nil {
			return err
		}

		if res, err = c.send(ctx, spec, c.Tokens().AccessToken); err != nil {
			return err
		}
	}

	defer func() {
		_, _ = io.Copy(io.Discard, res.Body)
		_ = res.Body.Close()
	}()

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return c.toAPIError(res)
	}
	if out == nil || res.StatusCode == http.StatusNoContent {
		return nil
	}
	if err := json.NewDecoder(res.Body).Decode(out); err != nil {
		return fmt.Errorf("decode response: %w", err)
	}
	return nil
}

func (c *Client) send(ctx context.Context, spec requestSpec, token string) (*http.Response, error) {
	req, err := c.newRequest(ctx, spec, token)
	if err != nil {
		return nil, err
	}
	res, err := c.http.Do(req)
	if err != nil {
		// Preserve context cancellation so callers can distinguish shutdown.
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, &APIError{Code: CodeNetwork, Message: "network request failed", Status: 0}
	}
	return res, nil
}

// toAPIError reads the error envelope, consuming and closing the body.
// A non-JSON body (gateway HTML, empty 502) still becomes a typed error.
func (c *Client) toAPIError(res *http.Response) *APIError {
	defer func() { _ = res.Body.Close() }()

	apiErr := &APIError{
		Code:    CodeInternal,
		Message: fmt.Sprintf("request failed with status %d", res.StatusCode),
		Status:  res.StatusCode,
	}

	if raw := res.Header.Get("Retry-After"); raw != "" {
		if seconds, err := strconv.Atoi(raw); err == nil {
			apiErr.RetryAfter = seconds
		}
	}

	var envelope struct {
		Error struct {
			Code      ErrorCode     `json:"code"`
			Message   string        `json:"message"`
			Details   []ErrorDetail `json:"details"`
			RequestID string        `json:"requestId"`
		} `json:"error"`
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err == nil && json.Unmarshal(body, &envelope) == nil && envelope.Error.Code != "" {
		apiErr.Code = envelope.Error.Code
		if envelope.Error.Message != "" {
			apiErr.Message = envelope.Error.Message
		}
		apiErr.Details = envelope.Error.Details
		apiErr.RequestID = envelope.Error.RequestID
	}
	return apiErr
}

// refreshOnce serialises token rotation.
//
// Every refresh consumes the presented token. Two concurrent refreshes make the
// second one a *reuse*, and the server revokes the entire family and forces
// re-pairing (ADR-004). The agent runs several loops that can each hit a 401 at
// the same moment after a sleep or a network regain, so this is what keeps that
// from happening.
//
// staleToken is the access token whose request got the 401. Two cases have to
// be covered, and only one of them is a lock:
//
//   - callers that raced into the 401 together wait on the shared call
//   - a caller whose 401 arrived *after* someone else's refresh already landed
//     finds its token superseded and simply retries, instead of starting a
//     second, needless rotation
func (c *Client) refreshOnce(ctx context.Context, staleToken string) error {
	c.mu.Lock()

	// Someone already rotated past the token this caller used, so its 401 is
	// stale news. Nothing to do — the retry will carry the current token.
	if c.tokens.AccessToken != "" && c.tokens.AccessToken != staleToken {
		c.mu.Unlock()
		return nil
	}

	if call := c.pending; call != nil {
		c.mu.Unlock()
		select {
		case <-call.done:
			return call.err
		case <-ctx.Done():
			return ctx.Err()
		}
	}

	refreshToken := c.tokens.RefreshToken
	if refreshToken == "" {
		c.mu.Unlock()
		return &APIError{Code: CodeUnauthenticated, Message: "no refresh token", Status: 401}
	}

	call := &refreshCall{done: make(chan struct{})}
	c.pending = call
	c.mu.Unlock()

	call.err = c.doRefresh(ctx, refreshToken)

	c.mu.Lock()
	c.pending = nil
	c.mu.Unlock()
	close(call.done)

	return call.err
}

func (c *Client) doRefresh(ctx context.Context, refreshToken string) error {
	spec := requestSpec{
		method: http.MethodPost,
		path:   "/auth/refresh",
		body:   map[string]string{"refreshToken": refreshToken},
	}

	res, err := c.send(ctx, spec, "")
	if err != nil {
		return err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		// Any refresh failure ends the session: the family is gone or was
		// never valid. Clearing here stops every other loop from retrying.
		c.ClearTokens()
		return c.toAPIError(res)
	}

	defer func() { _ = res.Body.Close() }()
	var pair TokenPair
	if err := json.NewDecoder(res.Body).Decode(&pair); err != nil {
		return fmt.Errorf("decode token pair: %w", err)
	}

	c.storeTokens(pair)
	return nil
}
