import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../common/clock';
import {
  conflict,
  deviceRevoked as deviceRevokedError,
  forbidden,
  invalidRequest,
  notFound,
  unauthenticated,
} from '../common/errors';
import {
  AUTHORIZATION_EVENT_PUBLISHER,
  type AuthorizationChangeReason,
  type AuthorizationEventPublisher,
} from '../common/events';
import { decodeEd25519PublicKey, generateHumanCode, keyFingerprint, sha256Hex } from '../common/crypto';
import { newDeviceId } from '../common/ids';
import { APP_CONFIG, type AppConfig } from '../config/configuration';
import { LoggerService } from '../observability/logger.service';
import { DatabaseService, type Executor } from '../persistence/database.service';
import {
  DEVICE_REPOSITORY,
  type DeviceRepository,
  type ListDevicesOptions,
  type Page,
} from '../persistence/repositories/device.repository';
import {
  PAIRING_CODE_REPOSITORY,
  type PairingCodeRepository,
} from '../persistence/repositories/pairing-code.repository';
import {
  REFRESH_TOKEN_REPOSITORY,
  type RefreshTokenRepository,
} from '../persistence/repositories/refresh-token.repository';
import {
  SHARE_SESSION_REPOSITORY,
  type ShareSessionRepository,
} from '../persistence/repositories/share-session.repository';
import { USER_REPOSITORY, type UserRepository } from '../persistence/repositories/user.repository';
import { ProtocolService } from '../protocol/protocol.service';
import { TokenService, type IssuedTokenPair } from '../auth/token.service';
import type { User } from '../users/user.entity';
import { isRevoked, type Device } from './device.entity';
import type { RegisterDeviceDto, UpdateDeviceDto } from './devices.dto';

export interface PairingCodeIssued {
  code: string;
  expiresAt: Date;
  expiresInSeconds: number;
}

export interface DeviceRegistration {
  device: Device;
  user: User;
  credentials: IssuedTokenPair;
}

