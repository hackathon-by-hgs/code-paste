import { z } from 'zod';

/**
 * Configuration is validated once, at boot. An invalid or missing secret must stop the process,
 * not surface as a confusing 500 during the first login — or, worse, as a service that silently
 * starts with a development default in production.
 */

const seconds = (def: number) => z.coerce.number().int().positive().default(def);
const bytes = (def: number) => z.coerce.number().int().positive().default(def);

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),

    DATABASE_URL: z.string().url().optional(),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

    AUTH_JWT_SECRET: z.string().min(32, 'AUTH_JWT_SECRET must be at least 32 characters.'),
    AUTH_JWT_ISSUER: z.string().min(1).default('code-paste-control-plane'),
    AUTH_JWT_AUDIENCE: z.string().min(1).default('code-paste-clients'),
    AUTH_ACCESS_TOKEN_TTL_SECONDS: seconds(600),
    AUTH_REFRESH_TOKEN_TTL_SECONDS: seconds(2592000),
    AUTH_CLOCK_TOLERANCE_SECONDS: z.coerce.number().int().min(0).max(300).default(30),

    ROSTER_SIGNING_SECRET_KEY: z.string().optional(),
    ROSTER_TTL_SECONDS: seconds(300),

    PAIRING_CODE_TTL_SECONDS: seconds(300),
    DEVICE_HEARTBEAT_COALESCE_SECONDS: seconds(300),

    SHARE_SESSION_DEFAULT_TTL_SECONDS: seconds(3600),
    SHARE_SESSION_MAX_TTL_SECONDS: seconds(86400),

    REALTIME_HEARTBEAT_INTERVAL_SECONDS: z.coerce.number().int().min(5).max(300).default(30),
    REALTIME_MAX_CONNECTIONS_PER_DEVICE: z.coerce.number().int().positive().default(2),
    REALTIME_MAX_CONNECTIONS_PER_USER: z.coerce.number().int().positive().default(20),
    REALTIME_MAX_MESSAGE_BYTES: bytes(8192),
    REALTIME_MESSAGES_PER_MINUTE: z.coerce.number().int().positive().default(60),
    REALTIME_MAX_MALFORMED_MESSAGES: z.coerce.number().int().positive().default(5),

    HTTP_MAX_BODY_BYTES: bytes(65536),
    RATE_LIMIT_LOGIN_PER_MINUTE: z.coerce.number().int().positive().default(5),
    RATE_LIMIT_SIGNUP_PER_HOUR: z.coerce.number().int().positive().default(10),
    RATE_LIMIT_REFRESH_PER_MINUTE: z.coerce.number().int().positive().default(30),
    RATE_LIMIT_PAIRING_PER_HOUR: z.coerce.number().int().positive().default(20),
    RATE_LIMIT_REGISTER_DEVICE_PER_HOUR: z.coerce.number().int().positive().default(20),
    RATE_LIMIT_SESSION_JOIN_PER_MINUTE: z.coerce.number().int().positive().default(10),
    RATE_LIMIT_DEFAULT_PER_MINUTE: z.coerce.number().int().positive().default(120),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.NODE_ENV !== 'production') return;

    // Production refuses to improvise. A generated roster key would invalidate every cached
    // roster on restart; a development JWT secret in production is a total auth bypass.
    if (!cfg.ROSTER_SIGNING_SECRET_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ROSTER_SIGNING_SECRET_KEY'],
        message: 'ROSTER_SIGNING_SECRET_KEY is required in production; it must not be generated at boot.',
      });
    }
    if (!cfg.DATABASE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL is required in production. PGlite is a development and test driver.',
      });
    }
    if (/dev-only|change-me|insecure/i.test(cfg.AUTH_JWT_SECRET)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AUTH_JWT_SECRET'],
        message: 'AUTH_JWT_SECRET still contains a development placeholder.',
      });
    }
  });

export type RawConfig = z.infer<typeof schema>;

