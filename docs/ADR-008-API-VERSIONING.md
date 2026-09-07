# ADR-008: API and Protocol Versioning

## Status

Accepted. Closes `SPEC_CONTRACT.md` gap #8.

Affects: all domains.

## Context

`API_CONTRACTS.md` lists unversioned paths (`POST /devices`). With five client domains shipping on
independent release cadences — and desktop and mobile clients that a user may never update — an
unversioned API has no migration path. `DEV_GUIDE.md` §5 already requires that breaking changes get
a new protocol version rather than a silent redefinition; the API needs the same rule.

## Decision

**Three independent version axes.** Conflating them is the usual mistake: a clipboard envelope
change should not force a new REST version, and a new endpoint should not invalidate cached
rosters.

### 1. API version — URL path

```
/v1/auth/login        /v1/devices        /v1/authz/peer-set
```

- **Additive changes ship inside `/v1`**: new endpoints, new optional request fields, new response
  fields. Clients MUST tolerate unknown response fields.
- **Breaking changes get `/v2`**: removing or renaming a field, narrowing a type, changing a status
  code or error code, making an optional field required, changing default behaviour.
- Both versions run side by side during migration.

### 2. Clipboard protocol version — in the payload

`protocolVersion: 1`, owned by `contracts/schema/clipboard-event.schema.json` and negotiated at
device registration. Independent of the API version: `/v2` could still speak protocol v1, and a
protocol v2 could ship on `/v1`.

`GET /v1/protocol` publishes `supportedProtocolVersions`, `currentProtocolVersion` and the
authoritative `limits`, so a client can check compatibility **before** registering rather than
discovering it through a failure.

### 3. Contract version — the pinned tag

`CONTRACTS_VERSION` (`protocol-v1.0.0`) pins schemas, OpenAPI and vectors. CI fetches that tag and
runs conformance against it. The running server reports its own pin at `GET /v1/protocol` as
`contractsVersion`, so a deployed instance can be checked against the contract it claims — contract
drift becomes observable rather than theoretical.

### Deprecation

1. Announce: `Deprecation: <date>` and `Sunset: <date>` response headers on the old version, plus a
   `docs/HANDOFFS/` note listing affected domains.
2. Minimum **90 days** between announcement and sunset.
3. Withdraw only after telemetry shows no traffic on the old version.

A contract is never silently redefined. If a change cannot be made additively, it gets a version.

### Unsupported versions fail loudly

An unknown API version is `404`. An unsupported protocol version at registration is
`422 unsupported_protocol_version`, and the response says what *is* supported. Never a silent
downgrade or a best-effort reinterpretation — a client that thinks it is speaking v2 while the
server treats it as v1 is the worst outcome available.

## Consequences

### Positive

- Old desktop and mobile builds keep working through a breaking API change.
- The three axes move independently, so a protocol change does not churn the REST surface.
- Contract drift between a deployed server and its pinned tag is detectable at runtime.

### Negative

- Two API versions must be maintained during a migration window. This is the cost of not breaking
  installed clients, and it is the point.
- URL versioning is less elegant than content negotiation. It is chosen for being trivially
  visible in logs, caches, proxies and bug reports.

## Rejected alternatives

**Header/media-type negotiation** (`Accept: application/vnd.code-paste.v2+json`). Purer REST,
invisible in a URL, easy to get wrong in a proxy or a curl reproduction.

**No versioning; only additive changes forever.** Works until the first genuine mistake, then
leaves no way out.

**One version number for everything.** Couples the clipboard protocol to the REST surface, forcing
every client to move whenever either changes.
