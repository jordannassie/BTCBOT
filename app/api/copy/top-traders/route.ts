import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ─── Supabase (service role — read-only selects only) ─────────────────────────

function getServiceClient() {
  let url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (url.startsWith('$')) url = '';
  if (!url.startsWith('http') || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// ── GET /api/copy/top-traders ────────────────────────────────────────────────
// Read-only. Joins tracked_wallets + wallet_metrics.
// Sorted: copy_score DESC → pnl_30d DESC → recent_closed_count DESC.
// No writes, no mutations, no trading execution.

export async function GET() {
  const client = getServiceClient();
  if (!client) {
    return NextResponse.json(
      { ok: false, error: 'Supabase credentials missing' },
      { status: 500 }
    );
  }

  try {
    const [walletsRes, metricsRes] = await Promise.all([
      client
        .from('tracked_wallets')
        .select('id, wallet_address, display_name, tags, is_active'),
      client
        .from('wallet_metrics')
        .select(
          'wallet_address, copy_score, wallet_class, pnl_7d, pnl_30d, win_rate, trade_count, volume, avg_hold_minutes, median_hold_minutes, pct_under_15min, pct_under_30min, recent_closed_count, max_drawdown, category_focus, last_trade_at, updated_at'
        ),
    ]);

    if (walletsRes.error) {
      return NextResponse.json(
        { ok: false, error: walletsRes.error.message },
        { status: 500 }
      );
    }

    const metricsMap = new Map(
      (metricsRes.data ?? []).map((m) => [m.wallet_address, m])
    );

    const rows = (walletsRes.data ?? []).map((w) => {
      const m = metricsMap.get(w.wallet_address) ?? null;
      return {
        tracked_wallet_id:   w.id,
        wallet_address:      w.wallet_address,
        display_name:        w.display_name         ?? null,
        tags:                w.tags                 ?? [],
        is_active:           w.is_active            ?? false,
        copy_score:          m?.copy_score          ?? null,
        wallet_class:        m?.wallet_class        ?? null,
        pnl_7d:              m?.pnl_7d              ?? null,
        pnl_30d:             m?.pnl_30d             ?? null,
        win_rate:            m?.win_rate            ?? null,
        trade_count:         m?.trade_count         ?? null,
        volume:              m?.volume              ?? null,
        avg_hold_minutes:    m?.avg_hold_minutes    ?? null,
        median_hold_minutes: m?.median_hold_minutes ?? null,
        pct_under_15min:     m?.pct_under_15min     ?? null,
        pct_under_30min:     m?.pct_under_30min     ?? null,
        recent_closed_count: m?.recent_closed_count ?? null,
        max_drawdown:        m?.max_drawdown        ?? null,
        category_focus:      m?.category_focus      ?? null,
        last_trade_at:       m?.last_trade_at       ?? null,
        updated_at:          m?.updated_at          ?? null,
      };
    });

    // Sort: copy_score DESC → pnl_30d DESC → recent_closed_count DESC
    rows.sort((a, b) => {
      const scoreA = a.copy_score ?? -Infinity;
      const scoreB = b.copy_score ?? -Infinity;
      if (scoreB !== scoreA) return scoreB - scoreA;

      const pnlA = a.pnl_30d ?? -Infinity;
      const pnlB = b.pnl_30d ?? -Infinity;
      if (pnlB !== pnlA) return pnlB - pnlA;

      return (b.recent_closed_count ?? 0) - (a.recent_closed_count ?? 0);
    });

    return NextResponse.json({ ok: true, rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
