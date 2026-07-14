/** Small formatting helpers shared by the views. All pure. */

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});
const TIME_FORMAT = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'UTC',
});

/** e.g. "Jun 1 · 8:00 AM" — fixed UTC so the demo reads identically everywhere. */
export function formatSessionDate(startedAtMs: number): string {
  const date = new Date(startedAtMs);
  return `${DATE_FORMAT.format(date)} · ${TIME_FORMAT.format(date)}`;
}

/** e.g. 90_000 → "1:30"; 45_000 → "0:45". */
export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Elapsed capture timer, e.g. 1_122_000 → "18:42". */
export function formatElapsed(elapsedMs: number): string {
  return formatDuration(elapsedMs);
}
