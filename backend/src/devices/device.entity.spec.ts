import { isRevoked, isSyncEligible, type Device } from './device.entity';

const device: Device = {
  id: 'internal',
  publicId: 'cp_dev_01h2xcejqtf2nbrexx3vqjhp41',
  userId: 'user-internal',
  name: 'Synthetic',
  platform: 'linux',
  appVersion: '1.0.0',
  protocolVersion: 1,
  publicKey: 'A'.repeat(43) + '=',
  keyFingerprint: 'sha256:' + '0'.repeat(64),
  capabilities: { contentTypes: ['text/plain'] },
  syncEnabled: true,
  rosterVersion: 0,
  lastSeenAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  revokedAt: null,
};

describe('device sync eligibility', () => {
  it('is eligible when active and unpaused', () => {
    expect(isRevoked(device)).toBe(false);
    expect(isSyncEligible(device)).toBe(true);
  });

  it('is not eligible when revoked', () => {
    const revoked = { ...device, revokedAt: new Date('2026-01-02T00:00:00.000Z') };
    expect(isRevoked(revoked)).toBe(true);
    expect(isSyncEligible(revoked)).toBe(false);
  });

  it('is not eligible when sync is paused', () => {
    // Pausing is a user preference, not a failure — but a paused device must still disappear from
    // every peer roster while it lasts.
    expect(isSyncEligible({ ...device, syncEnabled: false })).toBe(false);
  });

  it('is not eligible when both revoked and paused', () => {
    expect(isSyncEligible({ ...device, syncEnabled: false, revokedAt: new Date() })).toBe(false);
  });
});
