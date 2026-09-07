import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Control-plane state only.
 *
 * There is no table here for clipboard text, clipboard images or clipboard history, and there
 * never will be: clipboard payloads move device-to-device and never reach this process (ADR-001).
 *
 * Constraints are load-bearing. A unique index that stops one user registering two devices under
 * the same key, and a cascade that stops orphaned membership rows outliving a deleted user, are
 * security controls — stale membership is stale authorization. `SPEC_CONTRACT.md` §16 requires
 * these to be enforced by the database rather than by hopeful application code.
 */

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    publicId: text('public_id').notNull(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    /**
     * Bumped on password change. Access tokens carry it as `sv`, so a mismatch invalidates every
     * outstanding token for the user without a per-request database read.
     */
    sessionVersion: integer('session_version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    disabledAt: timestamp('disabled_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    uniqueIndex('users_public_id_key').on(t.publicId),
    // Case-insensitive uniqueness without the citext extension, which PGlite does not ship.
    uniqueIndex('users_email_lower_key').on(sql`lower(${t.email})`),
  ],
);

export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    publicId: text('public_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    platform: text('platform').notNull(),
    appVersion: text('app_version').notNull(),
    protocolVersion: integer('protocol_version').notNull(),
    /** Ed25519 public key, 32 raw bytes, base64. The private half never leaves the device. */
    publicKey: text('public_key').notNull(),
    keyFingerprint: text('key_fingerprint').notNull(),
    capabilities: jsonb('capabilities').notNull(),
    /** The instant pause switch. A paused device is excluded from every peer roster. */
    syncEnabled: boolean('sync_enabled').notNull().default(true),
    /** Monotonic. Incremented whenever this device's authorized peer set could have changed. */
    rosterVersion: integer('roster_version').notNull().default(0),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    uniqueIndex('devices_public_id_key').on(t.publicId),
    /**
     * One key fingerprint per account, revoked rows included. Two devices sharing an identity
     * would make peer verification meaningless, and keeping revoked rows under the constraint
     * stops a revoked key being re-registered to walk back its own revocation.
     */
    uniqueIndex('devices_user_fingerprint_key').on(t.userId, t.keyFingerprint),
    index('devices_user_id_idx').on(t.userId),
  ],
);

export const shareSessions = pgTable(
  'share_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    publicId: text('public_id').notNull(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Only ever a hash. The plaintext join code is returned once at creation and never stored. */
    joinCodeHash: text('join_code_hash').notNull(),
    status: text('status').notNull().default('active'),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('share_sessions_public_id_key').on(t.publicId),
    index('share_sessions_owner_idx').on(t.ownerUserId),
    index('share_sessions_expires_idx').on(t.expiresAt),
  ],
);

export const shareMembers = pgTable(
  'share_members',
  {
    sessionId: uuid('session_id')
      .notNull()
      .references(() => shareSessions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    joinedAt: timestamp('joined_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  },
  // Composite primary key: a user cannot hold two memberships in one session, so "join twice"
  // cannot silently create a second row that a revocation would then miss.
  (t) => [primaryKey({ columns: [t.sessionId, t.userId] }), index('share_members_user_idx').on(t.userId)],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Null for browser sessions. Set for device-bound tokens so device revocation can find them. */
    deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'cascade' }),
    /** SHA-256 of the token. The token itself is never stored (ADR-004). */
    tokenHash: text('token_hash').notNull(),
    /** Rotation lineage. Reuse of any member revokes the whole family. */
    familyId: uuid('family_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    usedAt: timestamp('used_at', { withTimezone: true, mode: 'date' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    uniqueIndex('refresh_tokens_hash_key').on(t.tokenHash),
    index('refresh_tokens_family_idx').on(t.familyId),
    index('refresh_tokens_device_idx').on(t.deviceId),
    index('refresh_tokens_user_idx').on(t.userId),
  ],
);

export const pairingCodes = pgTable(
  'pairing_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Hashed like a password. A database read yields no usable codes. */
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    /** Set by a conditional UPDATE, which is what makes consumption single-use under a race. */
    consumedAt: timestamp('consumed_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [uniqueIndex('pairing_codes_hash_key').on(t.codeHash), index('pairing_codes_user_idx').on(t.userId)],
);

export const schema = { users, devices, shareSessions, shareMembers, refreshTokens, pairingCodes };

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type DeviceRow = typeof devices.$inferSelect;
export type NewDeviceRow = typeof devices.$inferInsert;
export type ShareSessionRow = typeof shareSessions.$inferSelect;
export type ShareMemberRow = typeof shareMembers.$inferSelect;
export type RefreshTokenRow = typeof refreshTokens.$inferSelect;
export type PairingCodeRow = typeof pairingCodes.$inferSelect;
