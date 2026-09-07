export interface User {
  id: string;
  email: string;
  createdAt: string;
}

export interface Device {
  id: string;
  name: string;
  platform: 'macos' | 'windows' | 'linux' | 'ios' | 'android' | 'web';
  appVersion: string;
  protocolVersion: number;
  publicKey: string;
  keyFingerprint: string;
  capabilities: {
    contentTypes: string[];
    maxPayloadBytes: number;
  };
  syncEnabled: boolean;
  revoked: boolean;
  revokedAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
}

export interface ShareMember {
  userId: string;
  email: string;
  role: 'owner' | 'member';
  joinedAt: string;
  revoked: boolean;
  revokedAt: string | null;
}

export interface ShareSession {
  id: string;
  ownerUserId: string;
  status: 'active' | 'expired' | 'revoked';
  expiresAt: string;
  createdAt: string;
  members: ShareMember[];
}
