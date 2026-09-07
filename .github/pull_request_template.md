<!--
  PR into `frontend`. Base branch must be `frontend` (feature branches are hyphenated: `frontend-*`)
  — a PR from here into another domain is always a mistake (DEV_GUIDE.md §3.4, §9). Answer every section.
-->

## 1. What changed?

## 2. Why?

## 3. Which architecture boundary moved?
<!-- New API call/route? New shared type usage? Coupling to backend internals is NOT allowed —
     talk to the control plane only through the pinned contract (RULES.md §3.8). "None" is valid. -->

## 4. How was it tested?
<!-- Paste the actual output. Do not claim checks you did not run (RULES.md §5). -->
```text
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
pnpm run lint
pnpm run test
pnpm run build
```

## 5. Security / privacy implications
<!-- Auth token handling, storage of any clipboard/device data in the browser, XSS surface,
     third-party scripts. Never log clipboard contents or tokens (RULES.md §2). "None" is valid. -->

## 6. What is left?

---

### Checklist
- [ ] PR title is Conventional Commits, e.g. `feat(frontend): …`.
- [ ] `tsc`, `lint`, `test`, `build` pass locally.
- [ ] Tests added/updated for meaningful behaviour (RULES.md §8).
- [ ] No new dependency added without justification (RULES.md §9).
- [ ] No secrets/tokens/`.env` committed (only `.env.example`).
- [ ] If I consume a new contract field, `CONTRACTS_VERSION` still matches what the backend serves.
