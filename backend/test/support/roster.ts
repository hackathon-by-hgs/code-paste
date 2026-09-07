/**
 * The decoded roster shape, as a client sees it.
 *
 * Declared independently of `src/` on purpose: a test that imported the server's own type would
 * assert the implementation against itself. This mirrors `peer-roster.schema.json`, which is the
 * contract a real agent codes against, and the conformance suite validates the live response
 * against that schema separately.
 */
export interface RosterPeer {
  deviceId: string;
  userId: string;
  publicKey: string;
  keyFingerprint: string;
  platform: string;
  protocolVersion: number;
  capabilities: { contentTypes: string[]; maxPayloadBytes?: number };
  scope: 'personal' | 'session';
  sessionId: string | null;
}

export interface RosterPayload {
  protocolVersion: number;
  rosterVersion: number;
  issuedAt: string;
  expiresAt: string;
  self: { deviceId: string; userId: string; keyFingerprint: string };
  peers: RosterPeer[];
  limits: Record<string, number>;
}
