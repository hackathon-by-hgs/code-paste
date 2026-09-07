import { z } from 'zod';

/**
 * Request schemas.
 *
 * All `.strict()`: an unknown property is a rejected request, not a silently ignored one. That is
 * what stops a client smuggling a field the handler was never meant to read.
 */

export const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .email('must be a valid email address')
  // A stricter shape than RFC 5322 allows, deliberately: an address that cannot be typed by a
  // human on a phone is not an address we need to support.
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'must be a valid email address');

export const signupSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(12, 'must be at least 12 characters').max(256, 'must be at most 256 characters'),
    // Length is the only rule. Composition requirements ("one symbol, one digit") reliably produce
    // weaker, more predictable passwords, and 256 is capped so a huge input cannot be used to
    // burn Argon2 memory as a denial-of-service.
  })
  .strict();

export const loginSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1).max(256),
  })
  .strict();

export const refreshSchema = z
  .object({
    refreshToken: z.string().min(20).max(512),
  })
  .strict();

export type SignupDto = z.infer<typeof signupSchema>;
export type LoginDto = z.infer<typeof loginSchema>;
export type RefreshDto = z.infer<typeof refreshSchema>;
