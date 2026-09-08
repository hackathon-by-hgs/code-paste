import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SharingSession } from '../../src/components/SharingSession';
import type { ShareSession, User } from '../../src/api/types';

const OWNER: User = {
  id: 'cp_usr_01h2xcejqtf2nbrexx3vqjhp40',
  email: 'hello@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
};

let currentUser: User | null = OWNER;

vi.mock('../../src/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: currentUser,
    pending: false,
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
  }),
}));

vi.mock('../../src/api/sharing', () => ({
  getActiveSession: vi.fn(),
  createSession: vi.fn(),
  joinSession: vi.fn(),
  leaveSession: vi.fn(),
  expireSession: vi.fn(),
  revokeMember: vi.fn(),
}));

import {
  getActiveSession,
  createSession,
  expireSession,
  leaveSession,
} from '../../src/api/sharing';

const session = (over: Partial<ShareSession> = {}): ShareSession => ({
  id: 'cp_ses_01h2xcejqtf2nbrexx3vqjhp42',
  ownerUserId: OWNER.id,
  status: 'active',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  createdAt: new Date().toISOString(),
  members: [
    {
      userId: OWNER.id,
      email: OWNER.email,
      role: 'owner',
      joinedAt: new Date().toISOString(),
      revoked: false,
      revokedAt: null,
    },
  ],
  ...over,
});

describe('Sharing Session Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    currentUser = OWNER;
  });

  it('shows no session initially and can start sharing', async () => {
    vi.mocked(getActiveSession).mockResolvedValue(null);
    vi.mocked(createSession).mockResolvedValue({ ...session(), joinCode: 'R4TY8WQ2' });

    render(<SharingSession />);

    await waitFor(() => {
      expect(screen.getByText(/Not currently sharing with others./i)).toBeDefined();
    });

    screen.getByRole('button', { name: /Start Sharing/i }).click();

    await waitFor(() => {
      expect(screen.getByText(/Sharing active/i)).toBeDefined();
    });
    expect(screen.getByText(/hello@example.com/i)).toBeDefined();
  });

  it('shows the join code and session id once, since neither is retrievable later', async () => {
    vi.mocked(getActiveSession).mockResolvedValue(null);
    vi.mocked(createSession).mockResolvedValue({ ...session(), joinCode: 'R4TY8WQ2' });

    render(<SharingSession />);
    await waitFor(() => expect(screen.getByText(/Not currently sharing/i)).toBeDefined());

    screen.getByRole('button', { name: /Start Sharing/i }).click();

    await waitFor(() => expect(screen.getByText('R4TY8WQ2')).toBeDefined());
    expect(screen.getByText(/cp_ses_01h2xcejqtf2nbrexx3vqjhp42/)).toBeDefined();
  });

  it('resumes an existing active session on mount', async () => {
    vi.mocked(getActiveSession).mockResolvedValue(session());

    render(<SharingSession />);

    await waitFor(() => expect(screen.getByText(/Sharing active/i)).toBeDefined());
    // The code is never re-displayed for a session we did not just create.
    expect(screen.queryByText(/Join Code/i)).toBeNull();
  });

  it('expires the session when the owner stops sharing', async () => {
    vi.mocked(getActiveSession).mockResolvedValue(session());
    vi.mocked(expireSession).mockResolvedValue(session({ status: 'expired' }));
    vi.stubGlobal('confirm', () => true);

    render(<SharingSession />);
    await waitFor(() => expect(screen.getByText(/Sharing active/i)).toBeDefined());

    screen.getByRole('button', { name: /^Stop$/i }).click();

    await waitFor(() => expect(expireSession).toHaveBeenCalledWith(session().id));
    expect(leaveSession).not.toHaveBeenCalled();
  });

  it('leaves rather than expires when the caller is not the owner', async () => {
    currentUser = { ...OWNER, id: 'cp_usr_someone_else' };
    vi.mocked(getActiveSession).mockResolvedValue(session());
    vi.mocked(leaveSession).mockResolvedValue(undefined);
    vi.stubGlobal('confirm', () => true);

    render(<SharingSession />);
    await waitFor(() => expect(screen.getByText(/Sharing active/i)).toBeDefined());

    screen.getByRole('button', { name: /^Leave$/i }).click();

    await waitFor(() => expect(leaveSession).toHaveBeenCalledWith(session().id));
    expect(expireSession).not.toHaveBeenCalled();
  });

  it('hides member removal from non-owners', async () => {
    currentUser = { ...OWNER, id: 'cp_usr_someone_else' };
    vi.mocked(getActiveSession).mockResolvedValue(
      session({
        members: [
          ...session().members,
          {
            userId: 'cp_usr_third',
            email: 'third@example.com',
            role: 'member',
            joinedAt: new Date().toISOString(),
            revoked: false,
            revokedAt: null,
          },
        ],
      }),
    );

    render(<SharingSession />);
    await waitFor(() => expect(screen.getByText(/third@example.com/i)).toBeDefined());

    expect(screen.queryByRole('button', { name: /Remove/i })).toBeNull();
  });
});
