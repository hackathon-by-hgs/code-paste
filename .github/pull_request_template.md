<!--
  PR into `backend`. Base branch must be `backend` (feature branches are hyphenated: `backend-*` or
  `feat/backend-*`). A PR from here into another domain is always a mistake (DEV_GUIDE.md §3.4, §9).
-->

## 1. What changed?

## 2. Why?

## 3. Which architecture boundary moved?
<!-- New endpoint? Auth/authorization change? Persistence/repository change? Note it. The control
     plane never stores or relays clipboard payloads (API_CONTRACTS.md). "None" is valid. -->

## 4. How was it tested?
<!-- Paste the actual output for the suites you ran (RULES.md §5). Both DB drivers run in CI. -->
```text
npm run format && npm run lint && npm run typecheck && npm run build
npm run contracts:pin
npm run test:unit && npm run test:contract && npm run test:integration && npm run test:security && npm run test:e2e
```

## 5. Security / privacy implications
<!-- REQUIRED thinking for backend. Consider: auth, token lifetime/rotation, device identity,
     authorization predicates, revocation latency, replay/dedup, input validation, size limits,
     and that no secret or clipboard content is logged (RULES.md §2, SECURITY.md). -->

## 6. What is left?

---

### Checklist
- [ ] PR title is Conventional Commits, e.g. `feat(backend): register device public keys`.
- [ ] Security-sensitive change → tests added (RULES.md §2.17).
- [ ] Invalid-vector conformance still passes (`npm run test:contract`).
- [ ] No new dependency without justification (RULES.md §9); `npm run audit:security` clean.
- [ ] No secrets/tokens/private keys/`.env` committed (only `.env.example`).
- [ ] If a contract changed, it changed on `main` first and `CONTRACTS_VERSION` was bumped here.
