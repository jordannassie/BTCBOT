// GET /api/copy/hot-wallets
//
// Returns wallet_metrics rows for wallets NOT yet in tracked_wallets,
// enriched with a computed `hot_score` that ranks fast-turnover copy suitability.
//
// Hot score factors (all server-side, based on existing wallet_metrics columns):
//   copy_score        — base score from Worker analysis (0–100)
//   avg_hold_minutes  — lower = faster exits = copy-friendly
//   pnl_30d           — positive recent PnL adds confidence
//   win_rate          — accuracy bonus
//   last_trade_at     — recency bonus for active wallets
//   trade_count       — volume of evidence
//
// The ignore list is stored client-side in localStorage (no DB needed).

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_CACHE = { 'Cache-Control': 'no-store, max-age=0' };

function getServiceClient() {
  let url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (url.startsWith('$')) url = '';
  if (!url.startsWith('http') || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

type MetricsRow = {
  wallet_address: string;
  copy_score: number | null;
  pnl_7d: number | null;
  pnl_30d: number | null;
  pnl_all: number | null;
  win_rate: number | null;
  trade_count: number | null;
  volume: number | null;
  avg_hold_minutes: number | null;
  max_drawdown: number | null;
  category_focus: string | null;
  last_trade_at: string | null;
  updated_at: string | null;
};

// Compute a 0–100 hot score optimised for fast-turnover copy trading.
// Starts from the Worker's copy_score and applies bonuses for traits
// that make a wallet especially suitable for quick copy positions.
function computeHotScore(m: MetricsRow): number {
  // Base: Worker's composite copy score (already 0–100)
  let score = m.copy_score ?? 50;

  // Speed bonus — fast exits mean less slippage exposure and easier position management.
  //   < 30 min  → +15   (scalper-tier)
  //   < 2 h     → +10
  //   < 6 h     → +5
  //   ≥ 6 h     → no bonus (but no penalty — long-hold wallets just rank lower)
  if (m.avg_hold_minutes != null) {
    if      (m.avg_hold_minutes < 30)  score += 15;
    else if (m.avg_hold_minutes < 120) score += 10;
    else if (m.avg_hold_minutes < 360) score += 5;
  }

  // Win rate bonus (high accuracy above 55% is meaningful signal)
  if (m.win_rate != null) {
    if      (m.win_rate >= 0.65) score += 8;
    else if (m.win_rate >= 0.55) score += 4;
  }

  // Recent profitable 30d PnL adds confidence (cap bonus at 8 pts)
  if (m.pnl_30d != null && m.pnl_30d > 0) {
    score += Math.min(8, m.pnl_30d / 500);
  }

  // Recency bonus — active recently means the strategy is still live.
  if (m.last_trade_at) {
    const hoursSince = (Date.now() - new Date(m.last_trade_at).getTime()) / 3_600_000;
    if      (hoursSince < 24)  score += 8;
    else if (hoursSince < 72)  score += 4;
    else if (hoursSince < 168) score += 2;
  }

  // Evidence bonus — more trades = more reliable signal (cap at 5 pts)
  if (m.trade_count != null && m.trade_count > 0) {
    score += Math.min(5, Math.log10(m.trade_count) * 2);
  }

  return Math.max(0, Math.min(100, score));
}

export async function GET() {
  const client = getServiceClient();
  if (!client) {
    return NextResponse.json(
      { ok: false, error: 'Supabase credentials missing' },
      { status: 500, headers: NO_CACHE }
    );
  }

  try {
    const [metricsRes, trackedRes] = await Promise.all([
      client.from('wallet_metrics').select('*'),
      client.from('tracked_wallets').select('wallet_address'),
    ]);

    if (metricsRes.error) {
      return NextResponse.json(
        { ok: false, error: metricsRes.error.message },
        { status: 500, headers: NO_CACHE }
      );
    }

    // Build set of already-tracked addresses for O(1) lookup
    const trackedSet = new Set(
      (trackedRes.data ?? []).map((r: { wallet_address: string }) => r.wallet_address)
    );

    // Filter to untracked wallets and compute hot score
    const candidates = (metricsRes.data as MetricsRow[] ?? [])
      .filter((m) => !trackedSet.has(m.wallet_address))
      .map((m) => ({ ...m, hot_score: computeHotScore(m) }))
      .sort((a, b) => b.hot_score - a.hot_score);

    return NextResponse.json({ ok: true, rows: candidates }, { headers: NO_CACHE });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500, headers: NO_CACHE });
  }
}