@Injectable()
export class DevicesService {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DEVICE_REPOSITORY) private readonly devices: DeviceRepository,
    @Inject(PAIRING_CODE_REPOSITORY) private readonly pairingCodes: PairingCodeRepository,
    @Inject(REFRESH_TOKEN_REPOSITORY) private readonly refreshTokens: RefreshTokenRepository,
    @Inject(SHARE_SESSION_REPOSITORY) private readonly sessions: ShareSessionRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(AUTHORIZATION_EVENT_PUBLISHER) private readonly events: AuthorizationEventPublisher,
    private readonly protocol: ProtocolService,
    private readonly tokens: TokenService,
    private readonly database: DatabaseService,
    private readonly logger: LoggerService,
  ) {}

  // --- pairing (ADR-005) ------------------------------------------------------------------

  async issuePairingCode(user: User): Promise<PairingCodeIssued> {
    const now = this.clock.now();
    const code = generateHumanCode();
    const ttl = this.config.pairing.codeTtlSeconds;

    await this.pairingCodes.create({
      userId: user.id,
      // Hashed like a password: a database read yields no usable codes. SHA-256 is sufficient
      // because the code is CSPRNG-generated and short-lived, not a user-chosen secret.
      codeHash: sha256Hex(code),
      expiresAt: new Date(now.getTime() + ttl * 1000),
      createdAt: now,
    });

    this.logger.info('pairing code issued', { userId: user.publicId });
    // The plaintext is returned exactly once and never stored.
    return { code, expiresAt: new Date(now.getTime() + ttl * 1000), expiresInSeconds: ttl };
  }

  /**
   * Registers a device.
   *
   * Entirely transactional: consuming the code, creating the device, issuing credentials and
   * bumping roster versions succeed or fail together. A partial failure that burned the code
   * without registering anything would leave the user unable to retry with a code they can no
   * longer use.
   */
  async register(input: RegisterDeviceDto): Promise<DeviceRegistration> {
    // Rejected before touching the database, and before the code is consumed: an incompatible
    // client should not burn the user's pairing code.
    this.protocol.assertSupported(input.protocolVersion);

    const publicKeyRaw = decodeEd25519PublicKey(input.publicKey);
    if (!publicKeyRaw) {
      // Node's base64 decoding is lenient, so this is a real check rather than a formality: an
      // unusable key would mean a device whose identity can never be verified by a peer.
      throw invalidRequest('Request validation failed.', [
        { path: 'publicKey', message: 'must be a valid Ed25519 public key' },
      ]);
    }
    const fingerprint = keyFingerprint(publicKeyRaw);
    const now = this.clock.now();

    return this.database.runInTransaction(async (tx) => {
      const consumed = await this.pairingCodes.consume(sha256Hex(input.pairingCode), now, tx);
      // Wrong, expired and already-used are deliberately indistinguishable (ADR-005).
      if (!consumed) {
        this.logger.warn('device registration rejected', { reason: 'invalid-pairing-code' });
        throw unauthenticated('Invalid or expired pairing code.');
      }

      const user = await this.users.findById(consumed.userId, tx);
      if (!user || user.disabledAt !== null) throw unauthenticated('Invalid or expired pairing code.');

      const duplicate = await this.devices.findByUserAndFingerprint(user.id, fingerprint, tx);
      if (duplicate) {
        throw conflict('This device key is already registered to your account.');
      }

      const device = await this.devices.create(
        {
          publicId: newDeviceId(now.getTime()),
          userId: user.id,
          name: input.name,
          platform: input.platform,
          appVersion: input.appVersion,
          protocolVersion: input.protocolVersion,
          publicKey: input.publicKey,
          keyFingerprint: fingerprint,
          capabilities: input.capabilities,
          createdAt: now,
        },
        tx,
      );

      const credentials = await this.tokens.issuePair(
        {
          userId: user.id,
          userPublicId: user.publicId,
          sessionVersion: user.sessionVersion,
          kind: 'device',
          devicePublicId: device.publicId,
          deviceId: device.id,
        },
        tx,
      );

      // Existing peers must learn there is a new device to trust.
      const affected = await this.affectedDevices(user.id, device.id, tx);
      await this.devices.bumpRosterVersions(
        affected.map((d) => d.id),
        tx,
      );
      this.notify(affected, 'device-registered');

      this.logger.info('device registered', {
        userId: user.publicId,
        deviceId: device.publicId,
        platform: device.platform,
        protocolVersion: device.protocolVersion,
      });
      return { device, user, credentials };
    });
  }

  // --- lifecycle --------------------------------------------------------------------------

  list(user: User, options: ListDevicesOptions): Promise<Page<Device>> {
    return this.devices.listByUser(user.id, options);
  }

  /**
   * Loads a device the caller owns.
   *
   * Another user's device is `not_found`, never `forbidden`: a 403 would confirm the id exists and
   * turn this endpoint into an existence oracle for other people's devices.
   */
  async getOwned(user: User, publicId: string, ex?: Executor): Promise<Device> {
    const device = await this.devices.findByPublicId(publicId, ex);
    if (!device || device.userId !== user.id) throw notFound('Device not found.');
    return device;
  }

  async update(user: User, publicId: string, patch: UpdateDeviceDto): Promise<Device> {
    const existing = await this.getOwned(user, publicId);
    // Revoked devices are immutable: renaming or re-enabling sync on one would be a way to
    // partially undo a revocation.
    if (isRevoked(existing)) throw deviceRevokedError();

    const now = this.clock.now();
    return this.database.runInTransaction(async (tx) => {
      const updated = await this.devices.update(existing.id, patch, now, tx);

      // Pausing sync removes the device from every peer roster, so peers must be told.
      if (patch.syncEnabled !== undefined && patch.syncEnabled !== existing.syncEnabled) {
        const affected = await this.affectedDevices(user.id, null, tx);
        await this.devices.bumpRosterVersions(
          affected.map((d) => d.id),
          tx,
        );
        this.notify(affected, 'sync-toggled');
        this.events.deviceSyncToggled(updated.publicId, updated.syncEnabled);
        this.logger.info('device sync toggled', {
          userId: user.publicId,
          deviceId: updated.publicId,
          outcome: updated.syncEnabled ? 'enabled' : 'paused',
        });
      }
      return updated;
    });
  }

  /**
   * Revokes a device.
   *
   * One transaction, because the three effects are only meaningful together: a device marked
   * revoked whose refresh tokens survived can mint fresh access tokens, and one that stays in a
   * peer roster keeps receiving clipboard data. Idempotent.
   */
  async revoke(user: User, publicId: string): Promise<Device> {
    const existing = await this.getOwned(user, publicId);
    const now = this.clock.now();

    const revoked = await this.database.runInTransaction(async (tx) => {
      const device = await this.devices.revoke(existing.id, now, tx);
      await this.refreshTokens.revokeAllForDevice(existing.id, now, tx);

      const affected = await this.affectedDevices(user.id, device.id, tx);
      await this.devices.bumpRosterVersions(
        affected.map((d) => d.id),
        tx,
      );
      this.notify(affected, 'device-revoked');
      return device;
    });

    // Outside the transaction: the socket close is a side effect, and it must not be able to roll
    // the revocation back by throwing.
    this.events.deviceRevoked(revoked.publicId);
    this.logger.info('device revoked', { userId: user.publicId, deviceId: revoked.publicId });
    return revoked;
  }

  /** Revokes first, then deletes. Removal is never weaker than revocation. */
  async remove(user: User, publicId: string): Promise<void> {
    const existing = await this.getOwned(user, publicId);
    const now = this.clock.now();

    await this.database.runInTransaction(async (tx) => {
      await this.devices.revoke(existing.id, now, tx);
      await this.refreshTokens.revokeAllForDevice(existing.id, now, tx);

      const affected = await this.affectedDevices(user.id, existing.id, tx);
      await this.devices.bumpRosterVersions(
        affected.map((d) => d.id),
        tx,
      );
      this.notify(affected, 'device-removed');
      await this.devices.delete(existing.id, tx);
    });

    this.events.deviceRevoked(existing.publicId);
    this.logger.info('device removed', { userId: user.publicId, deviceId: existing.publicId });
  }

  /**
   * Records liveness for the calling device only.
   *
   * A device token may not heartbeat a different device — otherwise one compromised agent could
   * make a revoked or dormant device look alive.
   */
  async heartbeat(user: User, callerDevice: Device, publicId: string): Promise<void> {
    if (callerDevice.publicId !== publicId) throw forbidden('A device may only report its own liveness.');
    const device = await this.getOwned(user, publicId);
    if (isRevoked(device)) throw deviceRevokedError();
    await this.devices.touchLastSeen(
      device.id,
      this.clock.now(),
      this.config.devices.heartbeatCoalesceSeconds,
    );
  }

  // --- fan-out ----------------------------------------------------------------------------

  /**
   * Every device whose authorized peer set could have changed: the user's own devices, plus the
   * devices of anyone sharing an active session with them.
   *
   * Computed in one place so a new mutation cannot accidentally notify a narrower set than it
   * affects — a stale roster somewhere is a device that keeps trusting a peer it should not.
   */
  private async affectedDevices(
    userId: string,
    excludeDeviceId: string | null,
    ex?: Executor,
  ): Promise<Device[]> {
    const coMembers = await this.sessions.findCoMemberUserIds(userId, this.clock.now(), ex);
    const userIds = [...new Set([userId, ...coMembers.map((m) => m.userId)])];
    const devices = await this.devices.listAllByUserIds(userIds, ex);
    return devices.filter((d) => d.id !== excludeDeviceId && !isRevoked(d));
  }

  private notify(devices: Device[], reason: AuthorizationChangeReason): void {
    if (devices.length === 0) return;
    this.events.authorizationChanged(
      devices.map((d) => d.publicId),
      reason,
    );
  }
}
