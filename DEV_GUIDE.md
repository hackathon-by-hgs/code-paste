# Developer Guide — Repository & Branch Layout

This document is the **authority on how this repository is physically organised**.

`docs/SYSTEM_DESIGN.md` defines the *logical* boundaries (control plane, data plane, clients,
shared contracts). This document defines where that code actually lives and how you check it out.

---

## 1. The model in one picture

We do **not** use a monorepo with everything on `main`.

Each domain lives on its **own long-lived orphan branch**. A branch contains exactly one
top-level product folder plus its own tooling.

```text
origin/main        docs, contracts, AI/agent config      (no product code)
origin/shared      shared/      protocol + domain types
origin/backend     backend/     control plane API
origin/frontend    frontend/    web application
origin/desktop     desktop/     background clipboard agent
origin/mobile      mobile/      mobile client
```

These branches have **unrelated histories**. They are never merged into each other.
They are parallel roots in one repository, not a line of development.

A developer working on one domain clones exactly that domain and nothing else:

```bash
git clone git@github.com:hackathon-by-hgs/code-paste.git -b backend --single-branch code-paste-backend
cd code-paste-backend
ls
# backend/  README.md  CLAUDE.md  CONTRACTS_VERSION  .github/
```

### Why

- A backend developer never downloads the mobile toolchain.
- CI on a domain branch runs only that domain's checks.
- Each domain owns its own language, build, lockfile and release cadence.
- Ownership is enforced by checkout, not by convention (`CLAUDE.md` §"Multi-agent rule":
  *avoid simultaneous edits to the same files* — here that is structurally impossible).
- Consolidating into a monorepo later is a mechanical `git merge --allow-unrelated-histories`,
  because every branch's tree is already prefixed by its folder name.

---

## 2. Branch map

| Branch | Owns | Top-level folder | May depend on |
|---|---|---|---|
| `main` | Docs, ADRs, protocol spec, contract fixtures, agent config | *(none — no product code)* | — |
| `shared` | Protocol/domain types, validation, test vectors | `shared/` | `main` contracts |
| `backend` | Auth, device registry, ACL, share sessions, signaling | `backend/` | `main` contracts, `shared` |
| `frontend` | Account/device/sharing web UI | `frontend/` | `main` contracts, `shared`, `backend` API |
| `desktop` | OS clipboard agent, LAN discovery, peer transport | `desktop/` | `main` contracts |
| `mobile` | iOS/Android clipboard + share integration | `mobile/` | `main` contracts |

Adding a domain (e.g. `relay`) means adding a row here **and** an ADR in `docs/`. Do not create a
long-lived branch that this table does not list.

### `main` is not a trunk

`main` holds no product code. It holds the things every domain must agree on:

```text
main
├── CLAUDE.md                  agent operating contract
├── README.md
├── DEV_GUIDE.md               this file
├── .codex/skills/             agent skills
├── contracts/                 machine-readable contracts (see §5)
└── docs/
    ├── SYSTEM_DESIGN.md
    ├── RULES.md
    ├── SECURITY.md
    ├── PROTOCOL.md
    ├── API_CONTRACTS.md
    ├── TEST_STRATEGY.md
    └── HANDOFFS/
```

Changing `main` changes every domain's obligations. Treat every `main` PR as a cross-cutting change:
it needs a reason, an ADR or doc update, and a note in `docs/HANDOFFS/`.

---

## 3. Working on a domain

### 3.1 Clone

```bash
# pattern
git clone git@github.com:hackathon-by-hgs/code-paste.git -b <domain> --single-branch code-paste-<domain>

# examples
git clone git@github.com:hackathon-by-hgs/code-paste.git -b backend  --single-branch code-paste-backend
git clone git@github.com:hackathon-by-hgs/code-paste.git -b frontend --single-branch code-paste-frontend
```

`--single-branch` is deliberate. Without it you fetch every domain's history for no reason.

### 3.2 Get the docs and agent config alongside your code

Your domain branch carries only a thin `CLAUDE.md` pointer. The real docs live on `main`.
Check `main` out as a sibling worktree once:

```bash
git remote set-branches --add origin main
git fetch origin main
git worktree add ../code-paste-docs main
```

You now have:

```text
code-paste-backend/     your branch, your code
code-paste-docs/        main: CLAUDE.md, docs/, contracts/, .codex/skills/
```

`git -C ../code-paste-docs pull` refreshes the docs. This is the supported way to satisfy
`CLAUDE.md` §"Engineering workflow" step 1–5 while working on a domain branch.

### 3.3 Work on two domains at once

Debugging the web app against the API does not mean cloning twice:

```bash
git remote set-branches --add origin frontend
git fetch origin frontend
git worktree add ../code-paste-frontend frontend
```

Each worktree is an independent checkout of an independent history in one `.git`.

### 3.4 Feature branches

