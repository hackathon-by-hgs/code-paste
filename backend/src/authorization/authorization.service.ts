import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../common/clock';
import { deviceRevoked } from '../common/errors';
import { APP_CONFIG, type AppConfig } from '../config/configuration';
import { isRevoked, isSyncEligible, type ContentType, type Device } from '../devices/device.entity';
import { LoggerService } from '../observability/logger.service';
import { MetricsService } from '../observability/metrics.service';
import { DEVICE_REPOSITORY, type DeviceRepository } from '../persistence/repositories/device.repository';
import {
  SHARE_SESSION_REPOSITORY,
  type ShareSessionRepository,
} from '../persistence/repositories/share-session.repository';
import { USER_REPOSITORY, type UserRepository } from '../persistence/repositories/user.repository';
import { ProtocolService, SUPPORTED_PROTOCOL_VERSIONS } from '../protocol/protocol.service';
import type { User } from '../users/user.entity';
import { RosterSigningService, type RosterSignature } from './roster-signing.service';

export interface RosterPeer {
  deviceId: string;
  userId: string;
  publicKey: string;
  keyFingerprint: string;
  platform: string;
  protocolVersion: number;
  capabilities: { contentTypes: ContentType[]; maxPayloadBytes?: number };
  scope: 'personal' | 'session';
  sessionId: string | null;
}

export interface PeerRoster {
  protocolVersion: number;
  rosterVersion: number;
  issuedAt: string;
  expiresAt: string;
  self: { deviceId: string; userId: string; keyFingerprint: string };
  peers: RosterPeer[];
  limits: Record<ContentType, number>;
}

export interface SignedPeerRoster {
  payload: string;
  signature: RosterSignature;
}

/**
 * The single authorization authority.
 *
 * `SPEC_CONTRACT.md` §7 states one predicate, and it is implemented **here and nowhere else**:
 *
 *     authenticated AND deviceRegistered AND deviceNotRevoked
 *       AND deviceAuthorizedForSession AND peerIdentityCryptographicallyVerified
 *
 * The first three are established by AuthGuard before this runs. The fourth is decided here. The
 * fifth is necessarily decided by the agents themselves during their LAN handshake — the control
 * plane cannot verify a key it never sees used — which is exactly why the roster ships each peer's
 * public key rather than merely its id.
 *
 * Controllers and the WebSocket gateway both call this. Neither re-derives any part of it: two
 * copies of an authorization rule is one copy that eventually forgets a check.
 */
