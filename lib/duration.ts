// Call duration helpers — shared by the room timer and the admin list.
// All formatting is pure and unit-testable; the ticking itself lives in
// the components (a 1s client interval, no extra fetches).

/** The instant a call started ticking: started_at, or created_at before
 *  the column existed / for calls that started before it was recorded. */
export function callStartMs(call: {
  started_at?: string | null;
  created_at: string;
}): number | null {
  const base = call.started_at ?? call.created_at;
  const ms = new Date(base).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** Elapsed milliseconds between two instants, clamped at 0. */
export function elapsedMs(fromMs: number | null, toMs: number): number {
  if (fromMs === null) return 0;
  return Math.max(0, toMs - fromMs);
}

/** HH:MM:SS — the live ticking timer format (hours grow past 24). */
export function formatHMS(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** Compact final duration for ended calls: "1h 23m", "45m 12s", "38s". */
export function formatCompact(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
