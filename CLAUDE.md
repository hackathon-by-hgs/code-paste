# Clipboard Project — Claude / Agent Operating Contract

## Mission

Build an extremely simple cross-device clipboard system.

A user should be able to:
1. Sign in once.
2. Install/configure a small background agent on a device.
3. Copy text, images, or supported clipboard payloads normally.
4. Have the content appear on their other connected devices within seconds.
5. Share with explicitly authorized users/devices on the same trusted network when a sharing session is enabled.

**Core product principle: simplicity beats feature count.**

The target user is lazy. Every unnecessary click, setting, permission, prompt, and configuration step is a product defect.

## Non-negotiable principles

- One-tap/one-time configuration wherever the platform permits it.
- Local-first transport for local-network devices.
- Remote transport must be possible later without redesigning the domain model.
- Authentication is for identity, device registration, authorization, and future remote operation — not because LAN discovery alone is trusted.
- Never treat "same Wi-Fi" as sufficient authorization.
- Clipboard data is sensitive by default.
- No silent clipboard redistribution to unknown users.
- Explicit device/user/session membership is mandatory for sharing.
- Code quality is a first-class feature.
- Tests are mandatory before merge/push.
- Every agent must leave a handoff/update after meaningful work.
- Prefer boring, maintainable technology over clever infrastructure.
- Do not introduce a dependency unless it materially reduces complexity.
- Do not build a distributed system before the product needs one.

## Architecture direction

The system should be split into:

- **Clients**
  - Desktop background agent: primary seamless clipboard experience.
  - Mobile client: platform-appropriate clipboard/share integration.
  - Web application: account management, device management, sharing controls, history/settings where appropriate.
- **Control plane**
  - Authentication.
  - User/device registration.
  - Device public keys / capabilities.
  - Membership and authorization.
  - Optional remote signaling and future relay.
- **Data plane**
  - LAN discovery.
  - Secure peer-to-peer/local transport.
  - Optional server relay for remote/fallback scenarios.
- **Shared domain contracts**
  - Clipboard item metadata.
  - Device identity.
  - Session/share membership.
  - Protocol/version compatibility.

## Important platform reality

Do not assume a browser can continuously monitor the OS clipboard in the background.

The seamless experience requires a native/background-capable client. Web APIs have permission, focus, security, and browser lifecycle restrictions.

Do not assume iOS or Android allow unrestricted background clipboard monitoring. Design platform integrations around the actual OS capabilities and permitted user flows.

If a platform cannot provide a capability silently, provide the simplest supported alternative rather than trying to bypass the OS.

## Product behavior

### Personal sync

Default:
- User's own devices sync clipboard.
- Sync is opt-in during device setup.
- A device can pause syncing instantly.
- The user can remove a device from the account.
- Clipboard content should not be retained indefinitely.

### LAN sharing

Sharing is an explicit mode.

A user can create or join a short-lived sharing session/room.

Only authenticated users/devices that belong to that session receive clipboard data.

"Same network" is a discovery/transport optimization, not an authorization boundary.

### Clipboard payloads

Initial MVP:
- Plain text.
- Images.

Design the protocol so future payload types can include:
- Rich text.
- Files.
- URLs.
- Structured application-specific payloads.

Do not promise arbitrary clipboard fidelity across operating systems.

## Engineering workflow

Before coding:
1. Read this file.
2. Read `docs/SYSTEM_DESIGN.md`.
3. Read `docs/RULES.md`.
4. Read relevant skill files.
5. Read existing handoff notes.
6. Identify dependencies on other agents.
7. Write a small implementation plan.

After coding:
1. Run relevant tests.
2. Run type checks/lint/build where applicable.
3. Review security implications.
4. Update the relevant handoff note.
5. Summarize changed files, tests, known issues, and next steps.
6. Do not claim success without actually running the checks.

## Multi-agent rule

Agents own bounded areas.

Do not rewrite another agent's subsystem merely because your preferred architecture differs.

If a cross-cutting change is required:
- Document the reason.
- Update the relevant architecture decision.
- Notify the next agent in the handoff.

Avoid simultaneous edits to the same files.

## Definition of done

A task is not done until:
- Implementation exists.
- Relevant tests pass.
- Failure behavior is considered.
- Security/privacy impact is considered.
- Documentation/contracts are updated.
- Handoff is updated.
- Build/typecheck/lint passes where applicable.

## Anti-patterns

Never:
- Broadcast clipboard contents to every IP on a LAN.
- Trust an IP address as identity.
- Trust Wi-Fi membership as authorization.
- Store raw clipboard data permanently by default.
- Log clipboard contents.
- Put secrets/tokens in clipboard logs or analytics.
- Add microservices for hypothetical scale.
- Add a message broker before there is a demonstrated need.
- Make setup require a tutorial.
- Make agents depend on undocumented local state.
- Skip tests because a change is "small".
- Push failing code.

## Decision hierarchy

When requirements conflict, use:

1. Security/privacy.
2. Correctness.
3. Simplicity.
4. Reliability.
5. Maintainability.
6. Performance.
7. Feature breadth.

## Default implementation philosophy

Start as a modular monolith/control plane plus a simple native agent.

Use interfaces around:
- Discovery.
- Transport.
- Clipboard provider.
- Authentication.
- Authorization.
- Persistence.
- Relay.

This keeps future transport changes cheap without creating distributed-system complexity today.
