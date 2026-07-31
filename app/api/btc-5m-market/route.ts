// GET /api/btc-5m-market
//
// Read-only snapshot of the active BTC 5-minute market.
//
// Data sources (both read-only):
//   • bot_settings.strategy_settings where bot_id = 'btc_5m_ema'
//       → market_slug, updated_at  (FastLoop writes every tick)
//   • market_cache where market_slug = <current slug>
//       → yes_token_id (UP), no_token_id (DOWN)
//         (populated from trade data; may be absent for brand-new markets)
//
// Derived fields (computed server-side from the slug suffix):
//   • market_start     — unix timestamp embedded in the slug
//   • market_end       — market_start + interval (300s for 5-min markets)
//   • seconds_remaining
//   • stale            — true if updated_at is >30 s old
//   • expired          — true if market_end is in the past
//
// Never writes to the database.
// Never exposes private keys, wallet credentials, or secrets.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic   = 'force-dynamic';
export const revalidate = 0;

const NO_CACHE     = { 'Cache-Control': 'no-store, max-age=0' };
const EMA_BOT_ID   = 'btc_5m_ema';
const STALE_SECS   = 30;

function getClient() {
  let url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (url.startsWith('$')) url = '';
  if (!url.startsWith('http') || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// Parses the start-timestamp and interval from a BTC market slug.
// Slug format: <prefix>-<unix_seconds>   e.g. btc-updown-5m-1785500700
function parseSlug(slug: string): { startTs: number; intervalSec: number } | null {
  const parts = slug.split('-');
  const last  = parts[parts.length - 1];
  const startTs = parseInt(last, 10);
  if (!Number.isFinite(startTs) || startTs < 1_000_000_000) return null;

  // Derive interval from the slug prefix
  const intervalSec = slug.includes('-15m') ? 900
                    : slug.includes('-5m')  ? 300
                    : 300; // default to 5-min if unknown
  return { startTs, intervalSec };
}

export async function GET() {
  const client = getClient();
  if (!client) {
    return NextResponse.json({ ok: false, error: 'Supabase credentials missing' }, { status: 500, headers: NO_CACHE });
  }

  try {
    // ── 1. Read the current market slug from bot_settings telemetry ──────────
    const { data: settRow, error: settErr } = await client
      .from('bot_settings')
      .select('strategy_settings')
      .eq('bot_id', EMA_BOT_ID)
      .maybeSingle();

    if (settErr) {
      return NextResponse.json({ ok: false, error: settErr.message }, { status: 500, headers: NO_CACHE });
    }

    const ss         = (settRow?.strategy_settings ?? {}) as Record<string, unknown>;
    const marketSlug = typeof ss.market_slug === 'string' && ss.market_slug ? ss.market_slug : null;
    const updatedAt  = typeof ss.updated_at  === 'string' ? ss.updated_at  : null;

    if (!marketSlug) {
      return NextResponse.json({
        ok:             true,
        ready:          false,
        reason:         'MARKET_DATA_NOT_READY',
        market_slug:    null,
        up_token_id:    null,
        down_token_id:  null,
        market_start:   null,
        market_end:     null,
        seconds_remaining: null,
        updated_at:     null,
        stale:          false,
        expired:        false,
      }, { headers: NO_CACHE });
    }

    // ── 2. Derive timing from the slug ────────────────────────────────────────
    const nowSec    = Math.floor(Date.now() / 1000);
    const parsed    = parseSlug(marketSlug);
    const startTs   = parsed?.startTs   ?? null;
    const endTs     = parsed != null ? parsed.startTs + parsed.intervalSec : null;
    const secsLeft  = endTs != null ? endTs - nowSec : null;
    const expired   = endTs != null ? nowSec >= endTs : false;

    // ── 3. Stale check ────────────────────────────────────────────────────────
    const updatedMs    = updatedAt ? new Date(updatedAt).getTime() : null;
    const ageMs        = updatedMs != null ? Date.now() - updatedMs : null;
    const stale        = ageMs != null ? ageMs > STALE_SECS * 1000 : false;

    // ── 4. Token IDs from market_cache ────────────────────────────────────────
    // market_cache is populated from trade data via FastLoop's upsert_market_cache.
    // yes_token_id = UP token, no_token_id = DOWN token.
    const { data: cacheRow } = await client
      .from('market_cache')
      .select('yes_token_id, no_token_id')
      .eq('market_slug', marketSlug)
      .maybeSingle();

    const upTokenId   = typeof cacheRow?.yes_token_id === 'string' ? cacheRow.yes_token_id : null;
    const downTokenId = typeof cacheRow?.no_token_id  === 'string' ? cacheRow.no_token_id  : null;

    // ── 5. Readiness ──────────────────────────────────────────────────────────
    const ready = Boolean(
      marketSlug &&
      !expired &&
      upTokenId &&
      downTokenId &&
      secsLeft != null && secsLeft > 0
    );

    return NextResponse.json({
      ok:               true,
      ready,
      market_slug:      marketSlug,
      market_start:     startTs ? new Date(startTs * 1000).toISOString() : null,
      market_end:       endTs   ? new Date(endTs   * 1000).toISOString() : null,
      seconds_remaining: secsLeft,
      up_token_id:      upTokenId,
      down_token_id:    downTokenId,
      updated_at:       updatedAt,
      rotated_at:       updatedAt,   // best proxy available
      stale,
      expired,
      reason: !marketSlug          ? 'MARKET_DATA_NOT_READY'
            : stale                ? 'STALE_MARKET_DATA'
            : expired              ? 'MARKET_EXPIRED'
            : (!upTokenId || !downTokenId) ? 'TOKENS_NOT_YET_CACHED'
            : 'READY',
    }, { headers: NO_CACHE });

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500, headers: NO_CACHE });
  }
}
