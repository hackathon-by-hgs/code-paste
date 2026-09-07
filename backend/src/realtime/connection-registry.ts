import { Injectable } from '@nestjs/common';
import type { WebSocket } from 'ws';

export interface Connection {
  socket: WebSocket;
  userPublicId: string;
  devicePublicId: string;
  connectedAtMs: number;
  lastSeenMs: number;
  /** Token bucket for per-connection message rate limiting. */
  messageCount: number;
  windowStartMs: number;
  malformedCount: number;
  alive: boolean;
}

/**
 * Tracks live connections and enforces the per-device and per-user caps.
 *
 * Entries are removed on every close, abnormal ones included — otherwise a reconnect storm leaks
 * slots until the caps reject legitimate clients, which turns a client bug into an outage.
 */
@Injectable()
export class ConnectionRegistry {
  private readonly byDevice = new Map<string, Set<Connection>>();
  private readonly byUser = new Map<string, Set<Connection>>();

  countForDevice(devicePublicId: string): number {
    return this.byDevice.get(devicePublicId)?.size ?? 0;
  }

  countForUser(userPublicId: string): number {
    return this.byUser.get(userPublicId)?.size ?? 0;
  }

  get size(): number {
    let total = 0;
    for (const set of this.byDevice.values()) total += set.size;
    return total;
  }

  add(connection: Connection): void {
    mapAdd(this.byDevice, connection.devicePublicId, connection);
    mapAdd(this.byUser, connection.userPublicId, connection);
  }

  remove(connection: Connection): void {
    mapRemove(this.byDevice, connection.devicePublicId, connection);
    mapRemove(this.byUser, connection.userPublicId, connection);
  }

  forDevice(devicePublicId: string): Connection[] {
    return [...(this.byDevice.get(devicePublicId) ?? [])];
  }

  forDevices(devicePublicIds: string[]): Connection[] {
    const out: Connection[] = [];
    for (const id of devicePublicIds) out.push(...this.forDevice(id));
    return out;
  }

  all(): Connection[] {
    const out: Connection[] = [];
    for (const set of this.byDevice.values()) out.push(...set);
    return out;
  }

  clear(): void {
    this.byDevice.clear();
    this.byUser.clear();
  }
}

function mapAdd(map: Map<string, Set<Connection>>, key: string, connection: Connection): void {
  const set = map.get(key) ?? new Set<Connection>();
  set.add(connection);
  map.set(key, set);
}

function mapRemove(map: Map<string, Set<Connection>>, key: string, connection: Connection): void {
  const set = map.get(key);
  if (!set) return;
  set.delete(connection);
  if (set.size === 0) map.delete(key);
}
