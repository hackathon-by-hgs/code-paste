import { ID_PREFIX, isValidId, newCorrelationId, newDeviceId, newSessionId, newUserId } from './ids';

describe('opaque identifiers', () => {
  it('matches the contract pattern for each entity', () => {
    expect(newUserId()).toMatch(/^cp_usr_[0-9a-hjkmnp-tv-z]{26}$/);
    expect(newDeviceId()).toMatch(/^cp_dev_[0-9a-hjkmnp-tv-z]{26}$/);
    expect(newSessionId()).toMatch(/^cp_ses_[0-9a-hjkmnp-tv-z]{26}$/);
    expect(newCorrelationId()).toMatch(/^[0-9a-hjkmnp-tv-z]{26}$/);
  });

  it('never emits the ambiguous characters i, l, o or u', () => {
    const sample = Array.from({ length: 300 }, () => newDeviceId()).join('');
    expect(sample.slice(7)).not.toMatch(/[ilou]/);
  });

  it('does not collide across a large sample', () => {
    const ids = new Set(Array.from({ length: 5000 }, () => newDeviceId()));
    expect(ids.size).toBe(5000);
  });

  it('sorts chronologically without revealing a sequence', () => {
    // Timestamp-prefixed so ids sort by creation, but the remaining 80 bits are random — an
    // incrementing id would leak how many devices exist.
    const earlier = newDeviceId(new Date('2026-01-01T00:00:00.000Z').getTime());
    const later = newDeviceId(new Date('2026-06-01T00:00:00.000Z').getTime());
    expect(earlier < later).toBe(true);

    const sameMs = new Date('2026-01-01T00:00:00.000Z').getTime();
    expect(newDeviceId(sameMs)).not.toBe(newDeviceId(sameMs));
  });

  describe('isValidId', () => {
    it('accepts a well-formed id of the right kind', () => {
      expect(isValidId(newDeviceId(), ID_PREFIX.device)).toBe(true);
    });

    it('rejects an id of the wrong kind', () => {
      // A session id must never be accepted where a device id is expected.
      expect(isValidId(newSessionId(), ID_PREFIX.device)).toBe(false);
      expect(isValidId(newUserId(), ID_PREFIX.device)).toBe(false);
    });

    it('rejects malformed, empty and non-string values', () => {
      expect(isValidId('cp_dev_short', ID_PREFIX.device)).toBe(false);
      expect(isValidId('cp_dev_' + 'i'.repeat(26), ID_PREFIX.device)).toBe(false); // excluded letter
      expect(isValidId('', ID_PREFIX.device)).toBe(false);
      expect(isValidId(null, ID_PREFIX.device)).toBe(false);
      expect(isValidId(42, ID_PREFIX.device)).toBe(false);
      expect(isValidId('192.168.1.1', ID_PREFIX.device)).toBe(false);
    });
  });
});
