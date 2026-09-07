import { z } from 'zod';
import { HUMAN_CODE_PATTERN } from '../common/crypto';
import { SESSION_STATUSES } from './share-session.entity';

export const createShareSessionSchema = z
  .object({
    // Bounds are enforced here AND clamped again in the service against
    // SHARE_SESSION_MAX_TTL_SECONDS: "temporary sharing is actually temporary" is a server
    // guarantee, not a client courtesy.
    expiresInSeconds: z.number().int().min(60).max(86400).optional(),
  })
  .strict();

export const joinShareSessionSchema = z
  .object({
    joinCode: z.string().regex(HUMAN_CODE_PATTERN, 'must be 8 characters from the code alphabet'),
  })
  .strict();

export const revokeMemberSchema = z
  .object({
    userId: z.string().regex(/^cp_usr_[0-9a-hjkmnp-tv-z]{26}$/, 'must be a user id'),
  })
  .strict();

export const listSessionsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().max(256).optional(),
    status: z.enum(SESSION_STATUSES).optional(),
  })
  .strict();

export type CreateShareSessionDto = z.infer<typeof createShareSessionSchema>;
export type JoinShareSessionDto = z.infer<typeof joinShareSessionSchema>;
export type RevokeMemberDto = z.infer<typeof revokeMemberSchema>;
export type ListSessionsQueryDto = z.infer<typeof listSessionsQuerySchema>;
