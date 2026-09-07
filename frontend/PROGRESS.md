# Frontend Branch — Progress & Status Document

> **Branch:** `frontend`
> **Repository:** `hackathon-by-hgs/code-paste`
> **Last Updated:** 2026-09-08
> **Stack:** Next.js 16 · TailwindCSS v4 · pnpm · TypeScript · Vitest

---

## 1. Overview

This document records everything that has been built on the `frontend` branch, the decisions made along the way, and the outstanding work that remains before this domain can be considered production-ready.

The `frontend` branch is an **orphan branch** — it shares no git history with `main`. This is intentional, as defined in `docs/RULES.md` and `docs/DEV_GUIDE.md`. Each domain (`frontend`, `backend`, `desktop`, etc.) lives in its own isolated branch and communicates only through the shared contracts defined in `main:contracts/`.

---

## 2. Commit History

| Commit | Description |
|---|---|
| `0dedc0c` | `refactor`: convert component functions to arrow functions |
| `29928aa` | `feat`: decompose page into components; add API stubs and integration tests |
| `482a854` | `test`: switch from jsdom to happy-dom; fix outdated test assertion |
| `8282709` | `fix`: correct `LayoutProps` type error in `layout.tsx` |
| `fc0c2f1` | `fix`: remove unavailable `@code-paste/shared` dependency; fix workspace config |
| `d9dc021` | `chore`: harden root `.gitignore` |
| `1bcc868` | `style`: full-width 3-column grid layout |
| `1785096` | `style`: reduce whitespace and tighten UI |
| `edc61bd` | `style`: implement black and white theme |
| `5bfddb2` | `chore`: implement CI, test frameworks, and branch boundaries |
| `acc9e60` | `refactor`: migrate to Next.js + TailwindCSS v4 + pnpm |
| `c410bbc` | `feat`: initial vanilla HTML/JS/CSS app skeleton |
| `6ac21e2` | `chore`: initialise frontend orphan branch |

---

## 3. What Has Been Done

### 3.1 Project Bootstrap
- Initialised `frontend` as an **orphan branch** with no history from `main`
- Migrated from vanilla HTML/CSS/JS to **Next.js 16 (App Router)** + **TailwindCSS v4** + **pnpm**
- Set up `pnpm-workspace.yaml` correctly so that `pnpm install` resolves without errors in CI

### 3.2 UI Implementation
- Implemented a full-width **3-column grid layout** as per `docs/DESIGN_SYSTEM.md`
  - **Column 1 (Left):** Sync Status — toggle to pause/resume clipboard syncing
  - **Column 2 (Middle):** My Devices — list, register, and revoke devices
  - **Column 3 (Right):** Sharing Session — create, join, and manage sharing sessions
- Applied a strict **black and white colour scheme** (no greys, no accent colours)
- Header bar with app name and authentication state

### 3.3 Component Architecture
`page.tsx` was decomposed from a 171-line monolith into composable, single-responsibility components:

| File | Responsibility |
|---|---|
| `src/components/Header.tsx` | App header; authentication state (login/logout) |
| `src/components/SyncStatus.tsx` | Clipboard sync toggle |
| `src/components/DeviceList.tsx` | Device listing, registration, and revocation |
| `src/components/SharingSession.tsx` | Session creation, joining, and member management |
| `src/app/page.tsx` | Root page — composes the four components above |

All component main functions use **arrow function** syntax (`export const X = () =>`).  
`layout.tsx` is intentionally kept as a **named function declaration** — Next.js App Router relies on static analysis of this file for font hoisting and metadata exports.

### 3.4 API Client Stubs
Typed client stubs were created in `src/api/` based directly on `main:contracts/openapi/control-plane.yaml`:

| File | Endpoints |
|---|---|
| `src/api/types.ts` | `User`, `Device`, `ShareSession`, `ShareMember` interfaces |
| `src/api/auth.ts` | `login()`, `logout()`, `getCurrentUser()` |
| `src/api/devices.ts` | `getDevices()`, `registerDevice()`, `revokeDevice(id)` |
| `src/api/sharing.ts` | `createSession()`, `joinSession(code)`, `revokeMember(userId)` |

> **Note:** These are currently **mock implementations** that return synthetic data with simulated network delays. When the `backend` domain publishes its API URL, the mock bodies are replaced with `fetch()` calls — the function signatures remain identical.

### 3.5 Integration Tests
Tests live in `tests/integration/` and cover the three flows mandated by `docs/TEST_STRATEGY.md`:

| Test File | Scenarios Covered |
|---|---|
| `tests/integration/device-management.test.tsx` | Device list loads; device revocation removes device from UI |
| `tests/integration/sharing-session.test.tsx` | No session on first load; starting a session shows member list |

**Test results: 5/5 passing** across 3 test files (including the original `tests/page.test.tsx`).

