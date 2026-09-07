#!/usr/bin/env node
/**
 * Extracts the pinned contracts from the tag named in CONTRACTS_VERSION.
 *
 * Contracts are never vendored or copy-pasted into this branch (`DEV_GUIDE.md` §5) — they are
 * fetched from a tag on `main`, and `.contracts/` is gitignored. That is what makes drift between
 * a domain and the contract it claims to implement impossible to hide.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDir = dirname(fileURLToPath(new URL('.', import.meta.url)));
const branchRoot = dirname(backendDir);
const versionFile = join(branchRoot, 'CONTRACTS_VERSION');

if (!existsSync(versionFile)) {
  process.stderr.write(`CONTRACTS_VERSION not found at ${versionFile}\n`);
  process.exit(1);
}

const tag = readFileSync(versionFile, 'utf8').trim();
const target = join(backendDir, '.contracts');

function run(command, args) {
  return execFileSync(command, args, { cwd: branchRoot, stdio: ['ignore', 'pipe', 'pipe'] });
}

try {
  run('git', ['rev-parse', '--verify', `${tag}^{tag}`]);
} catch {
  try {
    run('git', ['rev-parse', '--verify', tag]);
  } catch {
    process.stderr.write(
      `Contract tag "${tag}" is not available.\n\n` +
        `Fetch it from main:\n  git fetch origin --tags\n\n` +
        `If the tag does not exist yet, it is created on main AFTER the contracts PR merges\n` +
        `(DEV_GUIDE.md §5.4). Until then this branch cannot pin a contract.\n`,
    );
    process.exit(1);
  }
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });

// `git archive` to a file rather than through a pipe: the archive can exceed the default stdio
// buffer, and a truncated contract set would be worse than a loud failure. A checkout is avoided
// entirely so the working tree is never touched.
const archivePath = join(target, 'contracts.tar');
run('git', ['archive', '--output', archivePath, tag, 'contracts']);
// tar is invoked with cwd set and a RELATIVE filename: GNU tar reads an absolute Windows path
// like `C:\...` as a `host:path` remote spec and tries to open an SSH connection.
execFileSync('tar', ['-xf', 'contracts.tar'], { cwd: target, stdio: 'inherit' });
rmSync(archivePath, { force: true });

process.stdout.write(`Pinned contracts ${tag} -> backend/.contracts/\n`);