@Injectable()
export class AuthorizationService {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DEVICE_REPOSITORY) private readonly devices: DeviceRepository,
    @Inject(SHARE_SESSION_REPOSITORY) private readonly sessions: ShareSessionRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    private readonly protocol: ProtocolService,
    private readonly signing: RosterSigningService,
    private readonly logger: LoggerService,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Builds the roster for one device.
   *
   * Everything excluded is excluded for a reason: the device itself (it is not its own peer),
   * revoked devices, sync-paused devices, protocol-incompatible devices, and members of sessions
   * that are expired or revoked. Most of that filtering happens in SQL so a disqualified device is
   * never loaded as a candidate in the first place.
   */
  async buildRoster(user: User, device: Device): Promise<PeerRoster> {
    // Re-checked even though AuthGuard already did: this method is also reachable from the
    // realtime gateway, and an authorization decision should not depend on who called it.
    if (isRevoked(device)) throw deviceRevoked();
    if (!isSyncEligible(device)) {
      // A paused device gets an empty roster rather than an error: pausing is a user preference,
      // not a failure, and the client should simply have no one to talk to.
      return this.emptyRoster(user, device);
    }

    const now = this.clock.now();
    const versions = [...SUPPORTED_PROTOCOL_VERSIONS];

    // Personal scope: the user's own other devices.
    const ownDevices = await this.devices.listSyncEligibleByUserIds([user.id], versions);
    const personal = ownDevices
      .filter((d) => d.id !== device.id)
      .map((d) => this.toPeer(d, user.publicId, 'personal', null));

    // Session scope: devices of users sharing an ACTIVE session. Both the status and the expiry
    // are enforced in SQL, so an unswept expired session cannot leak a peer.
    const coMembers = await this.sessions.findCoMemberUserIds(user.id, now);
    const sessionByUserId = new Map(coMembers.map((m) => [m.userId, m.sessionPublicId]));
    const coMemberUserIds = [...sessionByUserId.keys()];

    let session: RosterPeer[] = [];
    if (coMemberUserIds.length > 0) {
      const peerDevices = await this.devices.listSyncEligibleByUserIds(coMemberUserIds, versions);
      const ownerPublicIds = await this.resolveUserPublicIds(peerDevices);
      session = peerDevices.map((d) =>
        this.toPeer(d, ownerPublicIds.get(d.userId) ?? '', 'session', sessionByUserId.get(d.userId) ?? null),
      );
    }

    const ttl = this.config.roster.ttlSeconds;
    const roster: PeerRoster = {
      protocolVersion: this.protocol.getPolicy().currentProtocolVersion,
      rosterVersion: device.rosterVersion,
      issuedAt: now.toISOString(),
      // Short-lived on purpose: this is how revocation propagates without push infrastructure.
      // Authorization decays by default rather than requiring a delivered message (ADR-003).
      expiresAt: new Date(now.getTime() + ttl * 1000).toISOString(),
      self: { deviceId: device.publicId, userId: user.publicId, keyFingerprint: device.keyFingerprint },
      peers: [...personal, ...session],
      limits: this.protocol.getLimits(),
    };

    this.metrics.increment('roster_issued_total');
    this.metrics.observeDuration('roster_peer_count', roster.peers.length);
    this.logger.info('roster issued', {
      userId: user.publicId,
      deviceId: device.publicId,
      peerCount: roster.peers.length,
      rosterVersion: roster.rosterVersion,
    });
    return roster;
  }

  /**
   * Serialises and signs.
   *
   * The bytes are produced once and both signed and transmitted, so what the verifier checks is
   * byte-identical to what it parses.
   */
  async buildSignedRoster(user: User, device: Device): Promise<SignedPeerRoster> {
    const roster = await this.buildRoster(user, device);
    const bytes = Buffer.from(JSON.stringify(roster), 'utf8');
    return { payload: bytes.toString('base64'), signature: this.signing.sign(bytes) };
  }

  getSigningKeys() {
    return this.signing.getPublicKeys();
  }

  private emptyRoster(user: User, device: Device): PeerRoster {
    const now = this.clock.now();
    return {
      protocolVersion: this.protocol.getPolicy().currentProtocolVersion,
      rosterVersion: device.rosterVersion,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.config.roster.ttlSeconds * 1000).toISOString(),
      self: { deviceId: device.publicId, userId: user.publicId, keyFingerprint: device.keyFingerprint },
      peers: [],
      limits: this.protocol.getLimits(),
    };
  }

  private toPeer(
    device: Device,
    ownerPublicId: string,
    scope: 'personal' | 'session',
    sessionId: string | null,
  ): RosterPeer {
    return {
      deviceId: device.publicId,
      userId: ownerPublicId,
      publicKey: device.publicKey,
      keyFingerprint: device.keyFingerprint,
      platform: device.platform,
      protocolVersion: device.protocolVersion,
      capabilities: device.capabilities,
      scope,
      // The contract requires sessionId to be null for personal scope and set for session scope.
      sessionId: scope === 'session' ? sessionId : null,
    };
  }

  /**
   * Maps internal user ids to public ids in one query.
   *
   * A roster must never carry an internal database identifier, and resolving them here — rather
   * than trusting a join somewhere upstream — keeps that guarantee local to the code that builds
   * the roster.
   */
  private resolveUserPublicIds(devices: Device[]): Promise<Map<string, string>> {
    return this.users.findPublicIdsByIds(devices.map((d) => d.userId));
  }
}
