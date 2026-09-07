import type { Device } from './types';

// Mocked device list
let mockDevices: Device[] = [
  {
    id: 'dev_1',
    name: 'MacBook Pro',
    platform: 'macos',
    appVersion: '1.0.0',
    protocolVersion: 1,
    publicKey: 'fake_pub_key_1',
    keyFingerprint: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    capabilities: { contentTypes: ['text/plain'], maxPayloadBytes: 1024 },
    syncEnabled: true,
    revoked: false,
    revokedAt: null,
    lastSeenAt: new Date().toISOString(),
    createdAt: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: 'dev_2',
    name: 'iPhone 15',
    platform: 'ios',
    appVersion: '1.0.0',
    protocolVersion: 1,
    publicKey: 'fake_pub_key_2',
    keyFingerprint: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
    capabilities: { contentTypes: ['text/plain', 'image/png'], maxPayloadBytes: 2048 },
    syncEnabled: true,
    revoked: false,
    revokedAt: null,
    lastSeenAt: new Date().toISOString(),
    createdAt: new Date(Date.now() - 43200000).toISOString(),
  }
];

export async function getDevices(): Promise<Device[]> {
  await new Promise((resolve) => setTimeout(resolve, 400));
  return [...mockDevices].filter(d => !d.revoked);
}

export async function revokeDevice(id: string): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 300));
  mockDevices = mockDevices.map(d => 
    d.id === id ? { ...d, revoked: true, revokedAt: new Date().toISOString() } : d
  );
}

export async function registerDevice(): Promise<Device> {
  await new Promise((resolve) => setTimeout(resolve, 600));
  const newDevice: Device = {
    id: `dev_${Date.now()}`,
    name: 'New Registered Device',
    platform: 'web',
    appVersion: '1.0.0',
    protocolVersion: 1,
    publicKey: 'fake_pub_key_new',
    keyFingerprint: 'sha256:3333333333333333333333333333333333333333333333333333333333333333',
    capabilities: { contentTypes: ['text/plain'], maxPayloadBytes: 1024 },
    syncEnabled: true,
    revoked: false,
    revokedAt: null,
    lastSeenAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
  mockDevices.push(newDevice);
  return newDevice;
}
