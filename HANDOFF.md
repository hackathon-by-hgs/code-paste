# Handoff — backend

## Agent
`principal-engineer / control-plane`

## Date
2026-09-07

## Milestone
Branch bootstrap.

## Status

Branch established with root layout per `DEV_GUIDE.md` §4. Implementation in progress; this file
is rewritten when it lands.

## Next agent should know

- `CONTRACTS_VERSION` pins `protocol-v1.0.0`, which is tagged on `main` **only after** PR #1
  merges. Until then `npm run contracts:pin` will fail to resolve the tag.
- Tests need no database. See `README.md`.
