package controlplane

import (
	"errors"
	"fmt"
)

// ErrorCode is the stable machine-readable code. Switch on this, never on the
// message — messages are for humans and may be reworded without a version bump.
type ErrorCode string

const (
	CodeInvalidRequest   ErrorCode = "invalid_request"
	CodeUnauthenticated  ErrorCode = "unauthenticated"
	CodeInvalidCreds     ErrorCode = "invalid_credentials"
	CodeTokenExpired     ErrorCode = "token_expired"
	CodeTokenReused      ErrorCode = "token_reused"
	CodeForbidden        ErrorCode = "forbidden"
	CodeNotFound         ErrorCode = "not_found"
	CodeConflict         ErrorCode = "conflict"
	CodeDeviceRevoked    ErrorCode = "device_revoked"
	CodeSessionExpired   ErrorCode = "session_expired"
	CodeNotAMember       ErrorCode = "not_a_member"
	CodePayloadTooLarge  ErrorCode = "payload_too_large"
	CodeUnsupportedProto ErrorCode = "unsupported_protocol_version"
	CodeRateLimited      ErrorCode = "rate_limited"
	CodeInternal         ErrorCode = "internal"

	// CodeNetwork is client-side only: the request never reached the API.
	CodeNetwork ErrorCode = "network"
)

type ErrorDetail struct {
	Path    string `json:"path"`
	Message string `json:"message"`
}

// APIError is the control plane's single error shape.
type APIError struct {
	Code       ErrorCode
	Message    string
	Status     int
	Details    []ErrorDetail
	RequestID  string
	RetryAfter int // seconds, from Retry-After when present
}

func (e *APIError) Error() string {
	if e.RequestID != "" {
		return fmt.Sprintf("%s: %s (request %s)", e.Code, e.Message, e.RequestID)
	}
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

// Retryable reports whether trying again could produce a different outcome.
// The listed codes are terminal — retrying them is always wasted work.
func (e *APIError) Retryable() bool {
	switch e.Code {
	case CodeInvalidRequest, CodeForbidden, CodeDeviceRevoked,
		CodeTokenReused, CodeConflict, CodeNotFound, CodeUnsupportedProto:
		return false
	default:
		return true
	}
}

// Fatal reports whether the agent must stop syncing and wipe its credentials.
//
// device_revoked and token_reused are not transient failures; they mean this
// device's authorization is gone or its tokens were captured.
func (e *APIError) Fatal() bool {
	return e.Code == CodeDeviceRevoked || e.Code == CodeTokenReused
}

// CodeOf extracts the error code from any error in the chain, or "" if the
// error did not come from the control plane.
func CodeOf(err error) ErrorCode {
	var apiErr *APIError
	if errors.As(err, &apiErr) {
		return apiErr.Code
	}
	return ""
}

// IsFatal is the check the daemon uses to decide whether to shut down syncing.
func IsFatal(err error) bool {
	var apiErr *APIError
	return errors.As(err, &apiErr) && apiErr.Fatal()
}
