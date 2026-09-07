import { z } from 'zod';
import { CONTENT_TYPES, PLATFORMS } from './device.entity';
import { HUMAN_CODE_PATTERN } from '../common/crypto';

const humanCode = z.string().regex(HUMAN_CODE_PATTERN, 'must be 8 characters from the code alphabet');

export const registerDeviceSchema = z
  .object({
    pairingCode: humanCode,
    name: z.string().trim().min(1).max(64),
    platform: z.enum(PLATFORMS),
    appVersion: z
      .string()
      .min(1)
      .max(32)
      // Constrained so a version string cannot smuggle control characters into a log line.
      .regex(/^[0-9A-Za-z.+-]+$/, 'must contain only alphanumerics, dot, plus or hyphen'),
    protocolVersion: z.number().int().min(1).max(1000),
    publicKey: z
      .string()
      .regex(/^[A-Za-z0-9+/]{43}=$/, 'must be a base64-encoded 32-byte Ed25519 public key'),
    capabilities: z
      .object({
        contentTypes: z.array(z.enum(CONTENT_TYPES)).min(1).max(16),
        maxPayloadBytes: z
          .number()
          .int()
          .min(0)
          .max(10 * 1024 * 1024)
          .optional(),
      })
      .strict(),
  })
  .strict();

export const updateDeviceSchema = z
  .object({
    name: z.string().trim().min(1).max(64).optional(),
    syncEnabled: z.boolean().optional(),
  })
  .strict()
  // An empty PATCH is a client bug; accepting it would silently do nothing and look like success.
  .refine((v) => v.name !== undefined || v.syncEnabled !== undefined, {
    message: 'at least one of name or syncEnabled is required',
  });

export const listDevicesQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().max(256).optional(),
    includeRevoked: z
      .union([z.boolean(), z.enum(['true', 'false'])])
      .transform((v) => v === true || v === 'true')
      .default(false),
  })
  .strict();

export type RegisterDeviceDto = z.infer<typeof registerDeviceSchema>;
export type UpdateDeviceDto = z.infer<typeof updateDeviceSchema>;
export type ListDevicesQueryDto = z.infer<typeof listDevicesQuerySchema>;