Branch off your domain branch, prefixed with the domain. PR back into the domain branch.

```bash
git switch -c backend/feat-device-registration   # from `backend`
```

| Form | Example |
|---|---|
| Feature | `backend/feat-device-registration` |
| Fix | `desktop/fix-clipboard-loop-on-wake` |
| Docs/contract | `main/docs-protocol-v1-size-limits` |

**The PR base is always the domain branch it came from.** A PR from `backend/*` into `frontend`
or `main` is always a mistake — the histories are unrelated and the diff will be the entire tree.

---

## 4. Layout inside a domain branch

Every domain branch has the same shape at the root:

```text
<branch root>
├── <domain>/              all product code — the only folder that grows
├── .github/workflows/     this domain's CI (see §6)
├── CLAUDE.md              thin pointer to main's contract + domain-specific rules
├── CONTRACTS_VERSION      pinned contract tag from main (see §5)
├── HANDOFF.md             current state of this domain (see §7)
├── .env.example           every required variable, no real values
└── README.md              how to run *this* domain in under 5 minutes
```

Nothing else at the root. Build config, lockfiles and source belong inside `<domain>/`.

### Illustrative skeletons

Stack per domain is the branch owner's decision, recorded as an ADR on `main`. The internal
boundaries below are not optional — they come from `docs/RULES.md` §3.

```text
backend/                         frontend/                    desktop/
├── src/                         ├── src/                     ├── src/
│   ├── auth/                    │   ├── routes/              │   ├── clipboard/     OS provider
│   ├── devices/                 │   ├── features/            │   ├── discovery/     LAN
│   ├── sharing/                 │   ├── components/          │   ├── transport/     peer channel
│   ├── protocol/                │   ├── api/                 │   ├── crypto/
│   ├── persistence/             │   └── lib/                 │   ├── queue/
│   └── http/                    ├── tests/                   │   └── daemon/
├── tests/                       └── ...                      ├── tests/
└── ...                                                       └── ...
```

Rules that apply inside every domain:

- Domain types must not import UI or framework types.
- Discovery, transport, clipboard provider, auth, persistence and relay are **interfaces**, with
  concrete implementations behind them (`CLAUDE.md` §"Default implementation philosophy").
- No cross-folder reach-around imports. `http/` may call `devices/`; `devices/` must not call `http/`.

---

## 5. How branches stay compatible

Branches cannot import each other's source. Compatibility is enforced by **contracts on `main`**.

```text
main/contracts/
├── VERSION                             e.g. protocol-v1.0.0
├── schema/
│   ├── clipboard-event.schema.json     the envelope in docs/PROTOCOL.md
│   ├── device.schema.json
│   └── share-session.schema.json
├── openapi/
│   └── control-plane.yaml              the endpoints in docs/API_CONTRACTS.md
└── vectors/
    ├── valid/                          events every implementation MUST accept
    └── invalid/                        events every implementation MUST reject
```

`vectors/invalid/` is the security surface: oversized payloads, bad hashes, replayed sequence
numbers, unknown content types, spoofed sender IDs. Every domain that parses a clipboard event
must fail its build if it accepts one of these.

### Pinning

Each domain branch has a `CONTRACTS_VERSION` file containing a tag on `main`:

```text
protocol-v1.0.0
```

Domain CI fetches that tag from `main` and runs the conformance tests against it. No vendoring,
no copies, no drift:

```bash
git fetch origin --tags --depth=1
git archive "$(cat CONTRACTS_VERSION)" contracts | tar -x -C .contracts/
# run your conformance suite against .contracts/
```

`.contracts/` is gitignored. You never commit contract copies.

### Changing a contract

1. PR to `main`: update `docs/PROTOCOL.md` / `docs/API_CONTRACTS.md`, the schema, and the vectors.
2. Tag `main` (`protocol-v1.1.0`).
3. Note it in `docs/HANDOFFS/`, listing every domain that must move.
4. Each domain bumps its own `CONTRACTS_VERSION` in its own PR, at its own pace.

Breaking changes get a new protocol version, never a silent redefinition of `v1`.

### `shared` branch

`shared/` exists for domains that speak the same language (today: `backend` and `frontend`).
It is consumed as a **pinned dependency from a git tag**, never copy-pasted:

```jsonc
// backend/package.json
"dependencies": {
  "@code-paste/shared": "github:hackathon-by-hgs/code-paste#shared-v1.0.0"
}
```

Domains in other languages (`desktop`, `mobile`) do **not** consume `shared`. They implement the
spec natively and prove correctness against `contracts/vectors/`. That is the whole point of
having vectors: correctness is verified per language, not assumed from a shared package.

---

## 6. CI

Each domain branch carries its own `.github/workflows/ci.yml`. GitHub runs the workflow that
exists on the branch being pushed and on a PR's base branch — so a domain branch's CI is defined
by, and only by, that domain. There is no central workflow to coordinate.

