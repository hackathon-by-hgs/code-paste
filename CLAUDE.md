# backend — Agent Contract

The authoritative operating contract is `CLAUDE.md` on `main`. Read it first, together with
`docs/SPEC_CONTRACT.md`, `docs/RULES.md` and the ADRs. Check `main` out as a sibling worktree
(`DEV_GUIDE.md` §3.2):

```bash
git worktree add ../code-paste-docs main
```

## Domain-specific rules

1. **This is the control plane, not the data plane.** If a change would make the backend receive,
   store, buffer or forward clipboard content, stop. That is ADR-001, and it is not negotiable.
2. **One authorization predicate.** `AuthorizationService` owns it. Do not re-derive it in a
   controller, a gateway or a repository. The WebSocket layer calls the same services HTTP does.
3. **Repositories are interfaces.** Services depend on the port, never on Drizzle. Only
   `persistence/repositories/drizzle-*` knows SQL exists.
4. **Mappers own the redaction boundary.** `toPublic` decides what leaves the process. Never
   serialise a domain entity straight into a response.
5. **Multi-record state changes are transactional.** Revocation that half-succeeds is a security
   bug, not a data-integrity inconvenience.
6. **Never log a secret.** The logger redacts by allowlist and a test proves it. Do not bypass it.
7. **Contracts are pinned, never vendored.** Change a contract with a PR to `main`, a new tag and
   a handoff — never by editing `.contracts/`.