### 3.6 CI Pipeline
The GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push to `frontend` and executes:

| Step | Command | Status |
|---|---|---|
| Install dependencies | `pnpm install` | ✅ Passing |
| Typecheck | `pnpm tsc --noEmit` | ✅ Passing |
| Lint | `pnpm run lint` | ✅ Passing |
| Test (Unit & Integration) | `pnpm run test` | ✅ Passing |
| Build | `pnpm run build` | ✅ Passing |
| Contract Conformance | *(see Section 4)* | ⏳ Placeholder only |

### 3.7 Governance
- Added `frontend/CODEOWNERS` — all changes to this domain require a review from `@willy264`
- Hardened root `.gitignore` to globally exclude `node_modules/`, `.next/`, `.env*`, private keys, and other sensitive files

---

## 4. What Remains

### 4.1 ⏳ Contract Conformance CI Step *(High Priority)*
**File:** `.github/workflows/ci.yml` — lines 44–49

The `Contract Conformance` step currently just prints a version string:
```yaml
- name: Contract Conformance
  run: |
    echo "Validating against $(cat ../CONTRACTS_VERSION)"
```

It must be replaced with a real validator that:
1. Reads the JSON schemas from `main:contracts/schema/`
2. Reads every test vector from `main:contracts/vectors/valid/` and `main:contracts/vectors/invalid/`
3. Asserts that valid vectors pass and invalid vectors are correctly rejected

The contract schemas and vectors already exist in the repository. This step needs a small validation script (Node.js + `ajv`) to be wired up.

---

### 4.2 ⏳ Wire UI to Real Backend API *(Blocked on backend domain)*
Once the `backend` domain publishes its base URL and deploys the control-plane endpoints, the mock implementations in `src/api/` must be replaced with real `fetch()` calls.

Each mock file has a comment marker showing exactly where the replacement goes. The TypeScript interfaces in `src/api/types.ts` already match the OpenAPI contract, so no type changes are expected.

**Endpoints needed (from `contracts/openapi/control-plane.yaml`):**

| Endpoint | Method | Description |
|---|---|---|
| `/auth/login` | `POST` | Exchange credentials for token pair |
| `/auth/logout` | `POST` | Revoke current session token |
| `/auth/me` | `GET` | Get current authenticated user |
| `/devices` | `GET` | List all registered devices |
| `/devices` | `POST` | Register a new device via pairing code |
| `/devices/:id/revoke` | `POST` | Revoke a device |
| `/share-sessions` | `POST` | Create a new sharing session |
| `/share-sessions/:id/join` | `POST` | Join a session via 8-char code |
| `/share-sessions/:id/revoke-member` | `POST` | Remove a member from a session |

---

### 4.3 ⏳ Real-time Peer Roster *(Blocked on backend + desktop domains)*
The OpenAPI spec defines a `SignedPeerRoster` — a signed list of authorised devices for local LAN syncing. The frontend must:
1. Fetch `/devices/peer-roster` periodically or via WebSocket
2. Verify the Ed25519 signature against the public roster keys from `/devices/roster-keys`
3. Pass the verified roster to the local sync engine

This work is also dependent on `docs/ADR-003-PEER-ROSTER-DISTRIBUTION.md` and the realtime channel spec in `docs/ADR-006-REALTIME-CONTROL-CHANNEL.md`.

---

### 4.4 ⏳ Authentication Token Handling
Currently `src/api/auth.ts` uses in-memory state (a local variable). A production implementation must:
- Store the JWT access token and refresh token securely (e.g. `httpOnly` cookies managed by the server)
- Implement automatic token refresh via `/auth/refresh` before expiry
- Handle `401 Unauthorized` responses globally and redirect to login

---

### 4.5 ⏳ Error Boundaries and Loading States
Components currently show simple `"Loading..."` text. Before production:
- Add React error boundaries to gracefully handle API failures
- Add proper skeleton loaders or spinners
- Handle and display API error messages to the user

---

## 5. Architecture Notes

### Branch Strategy
`frontend` is an orphan branch. **Do not merge it into `main`.** There is no shared history and the diff would be meaningless. Collaboration across domains happens exclusively through the contracts in `main:contracts/`.

### Sensitive Files — Never Push
The root `.gitignore` protects these, but as a reminder:
- `node_modules/`
- `.next/` (build output)
- `.env`, `.env.local`, `.env*.local`
- `*.pem`, `*.key`, `id_rsa*` (private keys)
- `pnpm-debug.log`

### Next.js Conventions
- `layout.tsx` **must** stay as a named function declaration — Next.js statically analyses it for font and metadata hoisting
- All other components and pages use arrow function syntax
- `'use client'` directive is required at the top of any component that uses React hooks (`useState`, `useEffect`, etc.)
