import { z } from 'zod';

/**
 * The closed set of realtime message types (ADR-006).
 *
 * **Nothing here carries clipboard content, in either direction.** That is the boundary that keeps
 * this a control channel rather than a relay, and it is enforced by these enums plus a test that
 * asserts no type outside them exists. Adding one would require a contract change on `main`, a new
 * envelope version and an ADR superseding ADR-006.
 */
export const CLIENT_MESSAGE_TYPES = ['ping', 'device.heartbeat', 'roster.request', 'ack'] as const;

export const SERVER_MESSAGE_TYPES = [
  'connection.ready',
  'pong',
  'authorization.changed',
  'device.revoked',
  'device.sync-toggled',
  'session.membership.changed',
  'session.expired',
  'roster.invalidated',
  'protocol.unsupported',
  'error',
] as const;

export type ClientMessageType = (typeof CLIENT_MESSAGE_TYPES)[number];
export type ServerMessageType = (typeof SERVER_MESSAGE_TYPES)[number];

export const ENVELOPE_VERSION = 1;

/**
 * Inbound envelope schema. Strict, so an unknown field is a rejected message rather than one that
 * is silently ignored — the same rule as the HTTP boundary.
 */
export const clientEnvelopeSchema = z
  .object({
    v: z.literal(ENVELOPE_VERSION),
    type: z.enum(CLIENT_MESSAGE_TYPES),
    id: z
      .string()
      .regex(/^[0-9a-hjkmnp-tv-z]{26}$/)
      .optional(),
    ts: z.string().max(64).optional(),
    data: z.record(z.unknown()).optional(),
  })
  .strict();

export type ClientEnvelope = z.infer<typeof clientEnvelopeSchema>;

export interface ServerEnvelope {
  v: typeof ENVELOPE_VERSION;
  type: ServerMessageType;
  id?: string;
  ts: string;
  data?: Record<string, unknown>;
}

export const WS_CLOSE = {
  /** Normal shutdown. */
  normal: 1000,
  /** Policy violation: unauthenticated, revoked, over a limit. */
  policy: 1008,
  /** Message exceeded the size cap. */
  tooLarge: 1009,
  /** Server error. */
  internal: 1011,
} as const;
