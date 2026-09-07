# CI/CD & Merge Governance

This is the concrete enforcement layer for `DEV_GUIDE.md` §6 ("CI") and `RULES.md` §5 ("Testing
policy"). `DEV_GUIDE.md` says *what* each branch must gate; this document says *exactly which checks
run, what must pass before code reaches an upstream branch, and how that is configured*.

> **Model reminder (DEV_GUIDE.md §2):** this repo is **branch-per-domain with unrelated histories**.
> There is no monorepo and no central pipeline. Each branch carries its own workflows, its own
> `CODEOWNERS`, and its own PR template. Repo-wide config that GitHub reads only from the default
> branch (issue templates, Dependabot, the security policy, rulesets) lives on `main`.

---

## 1. The pipeline, per branch

Every workflow is scoped to one branch and runs only for it (the workflow file only exists on that
branch). Gate sets follow `TEST_STRATEGY.md` "Required CI gates": `format · lint · typecheck · unit ·
contract-conformance · integration · build`, plus security/secret hygiene.

| Branch | Workflow(s) | Required checks (merge gate) | Non-blocking |
|---|---|---|---|
| `main` | `main-ci.yml`, `pr-hygiene.yml` | `contracts`, `docs-links`, `actionlint`, `secret-scan`, `pr-title` | `labeler` |
| `backend` | `backend-ci.yml`, `codeql.yml` | `format · lint · typecheck · build`, `tests (pglite)`, `tests (postgres)`, `dependency audit`, `no secrets committed`, `pr-title` | `codeql` |
| `frontend` | `ci.yml`, `codeql.yml` | `quality`, `contract-conformance`, `pr-title` | `codeql` |
| `mobile` | `ci.yml` | `checks`, `contract-conformance`, `build`, `pr-title` | `build-ios`, `release` |
| `shared` | *(bootstrap from `docs/ci/templates/shared-ci.yml`)* | `quality`, `contract-conformance`, `pr-title` | — |
| `desktop` | *(bootstrap from `docs/ci/templates/desktop-ci.yml`)* | `quality (ubuntu/macos/windows)`, `contract-conformance`, `pr-title` | — |

The **required checks** column is the source of truth for the `required_status_checks` contexts in
`.github/rulesets/<branch>.json`. If you rename a job, update the matching ruleset and re-run
`scripts/apply-rulesets.sh`, or the gate silently stops enforcing (a required check that never
reports is treated as pending, not failing — so keep names in sync).

### What each gate proves

- **`contracts` (main)** — every JSON Schema compiles; every valid vector is accepted; every
  `rejectedBy:"schema"` vector is rejected; the OpenAPI is a structurally valid 3.1 document. This
  is the security surface: an implementation that accepts a bad vector has a bug (DEV_GUIDE §5).
- **`contract-conformance` (domains)** — the domain fetches the pinned `CONTRACTS_VERSION` from
  `main` and proves it still satisfies it. No vendoring, no drift.
- **`pr-title`** — the PR title is a Conventional Commit with a known scope. Squash-merge turns that
  title into the permanent history (RULES.md §7).
- **`secret-scan` / `no secrets committed`** — no `.env`, private keys, or token-shaped strings are
  committed (DEV_GUIDE §9, RULES.md §2.15–16).
- **`codeql`** — static security analysis. Runs as its own workflow and is **not** a merge gate, so
  a repo without code scanning enabled can never deadlock merges.

---

## 2. Rules that must pass before an upstream merge

"Upstream" = the protected long-lived branches (`main`, `shared`, `backend`, `frontend`, `desktop`,
`mobile`). Enforced by **repository rulesets** (config-as-code in `.github/rulesets/`, applied by
`scripts/apply-rulesets.sh`). For every protected branch:

1. **No direct pushes.** Change lands only through a pull request.
2. **PR base = the same domain branch.** A PR from `backend/*` into `frontend` or `main` is rejected
   by review — the histories are unrelated (DEV_GUIDE §3.4).
3. **≥ 1 approving review**, stale reviews dismissed on new pushes, all review threads resolved.
4. **All required status checks green** and the branch up to date with its base
   (`strict_required_status_checks_policy: true`).
5. **Linear history** — squash or rebase only; no merge commits; no force-push; no branch deletion.
6. **Tag protection** — `protocol-v*` and `shared-v*` tags cannot be moved or deleted, so a pinned
   contract version is immutable (`rulesets/tags.json`).

**Break-glass:** the rulesets let the repo **Admin** role bypass. Remove the `bypass_actors` block
for a stricter posture once the team no longer needs it.

**Code-owner review** is defined in each branch's `CODEOWNERS` but **enforcement is OFF by default**
(`require_code_owner_review: false`) so a placeholder team handle cannot deadlock merges. To enable:
replace the placeholder handles with real teams, set the flag to `true` in the branch's ruleset, and
re-run the apply script.

### Applying / changing the rules

```bash
gh auth login                       # admin on the repo, once
brew install jq                     # or your package manager
scripts/apply-rulesets.sh           # create/update all rulesets, labels, merge settings
DRY_RUN=1 scripts/apply-rulesets.sh # preview without changing anything
```

Rulesets can also be imported in the UI: **Settings → Rules → Rulesets → New ruleset → Import**, then
select a file from `.github/rulesets/`.

---

## 3. Best practices baked in (and why)

| Practice | Where | Why |
|---|---|---|
| Least-privilege `permissions` (`contents: read`) | every workflow | A leaked token from a third-party action can't write to the repo (GitHub hardening guide). |
| `concurrency` with `cancel-in-progress` | every workflow | Superseded runs are cancelled — faster feedback, fewer wasted minutes. |
| Dependency caching (npm/pnpm/pub/Gradle/Flutter) | every workflow | The single biggest CI speed-up; keeps PR feedback tight. |
| Frozen/locked installs (`npm ci`, `--frozen-lockfile`) | every workflow | Reproducible builds; a stale lockfile fails loudly instead of resolving new code. |
| `timeout-minutes` on every job | every workflow | A hung job can't burn the runner budget for six hours. |
| Pinned tool versions (Redocly, actionlint, Flutter) | workflows | A compromised or breaking upstream release can't silently change a gate. |
| Matrix testing (DB drivers; desktop OSes) | backend, desktop | Catches environment-specific bugs before production. |
| Fast checks fan out in parallel jobs | all | Wall-clock = slowest job, not the sum. |
| Expensive/flaky jobs are non-blocking or push-only | `codeql`, `build-ios` | Keeps the *merge gate* fast and deterministic; deep scans still run. |
| Conventional-Commit PR titles + squash merge | `pr-title` + settings | Readable, machine-parseable history; enables future changelog automation. |
| Dependabot across all branches from one config | `dependabot.yml` | Security patches without per-branch config drift (uses `target-branch`). |
| Auto-delete merged branches, auto-merge enabled | repo settings | Clean branch list; PRs merge themselves once green + approved. |

### Speed levers to reach for as volume grows

- **Path filters / changed-files gating** so a docs-only PR skips heavy build jobs.
- **Merge queue** (`Settings → Merge queue`) instead of `strict` up-to-date checks once several PRs
  land per day — it batches and tests the merged result without serial rebasing.
- **Self-hosted or larger runners** for the mobile/desktop native builds if queue time hurts.
- **SHA-pin third-party actions** (not just major tags) for the strongest supply-chain posture;
  Dependabot's `github-actions` updates keep the SHAs current.

---

## 4. Adding a new domain (e.g. `relay`)

1. Bootstrap the orphan branch (DEV_GUIDE §10) with `<domain>/`, `CONTRACTS_VERSION`, `HANDOFF.md`.
2. Copy a template from `docs/ci/templates/` into `.github/workflows/` and adapt the toolchain,
   keeping stable job **names**.
3. Add `.github/CODEOWNERS` and `.github/pull_request_template.md` (templates in `docs/ci/templates/`).
4. Add `.github/rulesets/<domain>.json` on `main` (copy `frontend.json`, swap branch + contexts).
5. Add the branch's Dependabot entries in `.github/dependabot.yml`.
6. `scripts/apply-rulesets.sh`.
7. Add the domain row to `DEV_GUIDE.md` §2 and record the stack as an ADR.
