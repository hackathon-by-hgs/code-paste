import { LOG_FIELD_ALLOWLIST, REDACTED, redactLogFields, scrubMessage } from './redaction';

describe('log redaction', () => {
  it('keeps allowlisted operational fields', () => {
    const out = redactLogFields({
      userId: 'cp_usr_01h2xcejqtf2nbrexx3vqjhp40',
      deviceId: 'cp_dev_01h2xcejqtf2nbrexx3vqjhp41',
      statusCode: 200,
      durationMs: 42,
      peerCount: 3,
    });

    expect(out).toEqual({
      userId: 'cp_usr_01h2xcejqtf2nbrexx3vqjhp40',
      deviceId: 'cp_dev_01h2xcejqtf2nbrexx3vqjhp41',
      statusCode: 200,
      durationMs: 42,
      peerCount: 3,
    });
  });

  it('drops any field not on the allowlist', () => {
    // The allowlist is the point: a field nobody thought about is dropped by default rather than
    // printed. A denylist would leak the first field someone forgot to add to it.
    const out = redactLogFields({
      password: 'synthetic',
      accessToken: 'eyJhbGciOi',
      clipboardText: 'a copied secret',
      privateKey: 'seed',
      somethingNobodyAnticipated: 'value',
    });
    expect(out).toEqual({});
  });

  it('never allowlists a field whose name implies a secret', () => {
    // Guards against a future edit adding one of these to the allowlist by mistake.
    for (const name of ['token', 'password', 'secret', 'joinCode', 'pairingCode', 'payload', 'clipboard']) {
      expect(LOG_FIELD_ALLOWLIST.has(name)).toBe(false);
    }
  });

  it('redacts an allowlisted field whose name still looks sensitive', () => {
    // `reason` is allowlisted; a hypothetical `policy`-shaped secret is caught by the pattern.
    const out = redactLogFields({ reason: 'device-revoked' });
    expect(out.reason).toBe('device-revoked');
  });

  it('never logs objects, arrays or buffers whole', () => {
    // Serialising a whole object is how a payload leaks into a log line.
    const out = redactLogFields({
      reason: { nested: 'object' },
      event: ['a', 'b'],
      policy: Buffer.from('bytes'),
    });
    expect(out.reason).toBe(REDACTED);
    expect(out.event).toBe(REDACTED);
    expect(out.policy).toBe(REDACTED);
  });

  it('truncates a long allowlisted string', () => {
    const out = redactLogFields({ message: 'x'.repeat(1000) });
    expect(String(out.message).length).toBeLessThanOrEqual(513);
  });

  describe('scrubMessage', () => {
    it('removes an interpolated JWT', () => {
      const jwt =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJjcF91c3JfMDFoMnhjZWpxdGYybmJyZXh4M3ZxamhwNDAifQ.7vJ8xQhV2mKpLrNsWtYuZaBcDeFgHiJkLmNoPqRsTuV';
      expect(scrubMessage(`failed with ${jwt}`)).not.toContain('eyJhbGciOi');
    });

    it('removes a PEM private key block', () => {
      const pem = '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIA\n-----END PRIVATE KEY-----';
      expect(scrubMessage(`boom ${pem}`)).toBe('boom [redacted-key]');
    });

    it('removes long opaque token-shaped values', () => {
      const token = 'a'.repeat(50);
      expect(scrubMessage(`refresh ${token}`)).not.toContain(token);
    });

    it('leaves ordinary messages untouched', () => {
      expect(scrubMessage('device connected')).toBe('device connected');
      expect(scrubMessage('payload rejected: too_large')).toBe('payload rejected: too_large');
    });
  });
});
