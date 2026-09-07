# Contributing

Thanks for working on Cross-Device Clipboard. Two documents govern everything here; read them before
you write code:

- **`CLAUDE.md`** — the operating contract and product principles (simplicity beats feature count).
- **`DEV_GUIDE.md`** — the repository layout. This repo is **branch-per-domain with unrelated
  histories**, not a monorepo. Getting this wrong wastes your first PR.

`docs/CI_CD.md` describes the checks and merge rules in detail. This file is the short version.

## 1. Pick your domain and clone only it

```bash
# examples — clone ONE domain, not the whole world
git clone git@github.com:hackathon-by-hgs/code-paste.git -b backend  --single-branch code-paste-backend
git clone git@github.com:hackathon-by-hgs/code-paste.git -b frontend --single-branch code-paste-frontend
```

Keep the docs alongside as a worktree (DEV_GUIDE §3.2):

```bash
git remote set-branches --add origin main && git fetch origin main
git worktree add ../code-paste-docs main
```

## 2. Branch, commit, and title conventions

- Feature branch **off your domain branch**, prefixed with the domain and a hyphen:
  `backend-feat-device-reg`, `mobile-fix-clipboard-wake`. (A nested `backend/feat-…` ref is
  impossible — `refs/heads/backend` already exists, so git rejects `refs/heads/backend/…`. Each
  domain's CI triggers on the hyphenated `<domain>-*` form.)
- Commits and **PR titles** are [Conventional Commits](https://www.conventionalcommits.org/) with a
  scope. CI enforces the PR title (`pr-title` check):

  ```text
  feat(backend): register device public keys
  fix(mobile): stop rebroadcast after remote clipboard write
  docs(main): pin contract tooling
  chore(deps): bump next from 16.3.4 to 16.3.5
  ```

- **The PR base is always your domain branch.** A PR from `backend/*` into `frontend` or `main` is a
  mistake — the histories are unrelated and the diff is the entire tree (DEV_GUIDE §3.4, §9).

## 3. Before you push — run the checks

Never push failing code; "it's a small change" is not an exception (CLAUDE.md anti-patterns). Run
your domain's gate set locally. For example:

```bash
# backend
npm run format && npm run lint && npm run typecheck && npm run build
npm run contracts:pin && npm run test:unit && npm run test:contract && npm run test:integration && npm run test:security && npm run test:e2e

# frontend
pnpm install --frozen-lockfile && pnpm exec tsc --noEmit && pnpm run lint && pnpm run test && pnpm run build

# mobile
flutter pub get && dart format --output=none --set-exit-if-changed lib test && flutter analyze --no-pub && flutter test --no-pub
```

## 4. Open the PR

The template asks six questions (DEV_GUIDE §8) — answer all of them, and **paste the actual test
output**. Do not claim checks you did not run (RULES.md §5). A PR is not complete if meaningful
behaviour has no test (RULES.md §8).

To merge, a PR needs (see `docs/CI_CD.md` §2): all required checks green, at least one approving
review, resolved threads, and a linear-history (squash/rebase) merge.

## 5. Changing a contract (high blast radius)

Contracts live on `main` and every domain pins them. To change one:

1. PR to `main`: update the schema, the valid **and** invalid vectors, and
   `docs/PROTOCOL.md` / `docs/API_CONTRACTS.md` together. `main CI` proves they stay consistent.
2. Bump `contracts/VERSION`; tag `main` with a new `protocol-v*` (breaking → new major).
3. Add a cross-cutting handoff in `docs/HANDOFFS/` listing **every domain that must move**.
4. Each domain bumps its own `CONTRACTS_VERSION` in its own PR, at its own pace.

Breaking changes get a new protocol version — never a silent redefinition of v1.

## 6. Security and secrets

- Clipboard data is sensitive by default. Never log clipboard contents or tokens; never put them in
  crash reports or analytics (RULES.md §2).
- Never commit `.env`, tokens, private keys, or device keys — only `.env.example`. CI rejects them.
- Report vulnerabilities privately (see `.github/SECURITY.md`), never in a public issue.

## 7. Definition of done (RULES.md §11)

Not "it compiles." **Correct · tested · secure · documented · integrated · handed off.** Update your
domain's `HANDOFF.md` in the same PR as the work.
