# Handoff — frontend

## Current State
- The `frontend` branch now hosts a **Next.js** application using **TailwindCSS V4** and **pnpm** as its build tool, adhering to the updated requirements.
- The project structure strictly follows `DEV_GUIDE.md`:
  - `CLAUDE.md`, `.env.example`, `CONTRACTS_VERSION`, `HANDOFF.md`, `README.md` at branch root.
  - `.github/workflows/ci.yml` implements the mandated CI gates.
  - `src/` contains internal boundaries (`routes`, `features`, `components`, `api`, `lib`).
  - `tests/` contains UI tests.
- A fully functional MVP UI mock for the control plane (Auth, Device Management, Sync preferences, Sharing sessions) has been built in `src/app/page.tsx` as a client component (`'use client'`).
- Test coverage with **Vitest** and **React Testing Library** is implemented and passes.
- `@code-paste/shared` is declared as a git dependency.

## What Works
- The basic UI layout for devices, sync settings, and sharing sessions is completely mocked up and interactive in the browser.
- The Next.js dev server builds and runs successfully.
- Tests, linting, and build pipeline all succeed.

## What is Stubbed
- All data (devices list, sharing session members) is currently mocked in React state.
- API interactions with the backend control plane are stubbed in the JS handlers.

## Next Steps
- Connect the frontend UI logic to actual API endpoints via `fetch` or a data fetching library once the backend contract APIs are available.
- Define proper data structures importing from the `@code-paste/shared` repository package once it is published.
