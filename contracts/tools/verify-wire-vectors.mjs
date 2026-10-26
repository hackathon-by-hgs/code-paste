#!/usr/bin/env node
// Recomputes the LAN wire vectors from their own inputs and checks the committed
// expectations. Node's stdlib only, so there is nothing to install and nothing
// that can drift.
//
// This keeps the vectors honest. A vector file is an assertion about the
// protocol in ADR-009; if nobody recomputes it, a typo in a hex string becomes
// the contract and every implementation that "conforms" is wrong together.

import { createHash, createPrivateKey, createPublicKey, diffieHellman, hkdfSync, verify as edVerify, createCipheriv } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', 'vectors', 'wire');
const read = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8'));

const PKCS8 = {
  x25519: Buffer.from('302e020100300506032b656e04220420', 'hex'),
  ed25519: Buffer.from('302e020100300506032b657004220420', 'hex'),
};
const SPKI = {
  x25519: Buffer.from('302a300506032b656e032100', 'hex'),
  ed25519: Buffer.from('302a300506032b6570032100', 'hex'),
};
const priv = (alg, raw) =>
  createPrivateKey({ key: Buffer.concat([PKCS8[alg], raw]), format: 'der', type: 'pkcs8' });
const pub = (alg, raw) =>
  createPublicKey({ key: Buffer.concat([SPKI[alg], raw]), format: 'der', type: 'spki' });
const hex = (s) => Buffer.from(s, 'hex');

let failures = 0;
const check = (label, actual, expected) => {
  const a = Buffer.isBuffer(actual) ? actual.toString('hex') : String(actual);
  const e = Buffer.isBuffer(expected) ? expected.toString('hex') : String(expected);
  if (a === e) {
    console.log(`  ok    ${label}`);
  } else {
    console.error(`  FAIL  ${label}\n          expected ${e}\n          actual   ${a}`);
    failures++;
  }
};

// --- handshake and key schedule ----------------------------------------------
console.log('handshake-kdf.json');
{
  const v = read('handshake-kdf.json');
  const i = v.input;
  const want = v.expected;

  const dEphPub = hex(i.dialerEphemeralPublic);
  const lEphPub = hex(i.listenerEphemeralPublic);
  const dStaticPub = hex(i.dialerStaticPublic);
  const lStaticPub = hex(i.listenerStaticPublic);

  // Public halves must really belong to the listed private halves.
  const derive = (alg, rawPriv) =>
    createPublicKey(priv(alg, hex(rawPriv))).export({ format: 'der', type: 'spki' }).subarray(-32);
  check('dialer static public derives from its private', derive('ed25519', i.dialerStaticPrivate), dStaticPub);
  check('listener static public derives from its private', derive('ed25519', i.listenerStaticPrivate), lStaticPub);
  check('dialer ephemeral public derives from its private', derive('x25519', i.dialerEphemeralPrivate), dEphPub);
  check('listener ephemeral public derives from its private', derive('x25519', i.listenerEphemeralPrivate), lEphPub);

  const transcript = Buffer.concat([
    Buffer.from(v.transcriptLabel), dEphPub, dStaticPub, lEphPub, lStaticPub,
  ]);
  check('transcript', transcript, hex(want.transcript));

  // Both sides of the exchange must reach the same secret.
  const sharedD = diffieHellman({ privateKey: priv('x25519', hex(i.dialerEphemeralPrivate)), publicKey: pub('x25519', lEphPub) });
  const sharedL = diffieHellman({ privateKey: priv('x25519', hex(i.listenerEphemeralPrivate)), publicKey: pub('x25519', dEphPub) });
  check('shared secret (dialer side)', sharedD, hex(want.sharedSecret));
  check('shared secret (listener side agrees)', sharedL, sharedD);

  const salt = createHash('sha256').update(transcript).digest();
  check('salt = sha256(transcript)', salt, hex(want.salt));

  const material = Buffer.from(hkdfSync('sha256', sharedD, salt, Buffer.from(v.keyLabel), 64));
  check('hkdf material', material, hex(want.material));
  check('dialerToListener', material.subarray(0, 32), hex(want.dialerToListener));
  check('listenerToDialer', material.subarray(32, 64), hex(want.listenerToDialer));

  for (const [who, sig, key] of [
    ['dialer', want.dialerSignature, dStaticPub],
    ['listener', want.listenerSignature, lStaticPub],
  ]) {
    const ok = edVerify(null, transcript, pub('ed25519', key), hex(sig));
    check(`${who} signature verifies over the transcript`, ok, 'true');
  }
}

// --- frame body encoding and sealing -----------------------------------------
console.log('frame-seal.json');
{
  const v = read('frame-seal.json');
  const key = hex(v.key);

  for (const tc of v.cases) {
    const payload = hex(tc.payloadHex);
    const meta = Buffer.from(JSON.stringify(tc.meta), 'utf8');
    const head = Buffer.alloc(5);
    head.writeUInt8(0x01, 0);
    head.writeUInt32BE(meta.length, 1);
    const body = Buffer.concat([head, meta, payload]);
    check(`${tc.name}: body encoding`, body, hex(tc.bodyHex));

    // The two bindings ADR-009 requires a receiver to check.
    check(`${tc.name}: size equals payload length`, String(tc.meta.size), String(payload.length));
    check(`${tc.name}: hash equals sha256(payload)`,
      'sha256:' + createHash('sha256').update(payload).digest('hex'), tc.meta.hash);

    const nonce = Buffer.alloc(12);
    nonce.writeBigUInt64BE(BigInt(tc.sequence), 4);
    check(`${tc.name}: nonce layout`, nonce, hex(tc.nonceHex));

    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    const sealed = Buffer.concat([cipher.update(body), cipher.final(), cipher.getAuthTag()]);
    const header = Buffer.alloc(4);
    header.writeUInt32BE(sealed.length, 0);
    check(`${tc.name}: sealed frame`, Buffer.concat([header, sealed]), hex(tc.frameHex));
  }
}

// --- invalid bodies really are invalid ---------------------------------------
console.log('frame-body-invalid.json');
{
  const v = read('frame-body-invalid.json');
  const MAX_META = 65535;

  // A deliberately strict reader. Each case must be refused by it.
  const reject = (body) => {
    if (body.length < 5) return 'truncated header';
    if (body.readUInt8(0) !== 0x01) return 'unknown frame type';
    const metaLen = body.readUInt32BE(1);
    if (metaLen > MAX_META) return 'metaLen over cap';
    if (5 + metaLen > body.length) return 'metaLen overruns body';
    let meta;
    try {
      meta = JSON.parse(body.subarray(5, 5 + metaLen).toString('utf8'));
    } catch {
      return 'metaJSON unparseable';
    }
    if ('payload' in meta) return 'payload present in metadata';
    const payload = body.subarray(5 + metaLen);
    if (meta.size !== payload.length) return 'size disagrees with payload';
    if (meta.hash !== 'sha256:' + createHash('sha256').update(payload).digest('hex')) {
      return 'hash disagrees with payload';
    }
    return null;
  };

  for (const tc of v.cases) {
    const why = reject(hex(tc.bodyHex));
    if (why) {
      console.log(`  ok    ${tc.name} rejected (${why})`);
    } else {
      console.error(`  FAIL  ${tc.name} was ACCEPTED but must be rejected`);
      failures++;
    }
  }
}

console.log('');
if (failures) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('all wire vectors verified');
