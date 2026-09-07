import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import yaml from 'js-yaml';
import request from 'supertest';
import { ERROR_CODES } from '../../src/common/errors';
import { CLIENT_MESSAGE_TYPES, SERVER_MESSAGE_TYPES } from '../../src/realtime/realtime.messages';
import { PAYLOAD_LIMITS } from '../../src/protocol/protocol.service';
import { createHarness, type Harness } from '../support/harness';
import { pairDevice, signup } from '../support/factories';

/**
 * Conformance against the contracts pinned by CONTRACTS_VERSION.
 *
 * These tests exist to catch **drift**: the moment the implementation and the contract disagree,
 * CI fails rather than a client discovering it in production. Contracts are read from
 * `.contracts/`, which is fetched from a tag on `main` and never committed here — so this suite is
 * checking against `main`'s copy, not a convenient local one.
 *
 * Note on the clipboard-event vectors: the control plane does not parse clipboard events, by
 * design (ADR-001), so `vectors/valid` and `vectors/invalid` are binding on `shared`, `desktop`
 * and `mobile` rather than on this domain. What IS binding here is checked below — the roster
 * schema, the realtime envelope, the error vocabulary, the payload limits and the OpenAPI surface.
 */

const CONTRACTS = join(__dirname, '../../.contracts/contracts');
const hasContracts = existsSync(CONTRACTS);

const describeIfPinned = hasContracts ? describe : describe.skip;

if (!hasContracts) {
  // A skipped suite must be loud, not invisible: silently skipping conformance is how a domain
  // ends up believing it conforms to a contract it never checked.
  process.stderr.write(
    '\n[contract] .contracts/ is missing. Run `npm run contracts:pin` first. Conformance was SKIPPED.\n\n',
  );
}

function buildAjv() {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  for (const file of readdirSync(join(CONTRACTS, 'schema'))) {
    ajv.addSchema(JSON.parse(readFileSync(join(CONTRACTS, 'schema', file), 'utf8')), file);
  }
  return ajv;
}

