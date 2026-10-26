#!/usr/bin/env node
// Validates everything under contracts/ that can be checked mechanically:
// schemas compile, the event vectors are labelled honestly, and each label is
// what a validator actually does with the vector.
//
// `DEV_GUIDE.md` §6 says main's CI does this. For a long time it did not, so a
// contract could be merged that no implementation could satisfy.

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse as parseYaml } from 'yaml';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const contracts = join(here, '..');
const schemaDir = join(contracts, 'schema');
const vectorDir = join(contracts, 'vectors');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

let failures = 0;
const fail = (msg) => { console.error(`  FAIL  ${msg}`); failures++; };
const ok = (msg) => console.log(`  ok    ${msg}`);

// --- schemas compile ----------------------------------------------------------
console.log('schemas');
const schemaFiles = readdirSync(schemaDir).filter((f) => f.endsWith('.json'));

// `$ref`s between schema files use bare filenames, so each schema is registered
// under both its $id and its filename.
const build = (useFormats) => {
  const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: useFormats });
  if (useFormats) addFormats(ajv);
  // Registered under the filename; ajv also indexes each schema by its own
  // $id, which is what the cross-file `device.schema.json#/$defs/...` refs
  // resolve against.
  for (const f of schemaFiles) {
    ajv.addSchema(read(join(schemaDir, f)), f);
  }
  return ajv;
};

let ajvFormats;
try {
  ajvFormats = build(true);
  build(false);
  ok(`${schemaFiles.length} schemas compile, with and without format support`);
} catch (e) {
  fail(`schema compilation: ${e.message}`);
  process.exit(1);
}

for (const f of schemaFiles) {
  const s = read(join(schemaDir, f));
  if (!s.$schema) fail(`${f} has no $schema`);
  if (!s.$id) fail(`${f} has no $id`);
}
ok('every schema declares $schema and $id');

// --- clipboard event vectors --------------------------------------------------
console.log('clipboard-event vectors');
const validate = ajvFormats.getSchema('clipboard-event.schema.json');
if (!validate) {
  fail('clipboard-event.schema.json did not register');
  process.exit(1);
}

const load = (kind) =>
  readdirSync(join(vectorDir, kind))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ file: f, ...read(join(vectorDir, kind, f)) }));

const valid = load('valid');
const invalid = load('invalid');

for (const v of valid) {
  if (v.rejectedBy) fail(`valid/${v.file} carries a rejectedBy discriminator`);
  if (!validate(v.event)) {
    fail(`valid/${v.file} is rejected by the schema: ${ajvFormats.errorsText(validate.errors)}`);
  }
}
ok(`${valid.length} valid vectors accepted by the schema`);

let schemaRejected = 0;
let semanticOnly = 0;
for (const v of invalid) {
  if (!['schema', 'semantic'].includes(v.rejectedBy)) {
    fail(`invalid/${v.file} has rejectedBy=${JSON.stringify(v.rejectedBy)}; expected schema|semantic`);
    continue;
  }
  const passes = validate(v.event);
  if (v.rejectedBy === 'schema') {
    if (passes) fail(`invalid/${v.file} claims rejectedBy=schema but the schema accepts it`);
    else schemaRejected++;
  } else {
    // The point of the discriminator: these are well formed and the schema
    // cannot see what is wrong with them.
    if (!passes) {
      fail(`invalid/${v.file} claims rejectedBy=semantic but the schema already rejects it`);
    } else semanticOnly++;
  }
}
ok(`${schemaRejected} vectors rejected by the schema, as labelled`);
ok(`${semanticOnly} vectors pass the schema and need the semantic layer, as labelled`);

if (!semanticOnly) fail('no semantic-only vectors found; the discriminator has stopped meaning anything');

// --- every vector references a known content type -----------------------------
const declared = read(join(schemaDir, 'clipboard-event.schema.json')).properties.contentType.enum;
for (const v of valid) {
  if (!declared.includes(v.event.contentType)) {
    fail(`valid/${v.file} uses contentType ${v.event.contentType}, absent from the schema enum`);
  }
}
ok('valid vectors use only declared content types');

// --- OpenAPI document ---------------------------------------------------------
console.log('openapi');
{
  const file = join(contracts, 'openapi', 'control-plane.yaml');
  let doc;
  try {
    doc = parseYaml(readFileSync(file, 'utf8'));
  } catch (e) {
    fail(`control-plane.yaml does not parse: ${e.message}`);
    doc = null;
  }

  if (doc) {
    if (!/^3\./.test(doc.openapi ?? '')) {
      fail(`openapi version is ${JSON.stringify(doc.openapi)}; expected 3.x`);
    } else {
      ok(`openapi ${doc.openapi}`);
    }

    const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
    const paths = Object.keys(doc.paths ?? {});
    const operations = paths.flatMap((p) =>
      Object.keys(doc.paths[p]).filter((k) => METHODS.includes(k)),
    );
    const schemas = Object.keys(doc.components?.schemas ?? {});
    ok(`${paths.length} paths, ${operations.length} operations, ${schemas.length} schemas`);

    if (!paths.length) fail('no paths defined');
    if (!operations.length) fail('no operations defined');

    // Every internal $ref must point at something that exists. A dangling ref
    // is a client generated against an endpoint the server never implements.
    const refs = [];
    const collect = (node) => {
      if (Array.isArray(node)) return node.forEach(collect);
      if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) {
          if (k === '$ref' && typeof v === 'string') refs.push(v);
          else collect(v);
        }
      }
    };
    collect(doc);

    let dangling = 0;
    for (const ref of new Set(refs)) {
      if (!ref.startsWith('#/')) {
        fail(`external $ref not allowed: ${ref}`);
        continue;
      }
      let node = doc;
      for (const part of ref.slice(2).split('/')) {
        node = node?.[part.replace(/~1/g, '/').replace(/~0/g, '~')];
      }
      if (node === undefined) {
        fail(`dangling $ref: ${ref}`);
        dangling++;
      }
    }
    if (!dangling) ok(`${new Set(refs).size} distinct $refs all resolve`);
  }
}

console.log('');
if (failures) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log(`contracts verified: ${schemaFiles.length} schemas, ${valid.length} valid and ${invalid.length} invalid vectors`);