export interface AppConfig {
  env: RawConfig['NODE_ENV'];
  port: number;
  logLevel: RawConfig['LOG_LEVEL'];
  isProduction: boolean;
  database: { url?: string; poolMax: number };
  auth: {
    jwtSecret: string;
    issuer: string;
    audience: string;
    accessTokenTtlSeconds: number;
    refreshTokenTtlSeconds: number;
    clockToleranceSeconds: number;
  };
  roster: { signingSecretKey?: string; ttlSeconds: number };
  pairing: { codeTtlSeconds: number };
  devices: { heartbeatCoalesceSeconds: number };
  shareSessions: { defaultTtlSeconds: number; maxTtlSeconds: number };
  realtime: {
    heartbeatIntervalSeconds: number;
    maxConnectionsPerDevice: number;
    maxConnectionsPerUser: number;
    maxMessageBytes: number;
    messagesPerMinute: number;
    maxMalformedMessages: number;
  };
  http: { maxBodyBytes: number };
  rateLimits: {
    loginPerMinute: number;
    signupPerHour: number;
    refreshPerMinute: number;
    pairingPerHour: number;
    registerDevicePerHour: number;
    sessionJoinPerMinute: number;
    defaultPerMinute: number;
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    // Deliberately reports names only. Printing the offending values would put secrets in logs.
    throw new Error('Invalid configuration:\n' + problems);
  }
  const c = parsed.data;

  if (c.SHARE_SESSION_DEFAULT_TTL_SECONDS > c.SHARE_SESSION_MAX_TTL_SECONDS) {
    throw new Error('Invalid configuration:\n  SHARE_SESSION_DEFAULT_TTL_SECONDS exceeds the maximum.');
  }

  return {
    env: c.NODE_ENV,
    port: c.PORT,
    logLevel: c.LOG_LEVEL,
    isProduction: c.NODE_ENV === 'production',
    database: { url: c.DATABASE_URL, poolMax: c.DATABASE_POOL_MAX },
    auth: {
      jwtSecret: c.AUTH_JWT_SECRET,
      issuer: c.AUTH_JWT_ISSUER,
      audience: c.AUTH_JWT_AUDIENCE,
      accessTokenTtlSeconds: c.AUTH_ACCESS_TOKEN_TTL_SECONDS,
      refreshTokenTtlSeconds: c.AUTH_REFRESH_TOKEN_TTL_SECONDS,
      clockToleranceSeconds: c.AUTH_CLOCK_TOLERANCE_SECONDS,
    },
    roster: { signingSecretKey: c.ROSTER_SIGNING_SECRET_KEY, ttlSeconds: c.ROSTER_TTL_SECONDS },
    pairing: { codeTtlSeconds: c.PAIRING_CODE_TTL_SECONDS },
    devices: { heartbeatCoalesceSeconds: c.DEVICE_HEARTBEAT_COALESCE_SECONDS },
    shareSessions: {
      defaultTtlSeconds: c.SHARE_SESSION_DEFAULT_TTL_SECONDS,
      maxTtlSeconds: c.SHARE_SESSION_MAX_TTL_SECONDS,
    },
    realtime: {
      heartbeatIntervalSeconds: c.REALTIME_HEARTBEAT_INTERVAL_SECONDS,
      maxConnectionsPerDevice: c.REALTIME_MAX_CONNECTIONS_PER_DEVICE,
      maxConnectionsPerUser: c.REALTIME_MAX_CONNECTIONS_PER_USER,
      maxMessageBytes: c.REALTIME_MAX_MESSAGE_BYTES,
      messagesPerMinute: c.REALTIME_MESSAGES_PER_MINUTE,
      maxMalformedMessages: c.REALTIME_MAX_MALFORMED_MESSAGES,
    },
    http: { maxBodyBytes: c.HTTP_MAX_BODY_BYTES },
    rateLimits: {
      loginPerMinute: c.RATE_LIMIT_LOGIN_PER_MINUTE,
      signupPerHour: c.RATE_LIMIT_SIGNUP_PER_HOUR,
      refreshPerMinute: c.RATE_LIMIT_REFRESH_PER_MINUTE,
      pairingPerHour: c.RATE_LIMIT_PAIRING_PER_HOUR,
      registerDevicePerHour: c.RATE_LIMIT_REGISTER_DEVICE_PER_HOUR,
      sessionJoinPerMinute: c.RATE_LIMIT_SESSION_JOIN_PER_MINUTE,
      defaultPerMinute: c.RATE_LIMIT_DEFAULT_PER_MINUTE,
    },
  };
}
