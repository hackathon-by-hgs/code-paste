//go:build windows

package crypto

import (
	"fmt"
	"syscall"
	"unsafe"
)

// Windows Credential Manager, via advapi32.
//
// Credentials are scoped to the logged-on user and encrypted at rest by the
// OS, which is the guarantee the plain file store could not give.

var (
	advapi32 = syscall.NewLazyDLL("advapi32.dll")

	credReadW   = advapi32.NewProc("CredReadW")
	credWriteW  = advapi32.NewProc("CredWriteW")
	credDeleteW = advapi32.NewProc("CredDeleteW")
	credFree    = advapi32.NewProc("CredFree")
)

const (
	credTypeGeneric = 1
	// credPersistLocalMachine survives logoff but stays on this machine — the
	// device identity is bound to this device and must never roam.
	credPersistLocalMachine = 2

	errNotFound = syscall.Errno(1168) // ERROR_NOT_FOUND
)

// credentialW mirrors the Win32 CREDENTIALW layout. Field order and types are
// load-bearing: Go's natural alignment on amd64 matches the C struct.
type credentialW struct {
	Flags              uint32
	Type               uint32
	TargetName         *uint16
	Comment            *uint16
	LastWritten        syscall.Filetime
	CredentialBlobSize uint32
	CredentialBlob     *byte
	Persist            uint32
	AttributeCount     uint32
	Attributes         uintptr
	TargetAlias        *uint16
	UserName           *uint16
}

type windowsCredentialManager struct{}

func newOSBackend() osBackend { return windowsCredentialManager{} }

func (windowsCredentialManager) name() string { return "Windows Credential Manager" }

// available checks the DLL and entry points resolve. advapi32 is present on
// every supported Windows, so this only fails somewhere very unusual.
func (windowsCredentialManager) available() bool {
	return credReadW.Find() == nil && credWriteW.Find() == nil && credDeleteW.Find() == nil
}

// target is the credential name: one entry per service/account pair.
func target(service, account string) string {
	return service + ":" + account
}

func (windowsCredentialManager) get(service, account string) ([]byte, error) {
	name, err := syscall.UTF16PtrFromString(target(service, account))
	if err != nil {
		return nil, err
	}

	var cred *credentialW
	ret, _, callErr := credReadW.Call(
		uintptr(unsafe.Pointer(name)),
		credTypeGeneric,
		0,
		uintptr(unsafe.Pointer(&cred)),
	)
	if ret == 0 {
		if callErr == errNotFound {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("CredRead: %v", callErr)
	}
	defer credFree.Call(uintptr(unsafe.Pointer(cred)))

	if cred.CredentialBlobSize == 0 || cred.CredentialBlob == nil {
		return nil, ErrNotFound
	}
	// Copied out before CredFree releases the OS buffer.
	blob := make([]byte, cred.CredentialBlobSize)
	copy(blob, unsafe.Slice(cred.CredentialBlob, cred.CredentialBlobSize))
	return blob, nil
}

func (windowsCredentialManager) set(service, account string, secret []byte) error {
	name, err := syscall.UTF16PtrFromString(target(service, account))
	if err != nil {
		return err
	}
	user, err := syscall.UTF16PtrFromString(account)
	if err != nil {
		return err
	}

	// CredWrite rejects a null blob pointer, so an empty secret needs a stand-in
	// that is never read back (Size stays 0).
	blob := secret
	if len(blob) == 0 {
		blob = []byte{0}
	}

	cred := credentialW{
		Type:               credTypeGeneric,
		TargetName:         name,
		CredentialBlobSize: uint32(len(secret)),
		CredentialBlob:     &blob[0],
		Persist:            credPersistLocalMachine,
		UserName:           user,
	}

	ret, _, callErr := credWriteW.Call(uintptr(unsafe.Pointer(&cred)), 0)
	if ret == 0 {
		return fmt.Errorf("CredWrite: %v", callErr)
	}
	return nil
}

func (windowsCredentialManager) del(service, account string) error {
	name, err := syscall.UTF16PtrFromString(target(service, account))
	if err != nil {
		return err
	}

	ret, _, callErr := credDeleteW.Call(uintptr(unsafe.Pointer(name)), credTypeGeneric, 0)
	if ret == 0 {
		if callErr == errNotFound {
			return nil // already gone; clearing twice is fine
		}
		return fmt.Errorf("CredDelete: %v", callErr)
	}
	return nil
}
