'use client';

// CryptoMarketCountdown — live client-side 5-minute market countdown.
//
// Works for BTC, ETH, SOL and XRP using one shared implementation.
//
// Timing source:
//   Reads market_end (unix seconds) from strategy_settings (FastLoop snapshot).
//   Falls back to slug parsing: slug suffix = market START unix ts; end = start + 300.
//   Counts down every second via setInterval — NO API request per second.
//   Resets automatically when market_slug changes.
//
// Staleness detection:
//   If strategy_settings.updated_at is > STALE_SEC ago → STALE warning.
//
// Rotation delay detection:
//   Derives expected 5-min bucket from current browser time.
//   If slug timestamp is behind the expected bucket by > GRACE_SEC → OLD MARKET warning.
//
// States:
//   NO_DATA      — no market_slug in strategy_settings
//   STALE        — snapshot too old
//   OLD_MARKET   — slug belongs to a previous 5-min bucket
//   ENDED        — remaining seconds reached 0
//   POSITION     — an open paper/live position exists (latestTrade.status === 'OPEN')
//   ACTIVE       — normal live countdown
//
// Usage modes:
//   display="card"  — full widget (slug, countdown, state, prices, button)
//   display="mini"  — only MM:SS + state colour (for sticky control center bar)

import { useEffect, useRef, useState } from 'react';
import type { RecentTrade } from './CryptoBotCard';

// ── Constants ─────────────────────────────────────────────────────────────────

const STALE_SEC        = 20;   // snapshot age → STALE
const OLD_GRACE_SEC    = 10;   // seconds into new bucket before flagging OLD MARKET
const MARKET_DURATION  = 300;  // 5-minute market = 300 seconds

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Parse market end timestamp (unix seconds) from strategy_settings or slug. */
function getEndTs(ss: Record<string, unknown>): number | null {
  // FastLoop writes market_end as a unix-second integer
  if (typeof ss.market_end === 'number' && ss.market_end > 1_000_000_000) {
    return ss.market_end;
  }
  // Fall back to slug parsing
  const slug = typeof ss.market_slug === 'string' ? ss.market_slug : null;
  if (!slug) return null;
  const parts   = slug.split('-');
  const startTs = parseInt(parts[parts.length - 1], 10);
  if (!Number.isFinite(startTs) || startTs < 1_000_000_000) return null;
  return startTs + MARKET_DURATION;
}

