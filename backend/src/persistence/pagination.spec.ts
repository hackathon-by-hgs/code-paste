import { buildPage, decodeCursor, encodeCursor } from './pagination';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('pagination cursors', () => {
  it('round-trips a position', () => {
    const position = { createdAt: new Date('2026-01-01T00:00:00.000Z'), id: UUID };
    const decoded = decodeCursor(encodeCursor(position));

    expect(decoded).not.toBeNull();
    expect(decoded!.createdAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(decoded!.id).toBe(UUID);
  });

  it('is opaque to the client', () => {
    const cursor = encodeCursor({ createdAt: new Date('2026-01-01T00:00:00.000Z'), id: UUID });
    expect(cursor).not.toContain('2026');
    expect(cursor).not.toContain(UUID);
  });

  it('returns null for malformed input rather than throwing', () => {
    // Cursors are untrusted client input. The id half is interpolated into a comparison, so a
    // malformed value must never reach a query — and must degrade to "start from the beginning"
    // rather than producing a 500.
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor('')).toBeNull();
    expect(decodeCursor('not-base64!!')).toBeNull();
    expect(decodeCursor(Buffer.from('no-separator').toString('base64url'))).toBeNull();
    expect(decodeCursor(Buffer.from('not-a-date|' + UUID).toString('base64url'))).toBeNull();
    expect(decodeCursor(Buffer.from('2026-01-01T00:00:00.000Z|not-a-uuid').toString('base64url'))).toBeNull();
  });

  it('rejects a cursor carrying a SQL fragment as its id', () => {
    const injected = Buffer.from("2026-01-01T00:00:00.000Z|') OR 1=1 --").toString('base64url');
    expect(decodeCursor(injected)).toBeNull();
  });

  describe('buildPage', () => {
    const toCursor = (row: { id: string }) => `cursor-${row.id}`;

    it('returns no cursor when the page is not full', () => {
      const rows = [{ id: 'a' }, { id: 'b' }];
      expect(buildPage(rows, 5, toCursor)).toEqual({ data: rows, nextCursor: null });
    });

    it('returns no cursor when the result exactly fills the page', () => {
      const rows = [{ id: 'a' }, { id: 'b' }];
      expect(buildPage(rows, 2, toCursor)).toEqual({ data: rows, nextCursor: null });
    });

    it('trims the sentinel row and emits a cursor when there is more', () => {
      // The repository fetches limit + 1 so "is there another page?" needs no second count query.
      const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
      expect(buildPage(rows, 2, toCursor)).toEqual({
        data: [{ id: 'a' }, { id: 'b' }],
        nextCursor: 'cursor-b',
      });
    });

    it('handles an empty result', () => {
      expect(buildPage([], 10, toCursor)).toEqual({ data: [], nextCursor: null });
    });
  });
});
