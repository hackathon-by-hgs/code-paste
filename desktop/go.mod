module github.com/hackathon-by-hgs/code-paste/desktop

go 1.24

// No third-party dependencies. Ed25519, SHA-256, HTTP and JSON are all in the
// standard library, and the control-plane client and roster verifier are
// security-critical enough to be worth keeping auditable and supply-chain free.
//
// Dependencies will be needed for OS clipboard access and mDNS discovery. Add
// them when those packages are implemented, not before.
