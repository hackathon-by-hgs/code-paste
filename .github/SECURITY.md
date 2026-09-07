# Security Policy

Clipboard data is sensitive by default (CLAUDE.md). We take reports seriously and will move quickly.

## Reporting a vulnerability

**Do not open a public issue for a vulnerability.**

Report privately via GitHub Security Advisories:
👉 https://github.com/hackathon-by-hgs/code-paste/security/advisories/new

If you cannot use advisories, contact a maintainer directly and request a private channel.

Please include:

- The domain(s) involved (backend, frontend, desktop, mobile, contracts).
- A minimal proof of concept using **synthetic** data only — never real clipboard contents, tokens,
  or personal information.
- Impact: what an attacker gains (e.g. receiving clipboard data without authorization, impersonating
  a device, replaying an event).
- Affected contract version (`CONTRACTS_VERSION`) and/or commit SHA.

### What to expect

| Stage | Target |
|---|---|
| Acknowledgement | within 3 business days |
| Initial assessment | within 7 business days |
| Fix or mitigation plan | communicated after assessment |

We will credit reporters who wish to be named, once a fix is available.

## Scope

The properties we most want to protect (see `docs/SECURITY.md` for the full threat model):

- **Authorization is not network membership.** Being on the same Wi-Fi/subnet must never grant
  clipboard access. Any bypass is a high-severity report.
- **Device identity cannot be spoofed.** An IP address is not an identity.
- **No unauthorized clipboard receipt.** Only explicit session/personal-sync members receive data.
- **No replay / no injection.** Malformed, oversized, replayed, or tampered events must be rejected
  (`contracts/vectors/invalid/`).
- **No secret or clipboard leakage** into logs, crash reports, or analytics.

## Out of scope

- Findings that require a device the attacker already fully controls and that is already authorized.
- Reports that depend on committing real secrets (do not do this — CI rejects it).

## Hardening we run

- Branch protection / rulesets with required status checks on all shared branches (`docs/CI_CD.md`).
- Contract conformance against the invalid-vector security surface in every domain's CI.
- Dependency updates via Dependabot; dependency audit in domain CI.
- Secret hygiene in CI; enable GitHub-native secret scanning + push protection in repo settings.
