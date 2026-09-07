#!/usr/bin/env node
/**
 * Copies non-TypeScript build assets into `dist/`.
 *
 * `tsc` emits only `.ts` -> `.js`, so the SQL migrations were absent from the built artifact and
 * the server died at startup on `scandir dist/persistence/migrations`. Every test passes without
 * this, because tests run against `src/`; only booting the artifact reveals it — which is why
 * `npm run smoke` exists.
 */
import { cpSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDir = dirname(dirname(fileURLToPath(import.meta.url)));

const assets = [['src/persistence/migrations', 'dist/persistence/migrations']];

for (const [from, to] of assets) {
  const source = join(backendDir, from);
  if (!existsSync(source)) {
    process.stderr.write(`copy-assets: missing source ${from}\n`);
    process.exit(1);
  }
  cpSync(source, join(backendDir, to), { recursive: true });
  const count = readdirSync(join(backendDir, to)).length;
  process.stdout.write(`copy-assets: ${from} -> ${to} (${count} files)\n`);
}
