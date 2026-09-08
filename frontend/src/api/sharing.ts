/**
 * Explicit, temporary sharing.
 *
 * Two asymmetries the UI has to respect:
 *   - `joinCode` exists only in the creation response. It is stored as a hash and
 *     can never be fetched again; a user who loses it creates a new session.
 *   - An owner cannot leave their own session — they expire it instead.
 */

import { request, requestVoid } from '../lib/http';
import type {
  SessionId,
  SessionStatus,
  ShareSession,
  ShareSessionList,
  ShareSessionWithJoinCode,
  UserId,
} from './types';

export interface ListSessionsOptions {
  limit?: number;
  cursor?: string;
  status?: SessionStatus;
}

export const listSessions = (options: ListSessionsOptions = {}): Promise<ShareSessionList> =>
  request<ShareSessionList>('/share-sessions', {
    query: { limit: options.limit, cursor: options.cursor, status: options.status },
  });

/** Every session with the given status, following the cursor to exhaustion. */
export const getSessions = async (status?: SessionStatus): Promise<ShareSession[]> => {
  const all: ShareSession[] = [];
  let cursor: string | undefined;
  const MAX_PAGES = 20;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await listSessions({ cursor, status, limit: 100 });
    all.push(...result.data);
    if (!result.nextCursor) break;
    cursor = result.nextCursor;
  }

  return all;
};

/**
 * The caller's current active session, or null.
 *
 * The contract permits several; the UI presents one at a time, so this picks the
 * newest and lets the rest expire on their own.
 */
export const getActiveSession = async (): Promise<ShareSession | null> => {
  const sessions = await getSessions('active');
  if (sessions.length === 0) return null;
  return sessions.reduce((newest, candidate) =>
    Date.parse(candidate.createdAt) > Date.parse(newest.createdAt) ? candidate : newest,
  );
};

/** Full session including members — the "who can receive my clipboard data" view. */
export const getSession = (id: SessionId): Promise<ShareSession> =>
  request<ShareSession>(`/share-sessions/${id}`);

/**
 * Creates a session. `expiresInSeconds` is capped server-side (60–86400); the
 * cap is enforced there, not in the UI, so a longer request is simply clamped.
 */
export const createSession = (expiresInSeconds = 3600): Promise<ShareSessionWithJoinCode> =>
  request<ShareSessionWithJoinCode>('/share-sessions', {
    method: 'POST',
    body: { expiresInSeconds },
  });

/**
 * Joins a session. Idempotent for an existing member.
 *
 * Both arguments are required by the contract: the code alone does not identify
 * a session. `403 forbidden` covers both a wrong code and a revoked membership —
 * a revoked member cannot rejoin.
 */
export const joinSession = (id: SessionId, joinCode: string): Promise<ShareSession> =>
  request<ShareSession>(`/share-sessions/${id}/join`, {
    method: 'POST',
    body: { joinCode },
  });

/** Leave a session. `403 forbidden` if you are the owner — expire it instead. */
export const leaveSession = (id: SessionId): Promise<void> =>
  requestVoid(`/share-sessions/${id}/leave`, { method: 'POST' });

/** Owner only. The revoked member drops out of every affected roster. */
export const revokeMember = (id: SessionId, userId: UserId): Promise<ShareSession> =>
  request<ShareSession>(`/share-sessions/${id}/revoke-member`, {
    method: 'POST',
    body: { userId },
  });

/** Owner only. The "stop sharing" button. Idempotent. */
export const expireSession = (id: SessionId): Promise<ShareSession> =>
  request<ShareSession>(`/share-sessions/${id}/expire`, { method: 'POST' });
