#!/usr/bin/env node
// Contract conformance validator for `main`.
//
// `main` owns the contracts every domain must agree on (DEV_GUIDE.md §5). Its CI proves the
// contracts are internally consistent BEFORE any domain pins them:
//
//   1. Every JSON Schema under contracts/schema/ compiles as a valid 2020-12 schema.
//   2. Every vector in contracts/vectors/valid/ is accepted by clipboard-event.schema.json.
//   3. Every vector in contracts/vectors/invalid/ with `rejectedBy: "schema"` is REJECTED by it.
//      These are the structural security surface — an implementation that accepts one has a bug.
//   4. Vectors with `rejectedBy: "semantic"` are asserted to be schema-VALID: the schema alone
//      cannot catch them (hash mismatch, size mismatch, over-limit); rejecting them is the job of
//      each domain's conformance suite. We prove here only that they are well-formed envelopes.
//
// No network, no domain code. Pure structural truth about the contract package.

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const HERE = dirname(fileURLToPath(import.meta.url));
// tools/contracts-validate -> repo root
const ROOT = join(HERE, '..', '..');
const SCHEMA_DIR = join(ROOT, 'contracts', 'schema');
const VALID_DIR = join(ROOT, 'contracts', 'vectors', 'valid');
const INVALID_DIR = join(ROOT, 'contracts', 'vectors', 'invalid');
const EVENT_SCHEMA_ID = 'https://contracts.code-paste.dev/protocol-v1/clipboard-event.schema.json';

const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const YEL = (s) => `\x1b[33m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const listJson = (dir) => readdirSync(dir).filter((f) => f.endsWith('.json')).sort();

const failures = [];
const warnings = [];
let checks = 0;
const pass = (msg) => {
  checks++;
  console.log(`  ${GREEN('✓')} ${msg}`);
};
const fail = (msg) => {
  checks++;
  failures.push(msg);
  console.log(`  ${RED('✗')} ${msg}`);
};
const warn = (msg) => {
  warnings.push(msg);
  console.log(`  ${YEL('!')} ${DIM(msg)}`);
};

// --- 1. Compile every schema -------------------------------------------------
console.log('\nSchemas');
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

for (const file of listJson(SCHEMA_DIR)) {
  try {
    ajv.addSchema(readJson(join(SCHEMA_DIR, file)));
    pass(`registered ${file}`);
  } catch (err) {
    fail(`${file} failed to register: ${err.message}`);
  }
}

let validateEvent = null;
try {
  validateEvent = ajv.getSchema(EVENT_SCHEMA_ID);
  if (!validateEvent) throw new Error(`schema id not found: ${EVENT_SCHEMA_ID}`);
  // Force cross-$ref resolution to compile now, surfacing broken refs as a hard failure.
  validateEvent({});
  pass('clipboard-event schema compiled (cross-refs resolved)');
} catch (err) {
  fail(`clipboard-event schema did not compile: ${err.message}`);
}

// --- 2. Valid vectors MUST be accepted --------------------------------------
console.log('\nValid vectors (must be accepted)');
if (validateEvent) {
  for (const file of listJson(VALID_DIR)) {
    const vec = readJson(join(VALID_DIR, file));
    const event = vec.event ?? vec;
    if (validateEvent(event)) {
      pass(`${basename(file)} accepted`);
    } else {
      fail(`${basename(file)} rejected but should be VALID — ${ajv.errorsText(validateEvent.errors)}`);
    }
  }
}

// --- 3 & 4. Invalid vectors --------------------------------------------------
console.log('\nInvalid vectors');
if (validateEvent) {
  for (const file of listJson(INVALID_DIR)) {
    const vec = readJson(join(INVALID_DIR, file));
    const event = vec.event ?? vec;
    const rejectedBy = vec.rejectedBy ?? 'schema'; // default: expect structural rejection
    const accepted = validateEvent(event);

    if (rejectedBy === 'schema') {
      if (!accepted) {
        pass(`${vec.name} rejected by schema ${DIM('(' + (vec.reason ?? '') + ')')}`);
      } else {
        fail(`${vec.name} was ACCEPTED but is tagged rejectedBy:"schema" — schema fails to reject it`);
      }
    } else if (rejectedBy === 'semantic') {
      if (accepted) {
        pass(`${vec.name} is a well-formed envelope; rejection deferred to implementations ${DIM('(semantic)')}`);
      } else {
        // Not fatal: schema over-catching a semantic case is acceptable, but likely a mislabel.
        warn(`${vec.name} is tagged semantic yet the schema already rejects it (possible mislabel)`);
      }
    } else {
      fail(`${vec.name} has unknown rejectedBy:"${rejectedBy}" (expected "schema" or "semantic")`);
    }
  }
}

// --- Summary -----------------------------------------------------------------
console.log('\n' + '─'.repeat(60));
console.log(`${checks} checks · ${GREEN(String(checks - failures.length) + ' passed')} · ` +
  `${failures.length ? RED(failures.length + ' failed') : '0 failed'} · ` +
  `${warnings.length} warning(s)`);

if (failures.length) {
  console.error(RED(`\nContract validation FAILED (${failures.length}):`));
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(GREEN('\nContracts are internally consistent.\n'));
