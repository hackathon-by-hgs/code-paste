<!--
  PR into `main`. `main` holds no product code — every change here changes the obligations of one
  or more domains (DEV_GUIDE.md §2 "main is not a trunk"). Answer every section; CI will not merge
  this for you (DEV_GUIDE.md §8, RULES.md §8).
-->

## 1. What changed?

<!-- One paragraph. What does this PR do to the docs / contracts / agent config? -->

## 2. Why?

<!-- The motivating problem or decision. Link the ADR or issue. -->

## 3. Which boundary moved?

<!-- Contract? Protocol version? API surface? Security model? "None (docs only)" is a valid answer. -->

## 4. Contract impact

- [ ] This PR **does not** change `contracts/` (schemas, vectors, OpenAPI) or `PROTOCOL.md` semantics.
- [ ] This PR **does** change a contract. If so:
  - [ ] Schema, vectors (valid **and** invalid), and `docs/PROTOCOL.md` / `docs/API_CONTRACTS.md` were updated together.
  - [ ] Version bumped in `contracts/VERSION`; a new `protocol-v*` tag is required (breaking → new major).
  - [ ] A cross-cutting handoff in `docs/HANDOFFS/` lists **every domain that must move**.

## 5. How was it tested?

<!-- Paste the actual `main CI` output or local run. Do NOT claim checks you did not run (RULES.md §5). -->

```text

```

## 6. Security / privacy implications

<!-- Any change to auth, tokens, key handling, size limits, or the invalid-vector set. "None" is valid but must be deliberate. -->

## 7. What is left?

<!-- Follow-ups, and which domains now need a PR to re-pin. -->

---

- [ ] PR title follows Conventional Commits with a scope, e.g. `docs(main): …`, `feat(contracts): …`.
- [ ] I did **not** put product code on `main` (DEV_GUIDE.md §9).
- [ ] No secrets, tokens, private keys, or `.env` files are committed (only `.env.example`).
