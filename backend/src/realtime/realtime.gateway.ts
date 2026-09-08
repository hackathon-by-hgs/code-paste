import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { Inject, Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { WebSocketServer, type WebSocket } from 'ws';
import { AuthService } from '../auth/auth.service';
import { TokenService } from '../auth/token.service';
import { CLOCK, type Clock } from '../common/clock';
import { AppError } from '../common/errors';
import type { AuthorizationChangeReason, AuthorizationEventPublisher } from '../common/events';
import { newCorrelationId } from '../common/ids';
import { APP_CONFIG, type AppConfig } from '../config/configuration';
import { isRevoked } from '../devices/device.entity';
import { LoggerService } from '../observability/logger.service';
import { MetricsService } from '../observability/metrics.service';
import { ConnectionRegistry, type Connection } from './connection-registry';
import {
  clientEnvelopeSchema,
  ENVELOPE_VERSION,
  WS_CLOSE,
  type ServerEnvelope,
  type ServerMessageType,
} from './realtime.messages';

const REALTIME_PATH = '/v1/realtime';

/**
 * Authenticated bidirectional control channel (ADR-006).
 *
 * Carries authorization state changes **only**. It exists so a connected agent learns about a
 * revocation in milliseconds instead of waiting up to one roster TTL — the TTL remains the
 * correctness floor, and this is strictly an optimisation. A client that never connects is still
 * correct.
 *
 * Every decision here delegates to the same AuthService and AuthorizationService the HTTP layer
 * uses. There is no second implementation of any rule, and no path from this file to the database.
 */
@Injectable()
export class RealtimeGateway implements AuthorizationEventPublisher, OnApplicationBootstrap, OnModuleDestroy {
  private server?: WebSocketServer;
  private heartbeatTimer?: NodeJS.Timeout;
  private upgradeHandler?: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly adapterHost: HttpAdapterHost,
    private readonly tokens: TokenService,
    private readonly auth: AuthService,
    private readonly registry: ConnectionRegistry,
    private readonly logger: LoggerService,
    private readonly metrics: MetricsService,
  ) {}

  onApplicationBootstrap(): void {
    const httpServer = this.adapterHost.httpAdapter?.getHttpServer() as HttpServer | undefined;
    if (!httpServer) return;

    // `noServer` so we own the upgrade decision: an unauthenticated socket is destroyed during the
    // handshake and never allocates connection state.
    this.server = new WebSocketServer({ noServer: true, maxPayload: this.config.realtime.maxMessageBytes });

    this.upgradeHandler = (req, socket, head) => {
      void this.handleUpgrade(req, socket, head);
    };
    httpServer.on('upgrade', this.upgradeHandler);

    this.heartbeatTimer = setInterval(
      () => this.sweepHeartbeats(),
      this.config.realtime.heartbeatIntervalSeconds * 1000,
    );
    this.heartbeatTimer.unref?.();
  }

  private async handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    if (!this.server) return destroy(socket, 500);

    const url = req.url ?? '';
    if (!url.startsWith(REALTIME_PATH)) return destroy(socket, 404);

    /**
     * Origin check. The WebSocket handshake is an HTTP GET that browsers exempt from CORS
     * entirely, so `enableCors` does not protect this entry point at all.
     *
     * A native agent sends no `Origin`, so its absence is allowed. When one IS present the caller
     * is a browser and must be on the same allowlist as the REST API. Cross-site WebSocket
     * hijacking is not exploitable here anyway — the credential is a Bearer token an attacker's
     * page cannot read, not an ambient cookie — but a socket that any page may open is a
     * needlessly large surface.
     */
    const origin = req.headers.origin;
    if (typeof origin === 'string' && !this.config.cors.allowedOrigins.includes(origin)) {
      this.metrics.increment('realtime_handshake_rejections_total', { reason: 'origin-not-allowed' });
      return destroy(socket, 403);
    }

    const token = extractToken(req);
    if (!token) {
      this.metrics.increment('realtime_handshake_rejections_total', { reason: 'no-token' });
      return destroy(socket, 401);
    }

    try {
      // Exactly the HTTP authentication path: verify the JWT, then re-check the stateful facts a
      // token cannot express (user enabled, session version, device registered and not revoked).
      const claims = this.tokens.verifyAccessToken(token);
      const principal = await this.auth.resolvePrincipal(claims);

      // A browser is not a clipboard peer. Enforced here as well as on HTTP, because the socket is
      // an independent entry point and must not be the weaker one.
      if (principal.kind !== 'device' || !principal.device) {
        this.metrics.increment('realtime_handshake_rejections_total', { reason: 'not-a-device' });
        return destroy(socket, 403);
      }
      const device = principal.device;
      if (isRevoked(device)) {
        this.metrics.increment('realtime_handshake_rejections_total', { reason: 'device-revoked' });
        return destroy(socket, 403);
      }

      if (this.registry.countForDevice(device.publicId) >= this.config.realtime.maxConnectionsPerDevice) {
        this.metrics.increment('realtime_handshake_rejections_total', { reason: 'device-limit' });
        return destroy(socket, 429);
      }
      if (this.registry.countForUser(principal.user.publicId) >= this.config.realtime.maxConnectionsPerUser) {
        this.metrics.increment('realtime_handshake_rejections_total', { reason: 'user-limit' });
        return destroy(socket, 429);
      }

      this.server.handleUpgrade(req, socket, head, (ws) => {
        this.onConnection(ws, principal.user.publicId, device.publicId, device.rosterVersion);
      });
    } catch (error) {
      const status = error instanceof AppError ? error.status : 500;
      this.metrics.increment('realtime_handshake_rejections_total', { reason: 'auth-failed' });
      destroy(socket, status);
    }
  }

  private onConnection(
    socket: WebSocket,
    userPublicId: string,
    devicePublicId: string,
    rosterVersion: number,
  ): void {
    const now = this.clock.nowMs();
    const connection: Connection = {
      socket,
      userPublicId,
      devicePublicId,
      connectedAtMs: now,
      lastSeenMs: now,
      messageCount: 0,
      windowStartMs: now,
      malformedCount: 0,
      alive: true,
    };
    this.registry.add(connection);
    this.metrics.increment('realtime_connections_total');

    socket.on('message', (raw: Buffer) => this.onMessage(connection, raw));
    socket.on('pong', () => {
      connection.alive = true;
      connection.lastSeenMs = this.clock.nowMs();
    });
    socket.on('close', () => this.onClose(connection));
    socket.on('error', () => this.onClose(connection));

    this.send(connection, 'connection.ready', {
      deviceId: devicePublicId,
      userId: userPublicId,
      protocolVersion: 1,
      envelopeVersion: ENVELOPE_VERSION,
      heartbeatIntervalSeconds: this.config.realtime.heartbeatIntervalSeconds,
      // Lets a client immediately tell whether its cached roster is behind, without polling.
      rosterVersion,
    });

    this.logger.info('realtime connected', {
      userId: userPublicId,
      deviceId: devicePublicId,
      connectionCount: this.registry.size,
    });
  }

  private onMessage(connection: Connection, raw: Buffer): void {
    if (raw.length > this.config.realtime.maxMessageBytes) {
      return this.fail(connection, 'message_too_large', WS_CLOSE.tooLarge);
    }
    if (!this.withinRate(connection)) {
      return this.fail(connection, 'rate_limited', WS_CLOSE.policy);
    }

    let envelope;
    try {
      envelope = clientEnvelopeSchema.parse(JSON.parse(raw.toString('utf8')));
    } catch {
      // Malformed-message throttling (SECURITY.md, Abuse controls): a client that cannot speak the
      // protocol is disconnected rather than allowed to keep probing.
      connection.malformedCount += 1;
      this.metrics.increment('realtime_malformed_messages_total');
      this.send(connection, 'error', { code: 'invalid_message', message: 'Malformed message.' });
      if (connection.malformedCount >= this.config.realtime.maxMalformedMessages) {
        this.fail(connection, 'invalid_message', WS_CLOSE.policy);
      }
      return;
    }

    connection.lastSeenMs = this.clock.nowMs();
    this.metrics.increment('realtime_messages_total', { messageType: envelope.type });

    switch (envelope.type) {
      case 'ping':
        this.send(connection, 'pong', undefined, envelope.id);
        break;
      case 'device.heartbeat':
        // Liveness only. Coalesced server-side, and it carries no payload by contract.
        connection.alive = true;
        this.send(connection, 'pong', undefined, envelope.id);
        break;
      case 'roster.request':
        // The roster itself is fetched over HTTPS, where the response is signed and cacheable.
        // Duplicating roster delivery here would create a second issuing path to keep correct.
        this.send(connection, 'roster.invalidated', { reason: 'client-requested' }, envelope.id);
        break;
      case 'ack':
        break;
    }
  }

  private withinRate(connection: Connection): boolean {
    const now = this.clock.nowMs();
    if (now - connection.windowStartMs >= 60_000) {
      connection.windowStartMs = now;
      connection.messageCount = 0;
    }
    connection.messageCount += 1;
    return connection.messageCount <= this.config.realtime.messagesPerMinute;
  }

  private onClose(connection: Connection): void {
    if (!this.registry.forDevice(connection.devicePublicId).includes(connection)) return;
    this.registry.remove(connection);
    this.metrics.observeDuration(
      'realtime_connection_duration_ms',
      this.clock.nowMs() - connection.connectedAtMs,
    );
    this.logger.info('realtime disconnected', {
      userId: connection.userPublicId,
      deviceId: connection.devicePublicId,
      connectionDurationMs: this.clock.nowMs() - connection.connectedAtMs,
      connectionCount: this.registry.size,
    });
  }

  /** Ping every live connection; drop anything that missed the previous round. */
  private sweepHeartbeats(): void {
    for (const connection of this.registry.all()) {
      if (!connection.alive) {
        this.fail(connection, 'heartbeat_timeout', WS_CLOSE.policy);
        continue;
      }
      connection.alive = false;
      try {
        connection.socket.ping();
      } catch {
        this.onClose(connection);
      }
    }
  }

  // --- AuthorizationEventPublisher --------------------------------------------------------

  authorizationChanged(
    devicePublicIds: string[],
    reason: AuthorizationChangeReason,
    sessionPublicId?: string | null,
  ): void {
    const type: ServerMessageType = reason.startsWith('session')
      ? reason === 'session-expired'
        ? 'session.expired'
        : 'session.membership.changed'
      : 'authorization.changed';

    for (const connection of this.registry.forDevices(devicePublicIds)) {
      this.send(connection, type, { reason, sessionId: sessionPublicId ?? null });
    }
  }

  deviceRevoked(devicePublicId: string): void {
    for (const connection of this.registry.forDevice(devicePublicId)) {
      this.send(connection, 'device.revoked', { reason: 'device-revoked' });
      // Closed immediately. A revoked device is not a party whose cooperation is required.
      this.close(connection, WS_CLOSE.policy);
    }
  }

  deviceSyncToggled(devicePublicId: string, syncEnabled: boolean): void {
    for (const connection of this.registry.forDevice(devicePublicId)) {
      this.send(connection, 'device.sync-toggled', { reason: syncEnabled ? 'resumed' : 'paused' });
    }
  }

  // --- plumbing ---------------------------------------------------------------------------

  private send(
    connection: Connection,
    type: ServerMessageType,
    data?: Record<string, unknown>,
    correlationId?: string,
  ): void {
    const envelope: ServerEnvelope = {
      v: ENVELOPE_VERSION,
      type,
      ts: this.clock.now().toISOString(),
      ...(correlationId ? { id: correlationId } : { id: newCorrelationId(this.clock.nowMs()) }),
      ...(data ? { data } : {}),
    };
    try {
      connection.socket.send(JSON.stringify(envelope));
    } catch {
      this.onClose(connection);
    }
  }

  private fail(connection: Connection, code: string, closeCode: number): void {
    this.send(connection, 'error', { code });
    this.close(connection, closeCode);
  }

  private close(connection: Connection, code: number): void {
    try {
      connection.socket.close(code);
    } catch {
      /* already gone */
    }
    this.onClose(connection);
  }

  onModuleDestroy(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    const httpServer = this.adapterHost.httpAdapter?.getHttpServer() as HttpServer | undefined;
    if (httpServer && this.upgradeHandler) httpServer.off('upgrade', this.upgradeHandler);
    for (const connection of this.registry.all()) this.close(connection, WS_CLOSE.normal);
    this.registry.clear();
    this.server?.close();
  }
}

/**
 * Reads the access token from the Authorization header, falling back to the WebSocket subprotocol
 * for browsers, which cannot set headers on a WebSocket handshake.
 *
 * A `?access_token=` query parameter is deliberately NOT supported: URLs end up in access logs,
 * proxy logs and `Referer` headers, which is exactly where a credential should never be.
 */
function extractToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (typeof header === 'string') {
    const parts = header.split(' ');
    if (parts.length === 2 && parts[0].toLowerCase() === 'bearer' && parts[1].trim()) return parts[1].trim();
  }
  const protocols = req.headers['sec-websocket-protocol'];
  if (typeof protocols === 'string') {
    for (const entry of protocols.split(',')) {
      const value = entry.trim();
      if (value.startsWith('bearer.')) return value.slice('bearer.'.length);
    }
  }
  return null;
}

function destroy(socket: Duplex, status: number): void {
  const reason =
    status === 401
      ? 'Unauthorized'
      : status === 403
        ? 'Forbidden'
        : status === 429
          ? 'Too Many Requests'
          : 'Error';
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}