describeIfPinned('contract conformance', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    await h.reset();
  });

  describe('pinned contracts', () => {
    it('match the tag this branch claims to implement', () => {
      const pinned = readFileSync(join(CONTRACTS, 'VERSION'), 'utf8').trim();
      const declared = readFileSync(join(__dirname, '../../../CONTRACTS_VERSION'), 'utf8').trim();
      expect(pinned).toBe(declared);
    });

    it('are reported at runtime, so a deployed instance can be checked against its contract', async () => {
      const res = await request(h.app.getHttpServer()).get('/v1/protocol').expect(200);
      const declared = readFileSync(join(__dirname, '../../../CONTRACTS_VERSION'), 'utf8').trim();
      expect(res.body.contractsVersion).toBe(declared);
    });

    it('every schema parses and compiles', () => {
      const ajv = buildAjv();
      for (const file of readdirSync(join(CONTRACTS, 'schema'))) {
        expect(ajv.getSchema(file)).toBeDefined();
      }
    });
  });

  describe('peer roster', () => {
    it('conforms to peer-roster.schema.json, signature and all', async () => {
      const account = await signup(h.app);
      await pairDevice(h.app, account, { name: 'Peer A' });
      const device = await pairDevice(h.app, account, { name: 'Peer B' });

      const res = await request(h.app.getHttpServer())
        .get('/v1/authz/peer-set')
        .set('Authorization', `Bearer ${device.accessToken}`)
        .expect(200);

      const ajv = buildAjv();
      const validateSigned = ajv.getSchema('peer-roster.schema.json')!;
      expect(validateSigned(res.body)).toBe(true);
    });

    it('has a payload conforming to the roster $def', async () => {
      const account = await signup(h.app);
      await pairDevice(h.app, account, { name: 'Peer A' });
      const device = await pairDevice(h.app, account, { name: 'Peer B' });

      const res = await request(h.app.getHttpServer())
        .get('/v1/authz/peer-set')
        .set('Authorization', `Bearer ${device.accessToken}`)
        .expect(200);

      const roster = JSON.parse(Buffer.from(res.body.payload, 'base64').toString('utf8'));

      const ajv = buildAjv();
      const validateRoster = ajv.getSchema('peer-roster.schema.json#/$defs/roster')!;
      const ok = validateRoster(roster);
      if (!ok) process.stderr.write(JSON.stringify(validateRoster.errors, null, 2) + '\n');
      expect(ok).toBe(true);
      expect(roster.peers).toHaveLength(1);
    });

    it('publishes the payload limits the contract defines as authoritative', async () => {
      const account = await signup(h.app);
      const device = await pairDevice(h.app, account);

      const res = await request(h.app.getHttpServer())
        .get('/v1/authz/peer-set')
        .set('Authorization', `Bearer ${device.accessToken}`)
        .expect(200);

      const roster = JSON.parse(Buffer.from(res.body.payload, 'base64').toString('utf8'));
      // Closes SPEC_CONTRACT.md gap #7: one source of truth, so two agents cannot enforce
      // different ceilings.
      expect(roster.limits).toEqual(PAYLOAD_LIMITS);
      expect(roster.limits['text/plain']).toBe(1048576);
      expect(roster.limits['image/png']).toBe(10485760);
    });
  });

  describe('realtime envelope', () => {
    it('implements exactly the message types the contract enumerates', () => {
      const schema = JSON.parse(
        readFileSync(join(CONTRACTS, 'schema', 'realtime-envelope.schema.json'), 'utf8'),
      );

      expect([...CLIENT_MESSAGE_TYPES].sort()).toEqual([...schema.$defs.clientToServer.enum].sort());
      expect([...SERVER_MESSAGE_TYPES].sort()).toEqual([...schema.$defs.serverToClient.enum].sort());
    });

    it('defines no message type that could carry clipboard content', () => {
      // The structural guarantee behind ADR-006. If someone adds a `clipboard.*` or `payload`
      // message type, this fails before the socket can become a relay.
      const all = [...CLIENT_MESSAGE_TYPES, ...SERVER_MESSAGE_TYPES];
      for (const type of all) {
        expect(type).not.toMatch(/clipboard|payload|content|data\./i);
      }
    });
  });

  describe('error vocabulary', () => {
    it('matches the OpenAPI ErrorCode enum exactly', () => {
      const openapi = yaml.load(readFileSync(join(CONTRACTS, 'openapi', 'control-plane.yaml'), 'utf8')) as {
        components: { schemas: { ErrorCode: { enum: string[] } } };
      };
      expect([...ERROR_CODES].sort()).toEqual([...openapi.components.schemas.ErrorCode.enum].sort());
    });
  });

  describe('OpenAPI surface', () => {
    /** Reads the routes Nest actually registered, so drift is detectable in both directions. */
    function implementedRoutes(): Set<string> {
      const instance = h.app.getHttpAdapter().getInstance() as {
        router?: { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> };
        _router?: { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> };
      };
      const stack = (instance.router ?? instance._router)?.stack ?? [];
      const routes = new Set<string>();
      for (const layer of stack) {
        if (!layer.route) continue;
        for (const method of Object.keys(layer.route.methods)) {
          if (method === '_all') continue;
          routes.add(`${method.toUpperCase()} ${layer.route.path}`);
        }
      }
      return routes;
    }

    function documentedRoutes(): Set<string> {
      const openapi = yaml.load(readFileSync(join(CONTRACTS, 'openapi', 'control-plane.yaml'), 'utf8')) as {
        paths: Record<string, Record<string, unknown>>;
      };
      const routes = new Set<string>();
      for (const [path, operations] of Object.entries(openapi.paths)) {
        // Servers carry the /v1 prefix; Nest registers it on each route.
        const expressPath = '/v1' + path.replace(/\{(\w+)\}/g, ':$1');
        for (const method of Object.keys(operations)) {
          if (['get', 'post', 'patch', 'put', 'delete'].includes(method)) {
            routes.add(`${method.toUpperCase()} ${expressPath}`);
          }
        }
      }
      return routes;
    }

    it('implements every documented endpoint', () => {
      const implemented = implementedRoutes();
      const missing = [...documentedRoutes()].filter((route) => !implemented.has(route));
      expect(missing).toEqual([]);
    });

    it('documents every implemented endpoint', () => {
      // The other direction: an undocumented endpoint is a surface clients cannot rely on and
      // reviewers never saw.
      const documented = documentedRoutes();
      const undocumented = [...implementedRoutes()].filter(
        (route) => !documented.has(route) && !route.endsWith('/v1/health'),
      );
      expect(undocumented).toEqual([]);
    });
  });
});