Minimum gates on every domain branch (`docs/RULES.md` §5, `docs/TEST_STRATEGY.md`):

```text
format
lint
typecheck
unit
contract-conformance     # vectors from the pinned CONTRACTS_VERSION
integration
build
```

`main`'s CI validates docs and contracts: schemas parse, OpenAPI is valid, every vector matches
its schema, links resolve.

Never push a branch with failing checks. "It's a small change" is not an exception
(`CLAUDE.md` §"Anti-patterns").

---

## 7. Handoffs

`CLAUDE.md` requires a handoff after meaningful work. With branch-per-domain there are two kinds:

- **Domain handoff** → `HANDOFF.md` at the root of the domain branch. Current state, what works,
  what is stubbed, what the next person should pick up. Updated in the same PR as the work.
- **Cross-cutting handoff** → `docs/HANDOFFS/` on `main`, using `docs/AGENT_HANDOFF_TEMPLATE.md`.
  Required whenever a change affects another domain: contract changes, new endpoints, protocol
  version bumps, security model changes.

If your change forces another branch to change, the `main` handoff is not optional.

---

## 8. Commits and PRs

Commit scope is the domain (`docs/RULES.md` §7):

```text
feat(backend): register device public keys
fix(desktop): stop rebroadcast after remote clipboard write
test(shared): reject oversized image payloads
docs(main): define contract pinning for domain branches
```

Every PR answers, in the description:

1. What changed?
2. Why?
3. Which architecture boundary moved?
4. How was it tested? (paste the actual output — do not claim checks you did not run)
5. What are the security/privacy implications?
6. What is left?

---

## 9. Hard rules

Never:

- Merge one domain branch into another. They are unrelated histories; the diff is meaningless
  and the result is unreviewable.
- Put product code on `main`.
- Copy `contracts/` or `shared/` source into a domain branch. Pin a version instead.
- Force-push a domain branch. Feature branches you own are yours; `main`, `shared`, `backend`,
  `frontend`, `desktop`, `mobile` are shared and protected.
- Commit `.env`, tokens, private keys or device keys. `.env.example` only.
- Create a long-lived branch that is not in the §2 table.
- Depend on another domain's internal file paths. If you need something from another domain,
  it belongs in a contract on `main`.

---

## 10. Bootstrapping the branches (one-time)

The repository currently has no commits. This section creates the structure above; it is run
once, by one person, and then this section is history.

```bash
cd /path/to/code-paste

# 1. main — docs, contracts, agent config (already staged in the working tree)
git add CLAUDE.md README.md DEV_GUIDE.md docs .codex contracts
git commit -m "docs(main): establish contracts, agent config and branch layout"
git push -u origin main
git tag protocol-v1.0.0 && git push origin protocol-v1.0.0
```

Then create each domain as an **orphan** branch — a fresh root with no shared history:

```bash
for domain in shared backend frontend desktop mobile; do
  git switch --orphan "$domain"
  git rm -rf . >/dev/null 2>&1 || true   # empty the index inherited from the previous checkout
  mkdir -p "$domain" .github/workflows
  echo "protocol-v1.0.0" > CONTRACTS_VERSION
  printf '# %s\n\nSee `DEV_GUIDE.md` on `main` for the branch layout.\n' "$domain" > README.md
  printf '# Handoff — %s\n\nNothing implemented yet.\n' "$domain" > HANDOFF.md
  printf '.contracts/\n.env\n' > .gitignore
  git add -A
  git commit -m "chore($domain): initialise $domain branch"
  git push -u origin "$domain"
done

git switch main
```

Afterwards, in GitHub settings:

- Protect `main`, `shared`, `backend`, `frontend`, `desktop`, `mobile`: no force-push,
  no deletion, PR + passing checks required.
- Set the default branch to `main`.
- Add each domain's `CODEOWNERS` on its own branch.

---

## 11. FAQ

**I cloned and only see one folder — where is everything else?**
Working as intended. Clone another branch, or add it as a worktree (§3.3).

**Where do I read `CLAUDE.md`, `docs/RULES.md`, the ADRs?**
`main`. Add it as a sibling worktree once (§3.2). Your domain branch has a pointer stub only.

**How do I run the frontend against the backend?**
Two worktrees (§3.3), each running its own dev command, wired through `.env` — never through
hardcoded paths across branches.

**We want a monorepo later. Are we stuck?**
No. Every branch's tree is already prefixed by its folder name, so a monorepo is
`git merge --allow-unrelated-histories` per branch, with full history preserved. That is the main
reason each branch has a `<domain>/` folder instead of putting its code at the branch root.

**Something is genuinely shared but is not a contract.**
Then it is a contract you have not written down yet. Add it to `main/contracts/` with vectors,
or put it in `shared/` and pin it. Do not copy it.
