<!--
  Generic domain PR template. Copy to `.github/pull_request_template.md` on a domain branch and
  tailor the test commands + security prompts. Base branch must be this domain's branch — a PR into
  another domain is always a mistake (DEV_GUIDE.md §3.4, §9).
-->

## 1. What changed?

## 2. Why?

## 3. Which architecture boundary moved?
<!-- Interface/module changed? New contract field consumed? "None" is valid. -->

## 4. How was it tested?
<!-- Paste the ACTUAL output. Do not claim checks you did not run (RULES.md §5). -->
```text

```

## 5. Security / privacy implications
<!-- Auth, identity, authorization, revocation, input validation, size limits, and that no secret
     or clipboard content is logged (RULES.md §2). "None" is valid but must be deliberate. -->

## 6. What is left?

---

### Checklist
- [ ] PR title is Conventional Commits with a scope, e.g. `feat(<domain>): …`.
- [ ] Tests added/updated for meaningful behaviour (RULES.md §8).
- [ ] Invalid-vector conformance still passes.
- [ ] No new dependency without justification (RULES.md §9).
- [ ] No secrets/tokens/private keys/`.env` committed (only `.env.example`).
- [ ] `CONTRACTS_VERSION` still matches the protocol this domain implements.
