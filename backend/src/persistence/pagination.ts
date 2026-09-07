/**
 * Keyset pagination cursors.
 *
 * Opaque to clients and never offset-based: an offset shifts when rows are inserted or revoked,
 * so a client paging through devices could miss one entirely. A `(createdAt, id)` keyset is stable
 * under concurrent writes.
 */
export interface CursorPosition {
  createdAt: Date;
  id: string;
}

export function encodeCursor(position: CursorPosition): string {
  return Buffer.from(`${position.createdAt.toISOString()}|${position.id}`, 'utf8').toString('base64url');
}

/**
 * Decodes a cursor, returning null for anything malformed.
 *
 * Cursors are client input and therefore untrusted. A bad cursor must degrade to "start from the
 * beginning", never throw a 500 and never reach a query — the id half interpolates into a
 * comparison, so a malformed value is exactly the sort of thing that must not get through.
 */
export function decodeCursor(cursor: string | undefined): CursorPosition | null {
  if (!cursor) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const separator = decoded.lastIndexOf('|');
  if (separator <= 0) return null;

  const createdAt = new Date(decoded.slice(0, separator));
  const id = decoded.slice(separator + 1);
  if (Number.isNaN(createdAt.getTime())) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;

  return { createdAt, id };
}

/** Fetches `limit + 1` to detect a further page without a second count query. */
export function buildPage<T>(
  rows: T[],
  limit: number,
  toCursor: (row: T) => string,
): { data: T[]; nextCursor: string | null } {
  if (rows.length <= limit) return { data: rows, nextCursor: null };
  const data = rows.slice(0, limit);
  return { data, nextCursor: toCursor(data[data.length - 1]) };
}
