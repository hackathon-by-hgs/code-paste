import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../common/clock';
import { conflict, deviceRevoked, invalidCredentials, tokenReused, unauthenticated } from '../common/errors';
import { newUserId } from '../common/ids';
import { isRevoked } from '../devices/device.entity';
import { DatabaseService } from '../persistence/database.service';
import { DEVICE_REPOSITORY, type DeviceRepository } from '../persistence/repositories/device.repository';
import {
  REFRESH_TOKEN_REPOSITORY,
  type RefreshTokenRepository,
} from '../persistence/repositories/refresh-token.repository';
import { USER_REPOSITORY, type UserRepository } from '../persistence/repositories/user.repository';
import { LoggerService } from '../observability/logger.service';
import { normalizeEmail, type User } from '../users/user.entity';
import { classifyRefreshToken } from './refresh-token.entity';
import { PasswordService } from './password.service';
import type { Principal } from './principal';
import type { AccessTokenClaims } from './principal';
import { TokenService, type IssuedTokenPair } from './token.service';

export interface AuthResult extends IssuedTokenPair {
  user: User;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(DEVICE_REPOSITORY) private readonly devices: DeviceRepository,
    @Inject(REFRESH_TOKEN_REPOSITORY) private readonly refreshTokens: RefreshTokenRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly database: DatabaseService,
    private readonly logger: LoggerService,
  ) {}

  async signup(emailInput: string, password: string): Promise<AuthResult> {
    const email = normalizeEmail(emailInput);
    const existing = await this.users.findByEmail(email);
    // Signup is inherently an account-existence oracle: an attacker learns the same fact simply by
    // attempting to register. Hiding it here would cost usability and conceal nothing (ADR-004).
    if (existing) throw conflict('That email address is already registered.');

    const passwordHash = await this.passwords.hash(password);
    const now = this.clock.now();

    return this.database.runInTransaction(async (tx) => {
      const user = await this.users.create(
        { publicId: newUserId(now.getTime()), email, passwordHash, createdAt: now },
        tx,
      );
      const pair = await this.tokens.issuePair(
        {
          userId: user.id,
          userPublicId: user.publicId,
          sessionVersion: user.sessionVersion,
          kind: 'browser',
        },
        tx,
      );
      this.logger.info('account created', { userId: user.publicId });
      return { ...pair, user };
    });
  }

  async login(emailInput: string, password: string): Promise<AuthResult> {
    const email = normalizeEmail(emailInput);
    const user = await this.users.findByEmail(email);

    // Both branches perform an Argon2id verification, so response timing does not distinguish
    // "no such account" from "wrong password".
    if (!user) {
      await this.passwords.verifyAgainstDummy(password);
      this.logger.warn('login failed', { reason: 'unknown-account' });
      throw invalidCredentials();
    }

    const ok = await this.passwords.verify(user.passwordHash, password);
    if (!ok) {
      this.logger.warn('login failed', { reason: 'bad-password', userId: user.publicId });
      throw invalidCredentials();
    }
    // A disabled account is also `invalid_credentials`: distinguishing it would confirm the
    // address exists.
    if (user.disabledAt !== null) {
      this.logger.warn('login failed', { reason: 'account-disabled', userId: user.publicId });
      throw invalidCredentials();
    }

    const pair = await this.tokens.issuePair({
      userId: user.id,
      userPublicId: user.publicId,
      sessionVersion: user.sessionVersion,
      kind: 'browser',
    });
    this.logger.info('login succeeded', { userId: user.publicId });
    return { ...pair, user };
  }

  /**
   * Rotates a refresh token.
   *
   * Single-use with reuse detection: presenting an already-consumed token means two parties hold
   * it, so the entire family is revoked. The whole sequence runs in one transaction — a rotation
   * that issued a new token but failed to consume the old one would hand out a duplicate
   * credential.
   */
  async refresh(presentedToken: string): Promise<AuthResult> {
    const now = this.clock.now();
    const tokenHash = this.tokens.hashRefreshToken(presentedToken);

    /**
     * The transaction RETURNS an outcome; it never throws on a rejection path.
     *
     * This is not stylistic. Revoking a family and then throwing from inside the same transaction
     * rolls the revocation back, so a detected token theft would revoke nothing — the attacker's
     * freshly minted token would keep working. Rejections therefore carry the family id out, and
     * the revocation is committed separately below.
     */
    type Outcome =
      | { kind: 'ok'; pair: IssuedTokenPair; user: User }
      | { kind: 'invalid' }
      | { kind: 'reuse'; familyId: string; userId: string }
      | { kind: 'device-revoked'; familyId: string };

    const outcome = await this.database.runInTransaction<Outcome>(async (tx) => {
      const stored = await this.refreshTokens.findByHash(tokenHash, tx);
      if (!stored) return { kind: 'invalid' };

      /**
       * Device revocation is reported before generic token state.
       *
       * Revoking a device also revokes its token rows, so without this the caller would get a bare
       * `unauthenticated` and could not distinguish "session ended" from "this device was removed
       * from the account". Clients act differently on the two: `device_revoked` means wipe local
       * credentials and stop syncing (CLIENT_RESPONSES.md §4). Disclosing it leaks nothing — the
       * caller already holds that device's refresh token.
       */
      let devicePublicId: string | undefined;
      if (stored.deviceId) {
        const device = await this.devices.findById(stored.deviceId, tx);
        // A revoked device must not be able to refresh its way back to a live access token.
        if (!device || isRevoked(device)) return { kind: 'device-revoked', familyId: stored.familyId };
        devicePublicId = device.publicId;
      }

      const state = classifyRefreshToken(stored, now);
      if (state === 'reused') {
        return { kind: 'reuse', familyId: stored.familyId, userId: stored.userId };
      }
      if (state !== 'valid') return { kind: 'invalid' };

      // Conditional consume. If a concurrent request won the race, this returns false and the
      // loser is treated as a reuse rather than being issued a second valid pair.
      const consumed = await this.refreshTokens.markUsedIfUnused(stored.id, now, tx);
      if (!consumed) return { kind: 'reuse', familyId: stored.familyId, userId: stored.userId };

      const user = await this.users.findById(stored.userId, tx);
      if (!user || user.disabledAt !== null) return { kind: 'invalid' };

      const pair = await this.tokens.issuePair(
        {
          userId: user.id,
          userPublicId: user.publicId,
          sessionVersion: user.sessionVersion,
          kind: stored.deviceId ? 'device' : 'browser',
          devicePublicId,
          deviceId: stored.deviceId,
          familyId: stored.familyId, // same lineage, so reuse detection spans the whole chain
        },
        tx,
      );
      return { kind: 'ok', pair, user };
    });

    // Rejections are handled after the transaction has committed, so these revocations persist.
    switch (outcome.kind) {
      case 'ok':
        return { ...outcome.pair, user: outcome.user };
      case 'reuse':
        await this.refreshTokens.revokeFamily(outcome.familyId, now);
        this.logger.warn('refresh token reuse detected; family revoked', {
          userId: outcome.userId,
          reason: 'token-reuse',
        });
        throw tokenReused();
      case 'device-revoked':
        await this.refreshTokens.revokeFamily(outcome.familyId, now);
        throw deviceRevoked();
      case 'invalid':
        throw unauthenticated('Invalid refresh token.');
    }
  }

  /** Idempotent, and never reveals whether the token existed. */
  async logout(presentedToken: string): Promise<void> {
    const stored = await this.refreshTokens.findByHash(this.tokens.hashRefreshToken(presentedToken));
    if (!stored) return;
    await this.refreshTokens.revokeFamily(stored.familyId, this.clock.now());
    this.logger.info('logout', { userId: stored.userId });
  }

  /**
   * Turns verified claims into a Principal, re-checking anything a stateless token cannot express.
   *
   * The device lookup is the deliberate trade described in ADR-004: one indexed read per
   * device-authenticated request, in exchange for a revoked device losing access immediately
   * rather than when its access token happens to expire.
   */
  async resolvePrincipal(claims: AccessTokenClaims): Promise<Principal> {
    const user = await this.users.findByPublicId(claims.sub);
    if (!user || user.disabledAt !== null) throw unauthenticated('Invalid token.');
    // Bumped on password change, so every outstanding token dies at once.
    if (user.sessionVersion !== claims.sv) throw unauthenticated('Session is no longer valid.');

    if (claims.typ === 'browser') {
      return { kind: 'browser', user, tokenId: claims.jti };
    }

    const device = claims.did ? await this.devices.findByPublicId(claims.did) : null;
    if (!device) throw unauthenticated('Invalid token.');
    // Belt and braces: a token must never grant access to a device owned by someone else, even if
    // the claims were somehow inconsistent.
    if (device.userId !== user.id) throw unauthenticated('Invalid token.');
    if (isRevoked(device)) throw deviceRevoked();

    return { kind: 'device', user, device, tokenId: claims.jti };
  }
}
