# Skill: System Design Review

## Purpose

Review architecture changes for simplicity, correctness, security, and multi-agent maintainability.

## Procedure

1. Read `CLAUDE.md`.
2. Read `docs/SYSTEM_DESIGN.md`.
3. Identify the affected boundary.
4. Check whether the proposal adds unnecessary infrastructure.
5. Check data flow.
6. Check authorization.
7. Check failure modes.
8. Check platform constraints.
9. Check testability.
10. Record decisions in an ADR if architecture changes.

## Review questions

- Does LAN discovery accidentally become authorization?
- Does this expose clipboard contents to the server unnecessarily?
- Can a revoked device still receive data?
- Can a remote clipboard event loop forever?
- Can malformed network input crash the agent?
- Is there a simpler design?
- Can another agent work on this subsystem independently?
- Is the API contract explicit?
- Are tests specified before implementation?

## Output

Produce:
- risks,
- recommendations,
- required changes,
- tests,
- ADR requirement if applicable.
