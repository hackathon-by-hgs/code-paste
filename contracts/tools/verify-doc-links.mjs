#!/usr/bin/env node
// Checks that every relative link in main's markdown resolves.
//
// `main` is the branch every other domain reads its obligations from. A broken
// pointer here is an agent that cannot find the rule it is supposed to follow,
// which is how a requirement quietly stops being implemented.
//
// Lives beside the contract verifiers because contracts/tools/ is where main
// keeps its checks; it is not itself a contract.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.git')) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.name.endsWith('.md')) out.push(p);
  }
  return out;
};

// [text](target) — skipping images is unnecessary here, they resolve the same way.
const LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
// `docs/RULES.md` — a backticked token that looks like a repo path.
const BACKTICK = /`([A-Za-z0-9._\-]+(?:\/[A-Za-z0-9._\-*]+)+\/?)`/g;

let broken = 0;
let checked = 0;
const files = walk(root).sort();

// Paths owned by a domain branch are not on main by design (DEV_GUIDE.md §2),
// so a reference to one is correct even though the file is absent here.
const CROSS_BRANCH = /^(backend|frontend|desktop|mobile|shared)\//;
// Things that look like paths but are not: git refs, globs, illustrative trees.
const NOT_A_PATH = /[*?]|^refs\/|^https?:/;
// Only docs/ and contracts/ are checked, and only tokens that actually name a
// file. `.github/workflows/ci.yml` is excluded because DEV_GUIDE describes the
// copy on each *domain* branch, and shorthand like `docs/ADR-003` or a branch
// name like `contracts/v1-gap-closures` is prose, not a path.
const MAIN_LOCAL = /^(docs|contracts)\//;
const HAS_EXTENSION = /\.(md|json|ya?ml|mjs|js|ts)$/;

const report = (file, target, why) => {
  console.error(`  FAIL  ${relative(root, file)} -> ${target} (${why})`);
  broken++;
};

const exists = (file, target) => {
  const resolved = resolve(dirname(file), target.split('#')[0]);
  if (!existsSync(resolved)) return false;
  statSync(resolved);
  return true;
};

for (const file of files) {
  const body = readFileSync(file, 'utf8');

  // 1. markdown links
  for (const [, target] of body.matchAll(LINK)) {
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const [pathPart] = target.split('#');
    if (!pathPart) continue;
    checked++;
    if (!exists(file, target)) report(file, target, 'no such file');
  }

  // 2. backticked paths that main itself owns
  //
  // main's prose points at its own files in backticks rather than as links, so
  // without this the link check has nothing to look at.
  for (const [, token] of body.matchAll(BACKTICK)) {
    if (NOT_A_PATH.test(token) || CROSS_BRANCH.test(token)) continue;
    if (!MAIN_LOCAL.test(token)) continue;
    const isDir = token.endsWith('/');
    if (!isDir && !HAS_EXTENSION.test(token)) continue;
    checked++;
    const target = isDir ? token.slice(0, -1) : token;
    if (!existsSync(resolve(root, target))) {
      report(file, token, 'referenced on main but absent');
    }
  }
}

console.log(`  ok    ${checked} references across ${files.length} markdown files`);
if (broken) {
  console.error(`\n${broken} broken reference(s)`);
  process.exit(1);
}
console.log('every main-local reference resolves');
