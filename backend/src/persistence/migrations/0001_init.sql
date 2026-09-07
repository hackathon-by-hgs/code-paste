-- 0001_init: control-plane schema.
--
-- Nothing here stores clipboard content. Constraints are security controls, not tidiness:
-- see src/persistence/schema.ts for the reasoning behind each one.

CREATE TABLE IF NOT EXISTS users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id        text        NOT NULL,
  email            text        NOT NULL,
  password_hash    text        NOT NULL,
  session_version  integer     NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  disabled_at      timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS users_public_id_key   ON users (public_id);
-- Case-insensitive uniqueness without citext, which PGlite does not ship.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key ON users (lower(email));

CREATE TABLE IF NOT EXISTS devices (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id         text        NOT NULL,
  user_id           uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name              text        NOT NULL,
  platform          text        NOT NULL,
  app_version       text        NOT NULL,
  protocol_version  integer     NOT NULL,
  public_key        text        NOT NULL,
  key_fingerprint   text        NOT NULL,
  capabilities      jsonb       NOT NULL,
  sync_enabled      boolean     NOT NULL DEFAULT true,
  roster_version    integer     NOT NULL DEFAULT 0,
  last_seen_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  revoked_at        timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS devices_public_id_key       ON devices (public_id);
-- Revoked rows stay under this constraint on purpose: a revoked key must not be re-registered
-- to walk back its own revocation.
CREATE UNIQUE INDEX IF NOT EXISTS devices_user_fingerprint_key ON devices (user_id, key_fingerprint);
CREATE INDEX        IF NOT EXISTS devices_user_id_idx          ON devices (user_id);

CREATE TABLE IF NOT EXISTS share_sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id      text        NOT NULL,
  owner_user_id  uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  join_code_hash text        NOT NULL,
  status         text        NOT NULL DEFAULT 'active',
  expires_at     timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT share_sessions_status_check CHECK (status IN ('active', 'expired', 'revoked'))
);
CREATE UNIQUE INDEX IF NOT EXISTS share_sessions_public_id_key ON share_sessions (public_id);
CREATE INDEX        IF NOT EXISTS share_sessions_owner_idx     ON share_sessions (owner_user_id);
CREATE INDEX        IF NOT EXISTS share_sessions_expires_idx   ON share_sessions (expires_at);

CREATE TABLE IF NOT EXISTS share_members (
  session_id uuid        NOT NULL REFERENCES share_sessions (id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role       text        NOT NULL DEFAULT 'member',
  joined_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (session_id, user_id),
  CONSTRAINT share_members_role_check CHECK (role IN ('owner', 'member'))
);
CREATE INDEX IF NOT EXISTS share_members_user_idx ON share_members (user_id);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  device_id  uuid        REFERENCES devices (id) ON DELETE CASCADE,
  token_hash text        NOT NULL,
  family_id  uuid        NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at    timestamptz,
  revoked_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS refresh_tokens_hash_key   ON refresh_tokens (token_hash);
CREATE INDEX        IF NOT EXISTS refresh_tokens_family_idx ON refresh_tokens (family_id);
CREATE INDEX        IF NOT EXISTS refresh_tokens_device_idx ON refresh_tokens (device_id);
CREATE INDEX        IF NOT EXISTS refresh_tokens_user_idx   ON refresh_tokens (user_id);

CREATE TABLE IF NOT EXISTS pairing_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_hash   text        NOT NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS pairing_codes_hash_key ON pairing_codes (code_hash);
CREATE INDEX        IF NOT EXISTS pairing_codes_user_idx ON pairing_codes (user_id);
