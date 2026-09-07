import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { sql, type ExtractTablesWithRelations } from 'drizzle-orm';
import { drizzle as drizzleNode, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { APP_CONFIG, type AppConfig } from '../config/configuration';
import type * as PgModule from 'pg';
import type * as PgliteModule from '@electric-sql/pglite';
import { schema } from './schema';

type Schema = typeof schema;
type Relations = ExtractTablesWithRelations<Schema>;

/**
 * What a repository is handed. Both a plain connection and an open transaction satisfy it, which
 * is what lets a service compose several repositories inside one transaction without the
 * repositories knowing about each other (ADR-007).
 */
export type Executor = PgDatabase<PgQueryResultHKT, Schema, Relations>;

interface Closeable {
  close(): Promise<void>;
}

/**
 * Owns the connection and the transaction primitive.
 *
 * Production uses node-postgres. Tests use PGlite — real PostgreSQL compiled to WebAssembly, in
 * process — with the same schema and the same migrations, so constraint behaviour under test is
 * the behaviour in production. That matters here more than usual, because the constraints are
 * security controls: a mock would happily accept a duplicate device key.
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly database: Executor;
  private readonly closeable: Closeable;
  readonly driver: 'postgres' | 'pglite';

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    if (config.database.url) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Pool } = require('pg') as typeof PgModule;
      const pool = new Pool({ connectionString: config.database.url, max: config.database.poolMax });
      this.database = drizzleNode(pool, { schema });
      this.closeable = { close: () => pool.end() };
      this.driver = 'postgres';
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { PGlite } = require('@electric-sql/pglite') as typeof PgliteModule;
      const client = new PGlite();
      this.database = drizzlePglite(client, { schema });
      this.closeable = { close: () => client.close() };
      this.driver = 'pglite';
    }
  }

  get db(): Executor {
    return this.database;
  }

  /**
   * Runs `fn` in a transaction. Every multi-record state change goes through here: registration,
   * revocation, refresh rotation, session join, member revocation. A revocation that half-succeeds
   * leaves a revoked device holding a live token, which is a security bug rather than a data
   * integrity inconvenience.
   */
  runInTransaction<T>(fn: (tx: Executor) => Promise<T>): Promise<T> {
    return this.database.transaction((tx) => fn(tx as unknown as Executor));
  }

  /**
   * Applies pending migrations in filename order, recording each in `_migrations`.
   *
   * Hand-rolled rather than drizzle-kit's migrator so the identical SQL runs on both drivers with
   * no generated journal to keep in sync.
   */
  async migrate(directory = join(__dirname, 'migrations')): Promise<string[]> {
    await this.database.execute(
      sql`CREATE TABLE IF NOT EXISTS _migrations (
            name text PRIMARY KEY,
            applied_at timestamptz NOT NULL DEFAULT now()
          )`,
    );
    const applied = new Set(
      this.rowsOf(await this.database.execute(sql`SELECT name FROM _migrations`)).map((r) =>
        String((r as { name: unknown }).name),
      ),
    );
    const files = readdirSync(directory)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const ran: string[] = [];
    for (const file of files) {
      if (applied.has(file)) continue;
      const statements = splitSqlStatements(readFileSync(join(directory, file), 'utf8'));
      // Each migration is one transaction: a partially applied schema is not a state we want to
      // debug at 3am.
      await this.database.transaction(async (tx) => {
        // One statement per execute. Both drivers send these over the extended query protocol,
        // which permits exactly one command per prepared statement.
        for (const statement of statements) await tx.execute(sql.raw(statement));
        await tx.execute(sql`INSERT INTO _migrations (name) VALUES (${file})`);
      });
      ran.push(file);
    }
    return ran;
  }

  /**
   * Normalises a raw `execute` result. node-postgres returns `{ rows }`; some drivers return the
   * array directly. The base Drizzle type erases both to `unknown`, so this is the one place that
   * deals with it rather than every caller.
   */
  private rowsOf(result: unknown): Array<Record<string, unknown>> {
    if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
    const rows = (result as { rows?: unknown }).rows;
    return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
  }

  /** Test-only. Truncates every table, leaving the schema in place. */
  async truncateAll(): Promise<void> {
    await this.database.execute(
      sql`TRUNCATE users, devices, share_sessions, share_members, refresh_tokens, pairing_codes RESTART IDENTITY CASCADE`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.closeable.close();
  }
}

/**
 * Splits a migration file into individual statements.
 *
 * Semicolons inside single-quoted strings, line comments and dollar-quoted blocks are ignored, so
 * a CHECK constraint like `status IN ('a', 'b')` or a function body survives intact. Deliberately
 * a small scanner rather than a regex: a regex that "mostly" splits SQL fails on the one migration
 * that matters.
 */
export function splitSqlStatements(source: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inLineComment = false;
  let dollarTag: string | null = null;

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    const rest = source.slice(i);

    if (inLineComment) {
      if (char === '\n') inLineComment = false;
      current += char;
      continue;
    }
    if (dollarTag) {
      current += char;
      if (rest.startsWith(dollarTag)) {
        current += source.slice(i + 1, i + dollarTag.length);
        i += dollarTag.length - 1;
        dollarTag = null;
      }
      continue;
    }
    if (inSingleQuote) {
      current += char;
      // '' is an escaped quote, not a terminator.
      if (char === "'" && source[i + 1] === "'") {
        current += "'";
        i += 1;
      } else if (char === "'") {
        inSingleQuote = false;
      }
      continue;
    }

    if (rest.startsWith('--')) {
      inLineComment = true;
      current += char;
      continue;
    }
    if (char === "'") {
      inSingleQuote = true;
      current += char;
      continue;
    }
    const dollarMatch = /^\$[A-Za-z_]*\$/.exec(rest);
    if (dollarMatch) {
      dollarTag = dollarMatch[0];
      current += dollarMatch[0];
      i += dollarMatch[0].length - 1;
      continue;
    }
    if (char === ';') {
      if (current.trim()) statements.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  if (current.trim()) statements.push(current.trim());
  return statements;
}

export type { NodePgDatabase };
