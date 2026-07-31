// GET /api/btc-5m-market
//
// Read-only snapshot of the active BTC 5-minute market.
//
// Primary data source — bot_settings.strategy_settings where bot_id = 'btc_5m_late':
//   FastLoop writes a fresh status snapshot here every ~30 seconds, including:
//     market_slug, market_url, market_start, market_end, seconds_remaining,
//     price_to_beat, reference_price, distance_usd, leading_side,
//     up_ask, down_ask, signal, last_decision, today_* stats, updated_at.
//
// Secondary source — market_cache:
//   yes_token_id (UP token ID), no_token_id (DOWN token ID).
//   Populated from trade data; may be absent for brand-new markets.
//
// Derived on server:
//   • stale_tier: 'fresh' | 'delayed' | 'stale'   (based on updated_at age)
//   • expired:    true if market_end is in the past
//   • ready:      slug exists, not expired, both token IDs present
//
// Never writes to the database.
// Never exposes private keys, wallet credentials, or secrets.
// Always executed fresh — no server-side caching.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic   = 'force-dynamic';
export const revalidate = 0;

const NO_CACHE      = { 'Cache-Control': 'no-store, max-age=0' };
const LATE_BOT_ID   = 'btc_5m_late';

// Staleness tiers (seconds since updated_at)
const FRESH_MAX   =  45;   // 0–45s   → FRESH
const DELAYED_MAX = 120;   // 46–120s → DELAYED
                            // >120s   → STALE

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
  const parts   = slug.split('-');
  const last    = parts[parts.length - 1];
  const startTs = parseInt(last, 10);
  if (!Number.isFinite(startTs) || startTs < 1_000_000_000) return null;
  const intervalSec = slug.includes('-15m') ? 900 : 300; // default 5-min
  return { startTs, intervalSec };
}

function staleTier(updatedAt: string | null): 'fresh' | 'delayed' | 'stale' | 'unknown' {
  if (!updatedAt) return 'unknown';
  const ageMs  = Date.now() - new Date(updatedAt).getTime();
  const ageSec = ageMs / 1000;
  if (ageSec <= FRESH_MAX)   return 'fresh';
  if (ageSec <= DELAYED_MAX) return 'delayed';
  return 'stale';
}

