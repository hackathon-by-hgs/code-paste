# Handoff — frontend

## Current State
- The `frontend` branch hosts a **Next.js 16** application using **TailwindCSS V4** and **pnpm**.
- The project structure follows `DEV_GUIDE.md`:
  - `CLAUDE.md`, `.env.example`, `CONTRACTS_VERSION`, `HANDOFF.md`, `README.md` at branch root.
  - `.github/workflows/ci.yml` implements the mandated CI gates.
  - `src/` contains internal boundaries (`app`, `features`, `components`, `api`, `lib`).
  - `tests/` contains UI and client tests.
- **The UI is wired to the live control plane.** All mock data is gone; every panel talks to
  `contracts/openapi/control-plane.yaml` (`protocol-v1.0.0`, matching `CONTRACTS_VERSION`).

## What Works
- **Auth** — email/password sign-up and sign-in against `/auth/signup` and `/auth/login`.
  `invalid_request` details are rendered inline on the offending field; `invalid_credentials`
  produces one generic message, because the API deliberately does not say which half was wrong.
- **Token handling** (`src/lib/http.ts`) — bearer injection, and refresh-token rotation behind a
  **single-flight lock** so two concurrent 401s cannot trip the server's reuse detection and revoke
  the family. `token_reused` wipes the session without retrying.
- **Devices** — cursor-paginated listing, per-device pause/resume (`PATCH /devices/{id}`), and
  revoke with a confirmation that names the device.
- **Pairing** — the browser mints a code via `POST /devices/pairing-codes` and shows it once with a
  live countdown. It cannot register a device; that is the agent's call, authorised by the code.
- **Sharing** — create (join code shown once), join by session id + code, member list, owner-only
  member revocation, and stop-sharing that expires as owner or leaves as member.
- Tests (26), lint, typecheck and production build all pass.

## Design Notes
- **Tokens are in-memory only** (`src/lib/tokens.ts`), per the Web checklist in
  `docs/CLIENT_RESPONSES.md` §9: "Never log or persist a token, pairing code or join code."
  The consequence is deliberate — **a page reload signs the user out.** That module is the single
  seam if the project later moves to httpOnly refresh cookies.
- `NEXT_PUBLIC_API_URL` holds the **origin only**; `/v1` is appended in `src/lib/config.ts` so an
  API version bump (ADR-008) is a one-line change rather than an env rollout everywhere.
- Response types are not sealed — new optional fields ship inside `/v1`, and a strict decoder would
  break the app on a backend deploy.

## What is Stubbed
- Nothing in the API layer.

## Not Implemented (out of scope for a browser client)
- **Peer roster** (`/authz/peer-set`) and the **realtime socket** — both require a *device* token.
  A browser token gets `403`; a browser is not a clipboard peer. These belong to the agent.
- `GET /protocol` is wrapped in `src/api/protocol.ts` but not yet surfaced as an
  "app out of date" banner.
- Device rename (`PATCH /devices/{id}` with `name`) and delete are in the API layer but have no UI.

## Next Steps
- Surface the protocol-policy check as an out-of-date banner.
- Add device rename to the device row.
- Decide whether reload-survives-session is worth an httpOnly refresh-cookie change on the backend.