/** Format seconds as MM:SS. */
function fmtMmSs(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/** Extract unix-second start timestamp from a market slug. */
function slugStartTs(slug: string | null): number | null {
  if (!slug) return null;
  const parts = slug.split('-');
  const ts = parseInt(parts[parts.length - 1], 10);
  return Number.isFinite(ts) && ts > 1_000_000_000 ? ts : null;
}

/** Current expected 5-min bucket start (unix seconds, browser clock). */
function expectedBucket(): number {
  return Math.floor(Date.now() / 1000 / MARKET_DURATION) * MARKET_DURATION;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type DisplayMode = 'card' | 'mini';

type MarketState =
  | 'NO_DATA'
  | 'STALE'
  | 'OLD_MARKET'
  | 'ENDED'
  | 'POSITION'
  | 'ACTIVE';

type Props = {
  strategySettings: Record<string, unknown>;
  latestTrade:      RecentTrade | null;
  hasOpenPos:       boolean;
  mode:             string;            // 'PAPER' | 'LIVE'
  accentColor:      string;
  asset:            string;
  marketUrl:        string | null;
  display?:         DisplayMode;      // 'card' (default) | 'mini'
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function CryptoMarketCountdown({
  strategySettings: ss,
  latestTrade,
  hasOpenPos,
  mode,
  accentColor,
  asset,
  marketUrl,
  display = 'card',
}: Props) {
  const [secsLeft, setSecsLeft]       = useState<number | null>(null);
  const [staleSec,  setStaleSec]      = useState<number>(0);
  const endTsRef                      = useRef<number | null>(null);
  const slugRef                       = useRef<string | null>(null);

  // Snapshot timestamp from FastLoop
  const updatedAtStr: string | null = typeof ss.updated_at === 'string' ? ss.updated_at : null;
  const mktSlug: string | null      = typeof ss.market_slug === 'string' && ss.market_slug ? ss.market_slug : null;

  // Recompute endTs when strategy_settings changes
  useEffect(() => {
    const newEndTs = getEndTs(ss);
    endTsRef.current = newEndTs;
    const nowSec = Date.now() / 1000;
    setSecsLeft(newEndTs ? Math.max(0, newEndTs - nowSec) : null);
  }, [ss]);

  // 1-second tick — updates countdown and staleness
  useEffect(() => {
    const tick = () => {
      const nowSec    = Date.now() / 1000;
      const endTs     = endTsRef.current;
      if (endTs != null) {
        setSecsLeft(Math.max(0, endTs - nowSec));
      }
      if (updatedAtStr) {
        const ageMs = Date.now() - new Date(updatedAtStr).getTime();
        setStaleSec(Math.floor(ageMs / 1000));
      }
    };
    tick(); // run immediately
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [updatedAtStr]);

  // ── Derived state ──────────────────────────────────────────────────────────

  const isStale     = staleSec > STALE_SEC;
  const slugTs      = slugStartTs(mktSlug);
  const bucket      = expectedBucket();
  const secsPastBucket = Date.now() / 1000 - bucket;
  const isOldMarket = !!(slugTs && slugTs < bucket && secsPastBucket > OLD_GRACE_SEC);
  const isEnded     = secsLeft !== null && secsLeft === 0;
  const latestIsOpen = latestTrade?.status?.toUpperCase() === 'OPEN';

  // Prices and market fields
  const priceToBeat: number | null  = typeof ss.price_to_beat === 'number' ? ss.price_to_beat : null;
  const refPrice: number | null     = typeof ss.reference_price === 'number' ? ss.reference_price : null;
  const leadingSide: string | null  = typeof ss.leading_side === 'string' ? ss.leading_side : null;
  const lastDecision: string | null = typeof ss.last_decision === 'string' ? ss.last_decision : null;

  // State machine
  let marketState: MarketState = 'ACTIVE';
  if (!mktSlug)         marketState = 'NO_DATA';
  else if (isStale)     marketState = 'STALE';
  else if (isOldMarket) marketState = 'OLD_MARKET';
  else if (isEnded)     marketState = 'ENDED';
  else if (hasOpenPos)  marketState = 'POSITION';

  // ── State config ──────────────────────────────────────────────────────────
  type StateConfig = { label: string; color: string; bg: string };
  const STATE_CFG: Record<MarketState, StateConfig> = {
    NO_DATA:    { label: 'CURRENT MARKET UNAVAILABLE', color: 'rgba(248,250,252,0.25)', bg: 'rgba(255,255,255,0.04)' },
    STALE:      { label: `MARKET DATA STALE (${staleSec}s old)`,   color: '#f87171', bg: 'rgba(248,113,113,0.08)' },
    OLD_MARKET: { label: 'OLD MARKET — ROTATION DELAYED',           color: '#fbbf24', bg: 'rgba(251,191,36,0.08)'  },
    ENDED:      { label: 'MARKET ENDED — awaiting resolution',      color: '#818cf8', bg: 'rgba(129,140,248,0.08)' },
    POSITION:   { label: `${mode === 'LIVE' ? 'LIVE' : 'PAPER'} POSITION OPEN`, color: '#fbbf24', bg: 'rgba(251,191,36,0.08)' },
    ACTIVE:     { label: 'MARKET ACTIVE',                           color: '#34d399', bg: 'rgba(52,211,153,0.06)'  },
  };
  const cfg = STATE_CFG[marketState];

  // ── MINI mode (for control center bar) ────────────────────────────────────
  if (display === 'mini') {
    const mmss = secsLeft != null ? fmtMmSs(secsLeft) : '—:—';
    const txtColor = marketState === 'STALE'     ? '#f87171'
                   : marketState === 'OLD_MARKET' ? '#fbbf24'
                   : marketState === 'ENDED'      ? '#818cf8'
                   : marketState === 'NO_DATA'    ? 'rgba(248,250,252,0.2)'
                   : marketState === 'POSITION'   ? '#fbbf24'
                   : accentColor;
    return (
      <span style={{
        fontFamily:    'monospace',
        fontSize:      '0.75rem',
        fontWeight:    700,
        color:         txtColor,
        letterSpacing: '0.02em',
      }}>
        {mmss}
      </span>
    );
  }

  // ── CARD mode ─────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
      {/* Slug */}
      {mktSlug && (
        <div style={{
          fontSize:       '0.6rem',
          color:          'rgba(248,250,252,0.3)',
          fontFamily:     'monospace',
          overflow:       'hidden',
          textOverflow:   'ellipsis',
          whiteSpace:     'nowrap',
        }} title={mktSlug}>
          {mktSlug}
        </div>
      )}

      {/* ── Main countdown ── */}
      {marketState !== 'NO_DATA' && secsLeft != null ? (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem' }}>
          <span style={{
            fontSize:      '1.55rem',
            fontWeight:    800,
            fontFamily:    'monospace',
            letterSpacing: '-0.02em',
            color:         isStale || isOldMarket ? '#f87171' : isEnded ? '#818cf8' : accentColor,
            lineHeight:    1,
          }}>
            {fmtMmSs(secsLeft)}
          </span>
          <span style={{ fontSize: '0.58rem', color: 'rgba(248,250,252,0.3)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            remaining
          </span>
        </div>
      ) : (
        <div style={{ fontSize: '0.65rem', color: 'rgba(248,250,252,0.2)', fontStyle: 'italic' }}>
          No active market
        </div>
      )}

      {/* ── State badge ── */}
      <div style={{
        display:      'inline-flex',
        alignItems:   'center',
        gap:          '0.3rem',
        padding:      '0.18rem 0.5rem',
        borderRadius: '0.3rem',
        background:   cfg.bg,
        border:       `1px solid ${cfg.color}30`,
        fontSize:     '0.58rem',
        fontWeight:   700,
        letterSpacing:'0.06em',
        color:        cfg.color,
        alignSelf:    'flex-start',
      }}>
        <span style={{
          width: 5, height: 5, borderRadius: '50%', background: cfg.color, flexShrink: 0,
          boxShadow: marketState === 'ACTIVE' || marketState === 'POSITION' ? `0 0 5px ${cfg.color}` : 'none',
        }} />
        {cfg.label}
      </div>

      {/* ── Open position details ── */}
      {latestIsOpen && latestTrade && (
        <div style={{
          display:      'flex',
          gap:          '0.4rem',
          flexWrap:     'wrap',
          alignItems:   'center',
          background:   'rgba(251,191,36,0.06)',
          border:       '1px solid rgba(251,191,36,0.15)',
          borderRadius: '0.35rem',
          padding:      '0.25rem 0.5rem',
          fontSize:     '0.62rem',
        }}>
          {latestTrade.side && (
            <span style={{
              fontWeight: 700,
              color: latestTrade.side === 'UP' ? '#34d399' : '#f87171',
            }}>
              {latestTrade.side}
            </span>
          )}
          {latestTrade.size_usd != null && (
            <span style={{ color: 'rgba(248,250,252,0.6)', fontFamily: 'monospace' }}>
              ${Number(latestTrade.size_usd).toFixed(2)}
            </span>
          )}
          {latestTrade.entry_price != null && (
            <span style={{ color: 'rgba(248,250,252,0.4)', fontFamily: 'monospace', fontSize: '0.58rem' }}>
              @ ${Number(latestTrade.entry_price).toFixed(4)}
            </span>
          )}
        </div>
      )}

      {/* ── Last decision ── */}
      {lastDecision && marketState === 'ACTIVE' && (
        <div style={{ fontSize: '0.58rem', color: 'rgba(248,250,252,0.3)', fontFamily: 'monospace' }}>
          Decision: {lastDecision}
        </div>
      )}

      {/* ── Live market prices ── */}
      {(priceToBeat != null || refPrice != null || leadingSide) && (
        <div style={{
          display:   'flex',
          flexWrap:  'wrap',
          gap:       '0.25rem 0.65rem',
          fontSize:  '0.6rem',
          color:     'rgba(248,250,252,0.35)',
          marginTop: '0.05rem',
        }}>
          {priceToBeat != null && (
            <span>Beat: <span style={{ color: '#f8fafc', fontWeight: 600, fontFamily: 'monospace' }}>${priceToBeat.toFixed(4)}</span></span>
          )}
          {refPrice != null && (
            <span>Spot: <span style={{ color: '#f8fafc', fontWeight: 600, fontFamily: 'monospace' }}>${refPrice.toFixed(2)}</span></span>
          )}
          {leadingSide && (
            <span>
              Leading: <span style={{ fontWeight: 700, color: leadingSide.toUpperCase() === 'UP' ? '#34d399' : '#f87171' }}>
                {leadingSide.toUpperCase()}
              </span>
            </span>
          )}
        </div>
      )}

      {/* ── Polymarket link button ── */}
      <a
        href={marketUrl ?? '#'}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => { if (!marketUrl) e.preventDefault(); e.stopPropagation(); }}
        style={{
          display:        'block',
          textAlign:      'center',
          padding:        '0.28rem 0.65rem',
          borderRadius:   '0.4rem',
          fontSize:       '0.62rem',
          fontWeight:     700,
          letterSpacing:  '0.04em',
          textDecoration: 'none',
          transition:     'all 0.15s',
          marginTop:      '0.1rem',
          background:     !marketUrl
            ? 'rgba(255,255,255,0.03)'
            : hasOpenPos
            ? `${accentColor}18`
            : 'rgba(255,255,255,0.06)',
          border: `1px solid ${
            !marketUrl
              ? 'rgba(255,255,255,0.06)'
              : hasOpenPos
              ? `${accentColor}40`
              : 'rgba(255,255,255,0.12)'
          }`,
          color: !marketUrl
            ? 'rgba(248,250,252,0.2)'
            : hasOpenPos
            ? accentColor
            : 'rgba(248,250,252,0.55)',
          cursor: !marketUrl ? 'default' : 'pointer',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
        }}
      >
        {!marketUrl
          ? 'Current Market Unavailable'
          : hasOpenPos
          ? 'View Active Trade ↗'
          : 'Open Current Market ↗'}
      </a>
    </div>
  );
}
