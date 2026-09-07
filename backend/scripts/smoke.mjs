#!/usr/bin/env node
/**
 * Boots the built artifact and checks it actually serves.
 *
 * This gate exists because `npm run build` exiting 0 does NOT mean the build works. TypeScript's
 * incremental mode once skipped emitting most of `dist/` while still exiting 0, producing an
 * artifact that crashed on its first require — and every other gate stayed green, because they all
 * run against `src/`. Compiling is not the same as starting.
 *
 * Deliberately minimal: start the real entry point, wait for /v1/health, stop it. Nothing here
 * touches the database beyond what booting requires.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const backendDir = dirname(dirname(fileURLToPath(import.meta.url)));
const entry = join(backendDir, 'dist', 'main.js');
const PORT = process.env.SMOKE_PORT ?? '3199';
const TIMEOUT_MS = 30_000;

const server = spawn(process.execPath, [entry], {
  cwd: backendDir,
  env: {
    ...process.env,
    NODE_ENV: 'development',
    PORT,
    LOG_LEVEL: 'error',
    // Synthetic, and the in-process driver: the smoke test proves the artifact boots and serves,
    // not that a particular database is reachable.
    DATABASE_URL: '',
    AUTH_JWT_SECRET: 'smoke-test-synthetic-secret-0123456789abcdefghij',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
server.stdout.on('data', (c) => (output += c.toString()));
server.stderr.on('data', (c) => (output += c.toString()));

/**
 * Set before we ask the server to stop.
 *
 * Without it, our own shutdown trips the "exited unexpectedly" handler below: PGlite is a
 * WebAssembly runtime and, killed mid-flight on Windows, it aborts with a libuv assertion and a
 * non-zero code. That is teardown noise, not a smoke failure — and reporting it as one would make
 * this gate fail every green run.
 */
let shuttingDown = false;

async function stop() {
  shuttingDown = true;
  if (server.exitCode !== null || server.signalCode !== null) return;
  await new Promise((resolve) => {
    // Nest has shutdown hooks enabled, so SIGTERM closes the database cleanly.
    const force = setTimeout(() => {
      server.kill('SIGKILL');
      resolve();
    }, 5000);
    force.unref?.();
    server.once('exit', () => {
      clearTimeout(force);
      resolve();
    });
    server.kill('SIGTERM');
  });
}

const fail = async (message) => {
  process.stderr.write(`smoke: ${message}\n`);
  if (output.trim()) process.stderr.write(`--- server output ---\n${output}\n`);
  await stop();
  process.exitCode = 1;
};

server.on('exit', (code) => {
  if (shuttingDown) return;
  if (code !== null && code !== 0) void fail(`server exited with code ${code} before becoming healthy`);
});

const deadline = Date.now() + TIMEOUT_MS;

async function waitForHealth() {
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/v1/health`);
      if (res.ok) return await res.json();
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

const health = await waitForHealth();
if (!health) await fail(`server did not become healthy within ${TIMEOUT_MS / 1000}s`);

// The protocol endpoint touches config, the contract pin and the payload policy, so a successful
// response proves rather more of the wiring than /health alone.
const protocol = await fetch(`http://127.0.0.1:${PORT}/v1/protocol`).then((r) => r.json());

process.stdout.write(
  `smoke: OK — health=${health.status} driver=${health.driver} ` +
    `protocol=v${protocol.currentProtocolVersion} contracts=${protocol.contractsVersion}\n`,
);
await stop();
// Deliberately NOT process.exit(): calling it while the just-killed child's handle is still
// closing trips a libuv assertion on Windows (UV_HANDLE_CLOSING, src/win/async.c) and aborts this
// process with a spurious non-zero code — a green smoke test that fails the build. Setting
// exitCode and letting the loop drain exits cleanly on every platform.
process.exitCode = 0;
