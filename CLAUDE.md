# Mobile Domain — Agent Operating Contract

See the full contract on `main` branch.

## Quick reference

- **Vision**: Platform-appropriate iOS/Android clipboard client with seamless device sync
- **Principles**: Simplicity, security, platform capability respect
- **Testing**: Mandatory before merge; contract vectors must pass
- **Handoff**: Update `HANDOFF.md` after meaningful work

## Mobile-specific rules

1. **Platform constraints first**: Do not try to bypass iOS/Android sandbox restrictions. If a feature is not possible in the OS, provide the simplest supported alternative.

2. **Battery and performance**: Background clipboard monitoring has battery/performance implications. Design around actual OS capabilities:
   - iOS: Use native callbacks where available; fallback to foreground-only polling
   - Android: Respect Doze/Battery Saver restrictions

3. **Security**: All local clipboard operations must respect the OS security model. Never write clipboard data to insecure storage.

4. **UI simplicity**: Every screen should have one clear purpose. Avoid nested settings.

5. **Tests**: Unit tests for business logic; integration tests against mock clipboard provider and network layer.

## How to work here

1. Read `HANDOFF.md` in this branch
2. Add `main` as a sibling worktree: `git remote set-branches --add origin main && git fetch origin main && git worktree add ../code-paste-docs main`
3. Read `CLAUDE.md`, `docs/RULES.md`, `docs/SYSTEM_DESIGN.md`, `docs/SECURITY.md`, `docs/PROTOCOL.md` from `main`
4. Check `CONTRACTS_VERSION` and verify CI fetches that contract version
5. Implement, test, update `HANDOFF.md`

## Files in this branch

```
mobile/             entire Flutter application
.github/workflows/  CI/CD (see docs/RULES.md §6 for gates)
CONTRACTS_VERSION   pinned contract tag from main
HANDOFF.md          current state and next steps
CLAUDE.md           this file
README.md           quick start
```
