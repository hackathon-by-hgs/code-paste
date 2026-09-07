import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { CLOCK, type Clock } from '../common/clock';
import { randomTokenBase64Url, sha256Hex } from '../common/crypto';
import { newCorrelationId } from '../common/ids';
import { tokenExpired, unauthenticated } from '../common/errors';
import { APP_CONFIG, type AppConfig } from '../config/configuration';
import type { Executor } from '../persistence/database.service';
import {
  REFRESH_TOKEN_REPOSITORY,
  type RefreshTokenRepository,
} from '../persistence/repositories/refresh-token.repository';
import type { AccessTokenClaims, PrincipalKind } from './principal';

export interface IssuedTokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface IssueOptions {
  userPublicId: string;
  userId: string;
  sessionVersion: number;
  kind: PrincipalKind;
  devicePublicId?: string;
  deviceId?: string | null;
  /** Continue an existing rotation lineage, or start a new one when omitted. */
  familyId?: string;
}

/**
 * Issues and verifies tokens (ADR-004).
 *
 * Access tokens are stateless JWTs with a 10-minute life. Refresh tokens are opaque CSPRNG bytes
 * stored only as a SHA-256 hash — never a JWT, because they must be revocable, and revocable
 * means server-side state, at which point a JWT buys nothing and risks being trusted offline.
 */
@Injectable()
export class TokenService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(REFRESH_TOKEN_REPOSITORY) private readonly refreshTokens: RefreshTokenRepository,
  ) {}

  /** SHA-256, not Argon2: the token is already 256 bits of CSPRNG entropy, so there is nothing to
   * brute-force and a slow KDF would only add latency to every refresh. */
  hashRefreshToken(token: string): string {
    return sha256Hex(token);
  }

  signAccessToken(options: IssueOptions): { token: string; expiresIn: number; jti: string } {
    const now = Math.floor(this.clock.nowMs() / 1000);
    const expiresIn = this.config.auth.accessTokenTtlSeconds;
    const jti = newCorrelationId(this.clock.nowMs());

    const claims: Omit<AccessTokenClaims, 'iss' | 'aud'> = {
      sub: options.userPublicId,
      typ: options.kind,
      sv: options.sessionVersion,
      jti,
      iat: now,
      exp: now + expiresIn,
      ...(options.kind === 'device' && options.devicePublicId ? { did: options.devicePublicId } : {}),
    };

    const token = jwt.sign(claims, this.config.auth.jwtSecret, {
      algorithm: 'HS256',
      issuer: this.config.auth.issuer,
      audience: this.config.auth.audience,
    });
    return { token, expiresIn, jti };
  }

  /**
   * Verifies an access token.
   *
   * `algorithms` is pinned to HS256. Without it, a token whose header claims `alg: none` would be
   * accepted by some verifiers — the classic JWT bypass. Issuer and audience are checked too, so a
   * token minted for another service cannot be replayed here.
   */
  verifyAccessToken(token: string): AccessTokenClaims {
    try {
      const payload = jwt.verify(token, this.config.auth.jwtSecret, {
        algorithms: ['HS256'],
        issuer: this.config.auth.issuer,
        audience: this.config.auth.audience,
        clockTolerance: this.config.auth.clockToleranceSeconds,
        clockTimestamp: Math.floor(this.clock.nowMs() / 1000),
      }) as JwtPayload;

      if (typeof payload.sub !== 'string' || (payload.typ !== 'browser' && payload.typ !== 'device')) {
        throw unauthenticated('Malformed token.');
      }
      if (payload.typ === 'device' && typeof payload.did !== 'string') {
        throw unauthenticated('Malformed token.');
      }
      return payload as unknown as AccessTokenClaims;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) throw tokenExpired();
      if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.NotBeforeError) {
        throw unauthenticated('Invalid token.');
      }
      throw error;
    }
  }

  /** Issues a pair and persists the refresh token's hash. Caller supplies the transaction. */
  async issuePair(options: IssueOptions, ex?: Executor): Promise<IssuedTokenPair> {
    const access = this.signAccessToken(options);
    const refreshToken = randomTokenBase64Url(32);
    const now = this.clock.now();

    await this.refreshTokens.create(
      {
        userId: options.userId,
        deviceId: options.deviceId ?? null,
        tokenHash: this.hashRefreshToken(refreshToken),
        familyId: options.familyId ?? randomUUID(),
        expiresAt: new Date(now.getTime() + this.config.auth.refreshTokenTtlSeconds * 1000),
        createdAt: now,
      },
      ex,
    );

    return { accessToken: access.token, refreshToken, expiresIn: access.expiresIn };
  }
}
