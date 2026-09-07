# Engineering Rules

## 1. Product rules

1. Simplicity is a requirement, not a nice-to-have.
2. Assume the user does not want to configure anything.
3. One tap is better than three.
4. Three taps is better than a settings page.
5. Defaults should be safe and useful.
6. Do not expose infrastructure concepts to normal users.
7. A user should understand what is happening without understanding networking.

## 2. Security rules

1. Same Wi-Fi does not mean trusted.
2. Same IP subnet does not mean trusted.
3. Every device has an identity.
4. Every peer connection must be authenticated.
5. Every sharing session has explicit membership.
6. Revocation must take effect promptly.
7. Clipboard contents are sensitive.
8. Never log raw clipboard contents.
9. Never include clipboard data in crash reports.
10. Never persist clipboard contents indefinitely by default.
11. Validate all network input.
12. Apply message and payload size limits.
13. Use established cryptographic primitives/libraries.
14. Never implement custom encryption.
15. Tokens and private keys never enter source control.
16. Secrets never enter logs.
17. Security-sensitive changes require tests.

## 3. Architecture rules

1. Keep boundaries explicit.
2. Prefer modules over microservices.
3. Keep the data plane independent from the control plane.
4. LAN transport must not require server-side clipboard storage.
5. Transport interfaces must permit a future relay.
6. Domain types must not depend on UI frameworks.
7. Shared protocol types belong in a versioned shared package.
8. Do not couple the web app to desktop internals.
9. Do not allow random cross-package imports.
10. Avoid global mutable state.

## 4. Code quality

- Small functions.
- Strong typing.
- Explicit error handling.
- Meaningful names.
- No magic values.
- No dead code.
- No commented-out abandoned implementations.
- No duplicated business rules.
- No unnecessary abstractions.
- No premature optimization.

## 5. Testing policy

Before merge/push:

```text
unit tests
integration tests
typecheck
lint
build
```

Run only the checks relevant to the repository, but never knowingly push failing checks.

Required high-value tests include:
- auth.
- authorization.
- device revocation.
- protocol validation.
- encryption/authentication.
- duplicate suppression.
- loop prevention.
- payload limits.
- session expiration.
- malformed network input.
- reconnect behavior.

## 6. Agent rules

Every agent must:

### Before work
- Read `CLAUDE.md`.
- Read relevant architecture docs.
- Read recent handoffs.
- Inspect existing implementation.
- Avoid duplicating another agent's work.

### During work
- Keep changes scoped.
- Do not silently change contracts.
- Update docs when behavior changes.
- Add tests with implementation.

### After a milestone
Create/update a handoff note containing:
- What changed.
- Files changed.
- Decisions made.
- Tests run.
- Results.
- Known limitations.
- Follow-up work.
- Anything another agent must know.

## 7. Git rules

Commit messages should describe intent.

Preferred:

```text
feat(desktop): sync clipboard text over LAN
fix(protocol): reject oversized clipboard payloads
test(sync): prevent remote clipboard rebroadcast
docs(architecture): define device authorization model
```

Avoid:

```text
update
stuff
changes
fix
final
```

Never force-push shared branches without explicit coordination.

## 8. Pull request rules

A PR should answer:
- What changed?
- Why?
- What architecture boundary changed?
- How was it tested?
- What security implications exist?
- What remains?

A PR is not complete if tests are missing for meaningful behavior.

## 9. Dependency rules

Before adding a package:
- Is the functionality truly needed?
- Is there a standard-library solution?
- Is the dependency maintained?
- Does it increase attack surface?
- Does it work on all target platforms?
- Can the team understand and debug it?

Prefer one reliable library over multiple overlapping libraries.

## 10. UX rules

- Never make users understand ports.
- Never make users copy tokens manually.
- Never make users configure IP addresses.
- Never require a command-line setup for normal users.
- Pairing should be visible and understandable.
- Destructive actions require clear confirmation.
- Sync pause should be easy to find.
- Sharing should show who can receive clipboard data.

## 11. "Done" rule

No task is complete because the code compiles.

Done means:
- correct,
- tested,
- secure,
- documented,
- integrated,
- handed off.
