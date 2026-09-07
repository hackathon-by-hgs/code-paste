#!/usr/bin/env node
/**
 * Jest runner.
 *
 * PGlite loads its WebAssembly build through a dynamic import, which Jest's VM refuses without
 * `--experimental-vm-modules`. Setting it here rather than inline in the npm script keeps the
 * command identical on Windows, macOS, Linux and CI, where `VAR=x cmd` is not portable and would
 * otherwise need a `cross-env` dependency (`RULES.md` §9: is there a standard-library solution?).
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Resolved by path rather than by specifier: jest's package exports do not expose `bin/jest.js`,
// so `require.resolve` refuses it.
const jestBin = fileURLToPath(new URL('../node_modules/jest/bin/jest.js', import.meta.url));
if (!existsSync(jestBin)) {
  process.stderr.write('jest is not installed. Run `npm install` first.\n');
  process.exit(1);
}

const nodeOptions = [process.env.NODE_OPTIONS, '--experimental-vm-modules'].filter(Boolean).join(' ');

const child = spawn(process.execPath, [jestBin, '--config', 'jest.config.js', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: nodeOptions },
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