export async function GET() {
  const client = getClient();
  if (!client) {
    return NextResponse.json({ ok: false, error: 'Supabase credentials missing' }, { status: 500, headers: NO_CACHE });
  }

  const serverTime = new Date().toISOString();

  try {
    // ── 1. Read the current market snapshot from btc_5m_late.strategy_settings ──
    //    FastLoop writes this row every ~30 s with all live market fields.
    const { data: settRow, error: settErr } = await client
      .from('bot_settings')
      .select('is_enabled, mode, arm_live, trade_size_usd, strategy_settings')
      .eq('bot_id', LATE_BOT_ID)
      .maybeSingle();

    if (settErr) {
      return NextResponse.json({ ok: false, error: settErr.message, server_time: serverTime }, { status: 500, headers: NO_CACHE });
    }

    const ss         = (settRow?.strategy_settings ?? {}) as Record<string, unknown>;
    const marketSlug = typeof ss.market_slug === 'string' && ss.market_slug ? ss.market_slug : null;
    const updatedAt  = typeof ss.updated_at  === 'string' ? ss.updated_at  : null;

    // ── No slug yet — strategy hasn't run its first tick ─────────────────────
    if (!marketSlug) {
      return NextResponse.json({
        ok:            true,
        ready:         false,
        reason:        'MARKET_DATA_NOT_READY',
        // bot row fields
        is_enabled:    settRow?.is_enabled    ?? false,
        mode:          settRow?.mode          ?? 'PAPER',
        arm_live:      settRow?.arm_live      ?? false,
        trade_size_usd: settRow?.trade_size_usd ?? 1,
        // market fields — all null
        market_slug:       null,
        market_url:        null,
        market_start:      null,
        market_end:        null,
        seconds_remaining: null,
        price_to_beat:     null,
        reference_price:   null,
        distance_usd:      null,
        leading_side:      null,
        up_ask:            null,
        down_ask:          null,
        signal:            null,
        last_decision:     null,
        last_decision_reason: null,
        current_position:  null,
        today_trade_count: null,
        today_wins:        null,
        today_losses:      null,
        today_pnl:         null,
        up_token_id:       null,
        down_token_id:     null,
        updated_at:        null,
        stale_tier:        'unknown',
        stale:             false,
        expired:           false,
        server_time:       serverTime,
      }, { headers: NO_CACHE });
    }

    // ── 2. Use FastLoop-supplied timing fields where available ────────────────
    //    Fall back to slug-parsing when FastLoop fields are absent.
    const nowSec    = Math.floor(Date.now() / 1000);

    // FastLoop writes market_start / market_end as unix-second integers
    const flStart   = typeof ss.market_start === 'number' ? ss.market_start : null;
    const flEnd     = typeof ss.market_end   === 'number' ? ss.market_end   : null;
    const flSecsLeft = typeof ss.seconds_remaining === 'number' ? ss.seconds_remaining : null;

    // Fall back to slug parsing if FastLoop hasn't written timing yet
    const parsed    = parseSlug(marketSlug);
    const startTs   = flStart  ?? parsed?.startTs ?? null;
    const endTs     = flEnd    ?? (parsed ? parsed.startTs + parsed.intervalSec : null);
    const secsLeft  = flSecsLeft ?? (endTs != null ? endTs - nowSec : null);
    const expired   = endTs != null ? nowSec >= endTs : false;

    // ── 3. Staleness tier ─────────────────────────────────────────────────────
    const tier = staleTier(updatedAt);
    const stale = tier === 'stale';

    // ── 4. Token IDs from market_cache ────────────────────────────────────────
    const { data: cacheRow } = await client
      .from('market_cache')
      .select('yes_token_id, no_token_id')
      .eq('market_slug', marketSlug)
      .maybeSingle();

    const upTokenId   = typeof cacheRow?.yes_token_id === 'string' ? cacheRow.yes_token_id : null;
    const downTokenId = typeof cacheRow?.no_token_id  === 'string' ? cacheRow.no_token_id  : null;

    // ── 5. Market URL — prefer FastLoop-supplied, fall back to computed ───────
    const marketUrl = typeof ss.market_url === 'string' && ss.market_url
      ? ss.market_url
      : `https://polymarket.com/event/${encodeURIComponent(marketSlug)}`;

    // ── 6. Readiness ──────────────────────────────────────────────────────────
    const ready = Boolean(
      marketSlug && !expired && upTokenId && downTokenId && secsLeft != null && secsLeft > 0
    );

    const reason = !marketSlug         ? 'MARKET_DATA_NOT_READY'
                 : expired             ? 'MARKET_EXPIRED'
                 : stale               ? 'STALE_MARKET_DATA'
                 : tier === 'delayed'  ? 'DELAYED_MARKET_DATA'
                 : (!upTokenId || !downTokenId) ? 'TOKENS_NOT_YET_CACHED'
                 : 'READY';

    return NextResponse.json({
      ok:   true,
      ready,
      reason,

      // Bot row
      is_enabled:    settRow?.is_enabled    ?? false,
      mode:          settRow?.mode          ?? 'PAPER',
      arm_live:      settRow?.arm_live      ?? false,
      trade_size_usd: settRow?.trade_size_usd ?? 1,

      // Market identification
      market_slug: marketSlug,
      market_url:    marketUrl,

      // Timing
      market_start:      startTs ? new Date(startTs * 1000).toISOString() : null,
      market_end:        endTs   ? new Date(endTs   * 1000).toISOString() : null,
      seconds_remaining: secsLeft,

      // Rich market fields from FastLoop
      price_to_beat:       ss.price_to_beat       ?? null,
      reference_price:     ss.reference_price      ?? null,
      distance_usd:        ss.distance_usd         ?? null,
      leading_side:        ss.leading_side         ?? null,
      up_ask:              ss.up_ask               ?? null,
      down_ask:            ss.down_ask             ?? null,
      signal:              ss.signal               ?? null,
      last_decision:       ss.last_decision        ?? null,
      last_decision_reason: ss.last_decision_reason ?? null,
      current_position:    ss.current_position     ?? null,
      today_trade_count:   ss.today_trade_count    ?? null,
      today_wins:          ss.today_wins           ?? null,
      today_losses:        ss.today_losses         ?? null,
      today_pnl:           ss.today_pnl            ?? null,

      // Token IDs (from market_cache)
      up_token_id:   upTokenId,
      down_token_id: downTokenId,

      // Freshness
      updated_at: updatedAt,
      stale_tier: tier,
      stale,
      expired,

      server_time: serverTime,
    }, { headers: NO_CACHE });

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message, server_time: serverTime }, { status: 500, headers: NO_CACHE });
  }
}
