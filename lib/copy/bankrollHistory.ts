// Bankroll history stored in localStorage as a fixed-size ring buffer.
//
// Two independent series:
//   'live'  → btcbot-bankroll-live
//   'paper' → btcbot-bankroll-paper
//
// Sampling rules:
//   - A new point is only appended when at least MIN_INTERVAL_MS have elapsed
//     since the last recorded point. This prevents noise from rapid re-renders
//     while still capturing real balance changes.
//   - Old points beyond MAX_POINTS are dropped (oldest first).
//
// All functions are safe to call server-side — they return empty arrays /
// no-op silently when localStorage is unavailable.

export type BankrollPoint = { x: string; y: number };

export type BankrollKey = 'live' | 'paper';

const LS_KEYS: Record<BankrollKey, string> = {
  live:  'btcbot-bankroll-live',
  paper: 'btcbot-bankroll-paper',
};

const MAX_POINTS    = 50;
const MIN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes between samples

function isClient(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

export function getBankrollHistory(key: BankrollKey): BankrollPoint[] {
  if (!isClient()) return [];
  try {
    const raw = localStorage.getItem(LS_KEYS[key]);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as BankrollPoint[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Appends a new balance point if enough time has elapsed since the last one.
 * No-ops silently on SSR or invalid values.
 */
export function appendBankrollPoint(key: BankrollKey, value: number): void {
  if (!isClient() || !Number.isFinite(value)) return;
  try {
    const existing = getBankrollHistory(key);
    const now = Date.now();

    // Rate-limit: skip if last sample is too recent
    if (existing.length > 0) {
      const lastTs = new Date(existing[existing.length - 1].x).getTime();
      if (now - lastTs < MIN_INTERVAL_MS) return;
    }

    const next: BankrollPoint[] = [
      ...existing,
      { x: new Date(now).toISOString(), y: value },
    ].slice(-MAX_POINTS);

    localStorage.setItem(LS_KEYS[key], JSON.stringify(next));
  } catch {
    // localStorage quota exceeded or unavailable — silently ignore
  }
}

/**
 * Clears the stored history for a key.
 * Call this after a bankroll reset so the chart starts fresh from the new baseline.
 */
export function clearBankrollHistory(key: BankrollKey): void {
  if (!isClient()) return;
  try {
    localStorage.removeItem(LS_KEYS[key]);
  } catch {}
}

/**
 * Returns a human-readable time-span label for the stored series,
 * e.g. "~4h" or "~2d". Empty string if fewer than 2 points.
 */
export function bankrollSpanLabel(points: BankrollPoint[]): string {
  if (points.length < 2) return '';
  const ms = new Date(points[points.length - 1].x).getTime()
           - new Date(points[0].x).getTime();
  const hours = ms / (1000 * 60 * 60);
  if (hours < 1)  return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `~${Math.round(hours)}h`;
  return `~${Math.round(hours / 24)}d`;
}
