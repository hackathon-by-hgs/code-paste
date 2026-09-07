# Skill: Implementation

## Goal

Implement a small, testable change without destabilizing adjacent subsystems.

## Workflow

### 1. Understand

Read:
- `CLAUDE.md`
- relevant system-design sections
- current handoff notes
- existing code/tests

### 2. Plan

Write:
- scope,
- files,
- interfaces,
- test plan,
- dependencies.

### 3. Implement

Rules:
- preserve boundaries,
- prefer existing utilities,
- avoid unrelated refactors,
- keep APIs explicit,
- handle errors deliberately.

### 4. Test

Run:
- unit tests,
- integration tests when applicable,
- typecheck,
- lint,
- build.

### 5. Review

Check:
- security,
- privacy,
- platform behavior,
- race conditions,
- retry behavior,
- duplicate events,
- backwards compatibility.

### 6. Handoff

Update `docs/HANDOFFS/` with:
- changes,
- tests,
- decisions,
- limitations,
- next steps.
