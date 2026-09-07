import type { Config } from 'drizzle-kit';

export default {
  schema: './src/persistence/schema.ts',
  out: './src/persistence/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/code_paste' },
} satisfies Config;
