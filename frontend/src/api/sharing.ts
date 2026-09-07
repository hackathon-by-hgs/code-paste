import type { ShareSession, ShareMember } from './types';

// Mocked session state
let currentSession: ShareSession | null = null;

export async function getSession(): Promise<ShareSession | null> {
  await new Promise((resolve) => setTimeout(resolve, 300));
  return currentSession;
}

export async function createSession(): Promise<{ session: ShareSession, joinCode: string }> {
  await new Promise((resolve) => setTimeout(resolve, 600));
  
  currentSession = {
    id: `sess_${Date.now()}`,
    ownerUserId: 'user_123',
    status: 'active',
    expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    createdAt: new Date().toISOString(),
    members: [
      {
        userId: 'user_123',
        email: 'hello@example.com',
        role: 'owner',
        joinedAt: new Date().toISOString(),
        revoked: false,
        revokedAt: null
      }
    ]
  };
  
  return { session: currentSession, joinCode: 'A1B2C3D4' };
}

export async function joinSession(joinCode: string): Promise<ShareSession> {
  await new Promise((resolve) => setTimeout(resolve, 600));
  
  if (joinCode !== 'A1B2C3D4') {
    throw new Error('Invalid join code');
  }
  
  currentSession = {
    id: `sess_remote_${Date.now()}`,
    ownerUserId: 'user_456',
    status: 'active',
    expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    createdAt: new Date().toISOString(),
    members: [
      {
        userId: 'user_456',
        email: 'owner@example.com',
        role: 'owner',
        joinedAt: new Date().toISOString(),
        revoked: false,
        revokedAt: null
      },
      {
        userId: 'user_123',
        email: 'hello@example.com',
        role: 'member',
        joinedAt: new Date().toISOString(),
        revoked: false,
        revokedAt: null
      }
    ]
  };
  
  return currentSession;
}

export async function revokeMember(userId: string): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 300));
  
  if (currentSession) {
    currentSession.members = currentSession.members.map(m => 
      m.userId === userId ? { ...m, revoked: true, revokedAt: new Date().toISOString() } : m
    );
  }
}
