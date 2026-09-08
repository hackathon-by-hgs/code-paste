/** Timestamp formatting shared by the device and sharing panels. */

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Whole seconds from now until `iso`, floored at zero. */
export const secondsUntil = (iso: string, now: number = Date.now()): number => {
  const delta = Math.floor((Date.parse(iso) - now) / 1000);
  return delta > 0 ? delta : 0;
};

/** `m:ss`, for a countdown that a user is actively watching. */
export const formatCountdown = (totalSeconds: number): string => {
  const minutes = Math.floor(totalSeconds / MINUTE);
  const seconds = totalSeconds % MINUTE;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

/** Coarse "how long ago", for a last-seen column. */
export const relativeTime = (iso: string | null | undefined, now: number = Date.now()): string => {
  if (!iso) return 'never';

  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return 'unknown';

  const seconds = Math.floor((now - parsed) / 1000);
  if (seconds < 0) return 'just now';
  if (seconds < MINUTE) return 'just now';
  if (seconds < HOUR) return `${Math.floor(seconds / MINUTE)}m ago`;
  if (seconds < DAY) return `${Math.floor(seconds / HOUR)}h ago`;
  return `${Math.floor(seconds / DAY)}d ago`;
};
