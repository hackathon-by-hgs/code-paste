import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { DeviceList } from '../../src/components/DeviceList';
import { DevicesProvider } from '../../src/features/devices/DevicesProvider';
import type { Device } from '../../src/api/types';

vi.mock('../../src/api/devices', () => ({
  getDevices: vi.fn(),
  setDeviceSync: vi.fn(),
  revokeDevice: vi.fn(),
  createPairingCode: vi.fn(),
}));

import {
  getDevices,
  setDeviceSync,
  revokeDevice,
  createPairingCode,
} from '../../src/api/devices';

const device = (over: Partial<Device> = {}): Device => ({
  id: 'cp_dev_01h2xcejqtf2nbrexx3vqjhp41',
  name: 'MacBook Pro',
  platform: 'macos',
  appVersion: '1.0.0',
  protocolVersion: 1,
  publicKey: 'k',
  keyFingerprint: `sha256:${'1'.repeat(64)}`,
  capabilities: { contentTypes: ['text/plain'] },
  syncEnabled: true,
  revoked: false,
  revokedAt: null,
  lastSeenAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  ...over,
});

const renderList = () =>
  render(
    <DevicesProvider>
      <DeviceList />
    </DevicesProvider>,
  );

describe('Device Management Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('loads and displays devices from the control plane', async () => {
    vi.mocked(getDevices).mockResolvedValue([
      device(),
      device({ id: 'cp_dev_2', name: 'iPhone 15', platform: 'ios' }),
    ]);

    renderList();
    expect(screen.getByText(/Loading devices.../i)).toBeDefined();

    await waitFor(() => {
      expect(screen.getByText(/MacBook Pro/i)).toBeDefined();
    });
    expect(screen.getByText(/iPhone 15/i)).toBeDefined();
  });

  it('pauses a device through PATCH rather than local state', async () => {
    vi.mocked(getDevices).mockResolvedValue([device()]);
    vi.mocked(setDeviceSync).mockResolvedValue(device({ syncEnabled: false }));

    renderList();
    await waitFor(() => expect(screen.getByText(/MacBook Pro/i)).toBeDefined());

    screen.getByRole('button', { name: /^Pause$/i }).click();

    await waitFor(() => {
      expect(setDeviceSync).toHaveBeenCalledWith('cp_dev_01h2xcejqtf2nbrexx3vqjhp41', false);
    });
    // The row now reflects the server's copy and offers the inverse action.
    await waitFor(() => expect(screen.getByRole('button', { name: /^Resume$/i })).toBeDefined());
  });

  it('names the device in the revoke confirmation', async () => {
    vi.mocked(getDevices).mockResolvedValue([device()]);
    vi.mocked(revokeDevice).mockResolvedValue(device({ revoked: true }));

    const confirmSpy = vi.fn<(message?: string) => boolean>(() => true);
    vi.stubGlobal('confirm', confirmSpy);

    renderList();
    await waitFor(() => expect(screen.getByText(/MacBook Pro/i)).toBeDefined());

    screen.getByRole('button', { name: /Revoke/i }).click();

    await waitFor(() => expect(revokeDevice).toHaveBeenCalled());
    expect(confirmSpy.mock.calls[0][0]).toContain('MacBook Pro');
    await waitFor(() => expect(screen.queryByText(/MacBook Pro/i)).toBeNull());
  });

  it('does not revoke when the confirmation is declined', async () => {
    vi.mocked(getDevices).mockResolvedValue([device()]);
    vi.stubGlobal('confirm', () => false);

    renderList();
    await waitFor(() => expect(screen.getByText(/MacBook Pro/i)).toBeDefined());

    screen.getByRole('button', { name: /Revoke/i }).click();
    expect(revokeDevice).not.toHaveBeenCalled();
  });

  it('mints a pairing code instead of registering a device from the browser', async () => {
    vi.mocked(getDevices).mockResolvedValue([]);
    vi.mocked(createPairingCode).mockResolvedValue({
      code: 'K7M2QX9P',
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      expiresInSeconds: 300,
    });

    renderList();
    await waitFor(() => expect(screen.getByText(/No devices registered/i)).toBeDefined());

    screen.getByRole('button', { name: /Pair Device/i }).click();

    await waitFor(() => expect(screen.getByText('K7M2QX9P')).toBeDefined());
    expect(createPairingCode).toHaveBeenCalledTimes(1);
  });

  it('surfaces a load failure instead of rendering an empty list', async () => {
    vi.mocked(getDevices).mockRejectedValue(new Error('boom'));

    renderList();

    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect(screen.queryByText(/No devices registered/i)).toBeNull();
  });
});
