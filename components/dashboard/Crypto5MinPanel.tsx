'use client';

// Crypto5MinPanel — Four compact 5-minute strategy market cards.
//
// BTC 5-Min: reads live data from:
//   • /api/bot-settings?bot_id=btc_5m_ema  (settings + EMA signal telemetry)
//   • /api/btc-ema-metrics                  (today's trades/wins/losses/P&L)
//
// ETH, SOL, XRP: COMING SOON placeholders.
//
// Does NOT execute trades. Does NOT call FastLoop.
// Settings changes write to bot_settings via /api/bot-settings (POST).

import { useCallback, useEffect, useRef, useState } from 'react';
import BtcEquityChart, { type EquityPoint } from './BtcEquityChart';
import CryptoAssetPaperCard from './CryptoAssetPaperCard';

// ─── Types ─────────────────────────────────────────────────────────────────────

type BotSettings = {
  bot_id:          string;
  is_enabled:      boolean;
  mode:            string;
  arm_live:        boolean;
  trade_size_usd:  number;
  edge_threshold:  number;
  paper_balance_usd: number;
  strategy_settings: Record<string, unknown>;
};

type LateSettings = {
  is_enabled:       boolean;
  mode:             string;
  arm_live:         boolean;
  trade_size_usd:   number;
  paper_balance_usd: number;
  strategy_settings?: Record<string, unknown>;
};

type MarketStatus = {
  ok:               boolean;
  ready:            boolean;
  reason:           string;
  // market identification
  market_slug:      string | null;
  market_url:       string | null;
  // timing
  market_start:     string | null;
  market_end:       string | null;
  seconds_remaining: number | null;
  // rich fields from FastLoop btc_5m_late.strategy_settings
  price_to_beat:    number | null;
  reference_price:  number | null;
  distance_usd:     number | null;
  leading_side:     string | null;
  up_ask:           number | null;
  down_ask:         number | null;
  signal:           string | null;
  last_decision:    string | null;
  last_decision_reason: string | null;
  current_position: boolean | null;
  today_trade_count: number | null;
  today_wins:       number | null;
  today_losses:     number | null;
  today_pnl:        number | null;
  // token IDs from market_cache
  up_token_id:      string | null;
  down_token_id:    string | null;
  // freshness
  updated_at:       string | null;
  stale_tier:       'fresh' | 'delayed' | 'stale' | 'unknown';
  stale:            boolean;
  expired:          boolean;
  server_time:      string | null;
  error?:           string;
};

type Metrics = {
  open_count:    number;
  open_exposure: number;
  total_pnl:     number;
};

// ─── Crypto/bots API types (btc_5m_late from paper_positions) ─────────────────

type RecentTrade = {
  id?:           string | null;
  status?:       string | null;   // 'OPEN' | 'CLOSED'
  start_ts?:     string | null;
  closed_at?:    string | null;
  slug?:         string | null;
  side?:         string | null;   // already translated: 'UP' | 'DOWN'
  size_usd?:     number | null;
  entry_price?:  number | null;
  pnl_usd?:      number | null;
  result?:       string | null;   // 'OPEN' | 'WIN' | 'LOSS' | 'PUSH'
  equity_after?: number | null;   // running equity after this closed trade
};

type LatestTrade = {
  start_ts?:    string | null;
  slug?:        string | null;
  side?:        string | null;    // 'UP' | 'DOWN'
  size_usd?:    number | null;
  entry_price?: number | null;
  status?:      string | null;
  pnl_usd?:     number | null;
  result?:      string | null;    // 'OPEN' | 'WIN' | 'LOSS' | 'PUSH'
};

type BotStatSummary = {
  total_trades:        number;
  trades_today:        number;
  open_trades:         number;
  closed_trades:       number;
  wins:                number;
  losses:              number;
  pushes:              number;
  win_rate:            number;
  open_exposure_usd:   number;
  total_amount_traded: number;
  today_pnl:           number;
  all_time_pnl:        number;
};

type LateStat = {
  bot_id:            string;
  is_enabled:        boolean;
  trade_size_usd:    number;
  open_positions:    number;
  open_exposure_usd: number;
  // BTC paper balance
  starting_balance:  number;
  realized_pnl:      number;
  open_exposure:     number;
  available_balance: number;
  account_equity:    number;
  // Stats
  stats:             BotStatSummary;
  latest_trade:      LatestTrade | null;
  recent_trades:     RecentTrade[];
  equity_curve:      EquityPoint[];
  legacy_ema_enabled?: boolean;
  // Legacy flat fields for compatibility
  total_trades:      number;
  total_closed:      number;
  all_time_wins:     number;
  all_time_losses:   number;
  win_rate:          number;
  all_time_pnl:      number;
  today_trade_count: number;
  today_pnl:         number;
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmtUsd(v: unknown, digits = 2): string {
  const n = parseFloat(String(v ?? ''));
  if (!Number.isFinite(n)) return '—';
  const prefix = n < 0 ? '-$' : '$';
  return `${prefix}${Math.abs(n).toFixed(digits)}`;
}

function fmtNum(v: unknown, digits = 2): string {
  const n = parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
}

function signalLabel(s: unknown): { text: string; color: string } {
  if (s === 'YES')  return { text: 'UP',        color: '#34d399' };
  if (s === 'NO')   return { text: 'DOWN',       color: '#f87171' };
  if (s === 'NONE') return { text: 'TOO CLOSE',  color: '#fbbf24' };
  return               { text: '—',           color: 'rgba(248,250,252,0.3)' };
}

function statusLabel(enabled: boolean, mode: string): { text: string; color: string } {
  if (!enabled) return { text: 'OFF',   color: 'rgba(248,250,252,0.35)' };
  if (mode === 'LIVE') return { text: 'LIVE',  color: '#f87171' };
  return                 { text: 'PAPER', color: '#818cf8' };
}

/**
 * Derives the primary BTC BOT status from btc_5m_late settings + market state.
 * The enabled state is read directly from bot_settings.is_enabled — never inferred.
 */
function lateBotStatusLabel(
  isEnabled: boolean | undefined,
  marketStatus: MarketStatus | null,
): { badge: string; badgeColor: string; text: string; textColor: string } {
  if (!isEnabled) {
    return {
      badge: 'OFF', badgeColor: 'rgba(248,250,252,0.35)',
      text: 'BTC PAPER BOT STOPPED', textColor: 'rgba(248,250,252,0.38)',
    };
  }

  // Open paper position
  if (marketStatus?.current_position) {
    return {
      badge: 'ON', badgeColor: '#34d399',
      text: 'ON — PAPER POSITION OPEN', textColor: '#34d399',
    };
  }

  // Active entry window: within 0-60 s of market close
  const secs = marketStatus?.seconds_remaining;
  if (typeof secs === 'number' && secs >= 0 && secs <= 60) {
    return {
      badge: 'ON', badgeColor: '#fbbf24',
      text: 'ON — EVALUATING', textColor: '#fbbf24',
    };
  }

  return {
    badge: 'ON', badgeColor: '#818cf8',
    text: 'ON — WAITING FOR ENTRY WINDOW', textColor: 'rgba(248,250,252,0.6)',
  };
}

// ─── Stat row ──────────────────────────────────────────────────────────────────

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', padding: '0.15rem 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <span style={{ color: 'rgba(248,250,252,0.38)' }}>{label}</span>
      <span style={{ fontWeight: 600, color: color ?? '#f8fafc' }}>{value}</span>
    </div>
  );
}

// ─── Active Market Section ─────────────────────────────────────────────────────

function CopyIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
  );
}

function CheckIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );
}

function fmtLocal(iso: string | null): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
  catch { return iso; }
}

function shortToken(id: string | null): string {
  if (!id || id.length < 12) return id ?? '—';
  return `${id.slice(0, 6)}…${id.slice(-6)}`;
}

function TokenRow({ label, tokenId }: { label: string; tokenId: string | null }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    if (!tokenId) return;
    navigator.clipboard.writeText(tokenId).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.72rem', padding: '0.15rem 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <span style={{ color: 'rgba(248,250,252,0.38)' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
        <span style={{ fontWeight: 600, fontFamily: 'monospace', fontSize: '0.68rem', color: tokenId ? '#f8fafc' : 'rgba(248,250,252,0.3)' }}>
          {tokenId ? shortToken(tokenId) : 'Not cached yet'}
        </span>
        {tokenId && (
          <button
            onClick={handleCopy}
            title={copied ? 'Copied!' : 'Copy full token ID'}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.1rem', color: copied ? '#34d399' : 'rgba(248,250,252,0.35)', lineHeight: 1 }}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
        )}
      </div>
    </div>
  );
}

function ActiveMarketSection({ market }: { market: MarketStatus | null }) {
  const prevSlugRef = useRef<string | null>(null);
  const [rotationFlash, setRotationFlash] = useState(false);

  useEffect(() => {
    if (!market?.market_slug) return;
    if (prevSlugRef.current && prevSlugRef.current !== market.market_slug) {
      setRotationFlash(true);
      setTimeout(() => setRotationFlash(false), 5000);
    }
    prevSlugRef.current = market.market_slug;
  }, [market?.market_slug]);

  const slug   = market?.market_slug ?? null;
  // Use FastLoop-supplied URL directly; never retain a prior slug's URL
  const pmUrl  = market?.market_url ?? (slug ? `https://polymarket.com/event/${encodeURIComponent(slug)}` : null);

  const secsLeft    = market?.seconds_remaining ?? null;
  const isExpired   = market?.expired ?? false;
  const secsDisplay = isExpired       ? 'EXPIRED'
                    : secsLeft == null ? '—'
                    : secsLeft > 0    ? `${secsLeft}s`
                    : 'EXPIRED';

  // Three-tier freshness badge
  const tier = market?.stale_tier ?? 'unknown';
  const freshBadge =
    tier === 'fresh'   ? { text: 'FRESH',   color: '#34d399', bg: 'rgba(52,211,153,0.1)',  border: 'rgba(52,211,153,0.25)' }
  : tier === 'delayed' ? { text: 'DELAYED',  color: '#fbbf24', bg: 'rgba(251,191,36,0.1)',  border: 'rgba(251,191,36,0.25)' }
  : tier === 'stale'   ? { text: 'STALE',    color: '#f87171', bg: 'rgba(239,68,68,0.1)',   border: 'rgba(239,68,68,0.25)' }
  : null;

  // Separate market-state badge
  const marketBadge =
    isExpired         ? { text: 'MARKET EXPIRED — WAITING FOR NEXT ROTATION', color: '#f87171', bg: 'rgba(239,68,68,0.1)',  border: 'rgba(239,68,68,0.25)' }
  : market?.ready     ? { text: 'ACTIVE',  color: '#34d399', bg: 'rgba(52,211,153,0.1)', border: 'rgba(52,211,153,0.25)' }
  : null;

  function fmtMaybeUsd(v: number | null | undefined, digits = 2) {
    if (v == null || !Number.isFinite(v)) return '—';
    return `$${Math.abs(v).toFixed(digits)}`;
  }

  return (
    <div style={{
      marginTop: '0.65rem',
      padding: '0.6rem 0.75rem',
      background: 'rgba(255,255,255,0.02)',
      border: `1px solid ${isExpired ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.06)'}`,
      borderRadius: '0.5rem',
    }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem', flexWrap: 'wrap', gap: '0.3rem' }}>
        <span style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(248,250,252,0.4)' }}>
          Active Market
        </span>
        <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Market-state badge */}
          {marketBadge && (
            <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '0.1em 0.45em', background: marketBadge.bg, color: marketBadge.color, border: `1px solid ${marketBadge.border}`, borderRadius: '0.3rem', letterSpacing: '0.05em' }}>
              {marketBadge.text}
            </span>
          )}
          {/* Freshness badge */}
          {freshBadge && (
            <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '0.1em 0.45em', background: freshBadge.bg, color: freshBadge.color, border: `1px solid ${freshBadge.border}`, borderRadius: '0.3rem', letterSpacing: '0.05em' }}>
              {freshBadge.text}
            </span>
          )}
          {/* Rotation flash */}
          {rotationFlash && (
            <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '0.1em 0.45em', background: 'rgba(129,140,248,0.15)', color: '#818cf8', border: '1px solid rgba(129,140,248,0.3)', borderRadius: '0.3rem', letterSpacing: '0.05em' }}>
              ROTATED TO NEW BTC 5-MIN MARKET
            </span>
          )}
          {!market && <span style={{ fontSize: '0.6rem', color: 'rgba(248,250,252,0.25)' }}>Loading…</span>}
        </div>
      </div>

      {!slug && (
        <div style={{ fontSize: '0.72rem', color: 'rgba(248,250,252,0.3)', padding: '0.25rem 0' }}>
          MARKET DATA NOT READY
        </div>
      )}

      {slug && (
        <>
          {/* Market slug + Polymarket link (always backend-supplied URL) */}
          <div style={{ marginBottom: '0.35rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'monospace', fontSize: '0.65rem', color: isExpired ? 'rgba(248,250,252,0.4)' : '#f8fafc', wordBreak: 'break-all', flex: 1 }}>{slug}</span>
              {/* Only show the link when market is NOT expired */}
              {pmUrl && !isExpired && (
                <a
                  href={pmUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                    fontSize: '0.62rem', fontWeight: 700,
                    color: '#818cf8', background: 'rgba(129,140,248,0.1)',
                    border: '1px solid rgba(129,140,248,0.3)',
                    borderRadius: '0.35rem', padding: '0.15rem 0.5rem',
                    textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0,
                  }}
                  title={pmUrl}
                >
                  OPEN ON POLYMARKET ↗
                </a>
              )}
            </div>
          </div>

          {/* Timing + market data rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', padding: '0.15rem 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <span style={{ color: 'rgba(248,250,252,0.38)' }}>Market start</span>
              <span style={{ fontWeight: 600 }}>{fmtLocal(market?.market_start ?? null)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', padding: '0.15rem 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <span style={{ color: 'rgba(248,250,252,0.38)' }}>Market end</span>
              <span style={{ fontWeight: 600 }}>{fmtLocal(market?.market_end ?? null)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', padding: '0.15rem 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <span style={{ color: 'rgba(248,250,252,0.38)' }}>Time remaining</span>
              <span style={{ fontWeight: 600, color: isExpired ? '#f87171' : (secsLeft ?? 0) < 30 ? '#fbbf24' : '#f8fafc' }}>{secsDisplay}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', padding: '0.15rem 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <span style={{ color: 'rgba(248,250,252,0.38)' }}>Price to Beat</span>
              <span style={{ fontWeight: 600 }}>{fmtMaybeUsd(market?.price_to_beat, 0)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', padding: '0.15rem 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <span style={{ color: 'rgba(248,250,252,0.38)' }}>Reference price</span>
              <span style={{ fontWeight: 600 }}>{fmtMaybeUsd(market?.reference_price, 0)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', padding: '0.15rem 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <span style={{ color: 'rgba(248,250,252,0.38)' }}>Leading side</span>
              <span style={{ fontWeight: 600, color: market?.leading_side === 'UP' ? '#34d399' : market?.leading_side === 'DOWN' ? '#f87171' : 'rgba(248,250,252,0.55)' }}>
                {market?.leading_side ?? '—'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', padding: '0.15rem 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <span style={{ color: 'rgba(248,250,252,0.38)' }}>UP ask</span>
              <span style={{ fontWeight: 600 }}>{fmtMaybeUsd(market?.up_ask)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', padding: '0.15rem 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <span style={{ color: 'rgba(248,250,252,0.38)' }}>DOWN ask</span>
              <span style={{ fontWeight: 600 }}>{fmtMaybeUsd(market?.down_ask)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', padding: '0.15rem 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <span style={{ color: 'rgba(248,250,252,0.38)' }}>Signal / last decision</span>
              <span style={{ fontWeight: 600 }}>{market?.last_decision ?? market?.signal ?? '—'}</span>
            </div>

            {/* Token IDs */}
            <TokenRow label="UP token"   tokenId={market?.up_token_id   ?? null} />
            <TokenRow label="DOWN token" tokenId={market?.down_token_id ?? null} />

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', padding: '0.15rem 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <span style={{ color: 'rgba(248,250,252,0.38)' }}>Snapshot updated</span>
              <span style={{ fontWeight: 600 }}>{fmtLocal(market?.updated_at ?? null)}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── COMING SOON card ──────────────────────────────────────────────────────────

const CRYPTO_IMAGES: Record<string, { url: string; alt: string }> = {
  BTC: { url: 'https://jyhfffqximlbhlaarozs.supabase.co/storage/v1/object/public/Storage/image/Crypto/BTCfullsize.webp',  alt: 'Bitcoin logo' },
  ETH: { url: 'https://jyhfffqximlbhlaarozs.supabase.co/storage/v1/object/public/Storage/image/Crypto/ETHfullsize.webp',  alt: 'Ethereum logo' },
  SOL: { url: 'https://jyhfffqximlbhlaarozs.supabase.co/storage/v1/object/public/Storage/image/Crypto/SOL-logo.webp',    alt: 'Solana logo' },
  XRP: { url: 'https://jyhfffqximlbhlaarozs.supabase.co/storage/v1/object/public/Storage/image/Crypto/XRP-logo.webp',    alt: 'XRP logo' },
};

function ComingSoonCard({ asset }: { asset: string }) {
  const img = CRYPTO_IMAGES[asset];
  return (
    <div style={{
      flex: '1 1 0', minWidth: 0,
      background: 'rgba(15,17,26,0.5)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: '0.75rem',
      padding: '1rem 1.1rem',
      display: 'flex', flexDirection: 'column', gap: '0.5rem',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
        {img && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={img.url}
            alt={img.alt}
            style={{
              width: 36, height: 36,
              objectFit: 'contain',
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.04)',
              padding: '0.15rem',
              flexShrink: 0,
              opacity: 0.55,
            }}
          />
        )}
        <div>
          <div style={{ fontWeight: 700, fontSize: '0.82rem', color: 'rgba(248,250,252,0.45)', letterSpacing: '0.04em' }}>
            {asset} 5-MIN
          </div>
          <span style={{
            fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.08em',
            color: '#818cf8', background: 'rgba(99,102,241,0.1)',
            border: '1px solid rgba(99,102,241,0.2)',
            borderRadius: '0.3rem', padding: '0.1rem 0.4rem',
            display: 'inline-block', marginTop: '0.2rem',
          }}>
            COMING SOON
          </span>
        </div>
      </div>
      {/* Description */}
      <p style={{
        margin: 0, fontSize: '0.67rem',
        color: 'rgba(248,250,252,0.25)', lineHeight: 1.5,
      }}>
        Paper testing will be enabled after BTC validation completes.
      </p>
      {/* Disabled mode indicator */}
      <div style={{
        display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.1rem',
      }}>
        {['PAPER', 'LIVE'].map((m) => (
          <span key={m} style={{
            fontSize: '0.58rem', fontWeight: 700,
            color: 'rgba(248,250,252,0.2)',
            border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: '0.25rem', padding: '0.1rem 0.4rem',
            letterSpacing: '0.06em',
          }}>
            {m}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── BTC Card ─────────────────────────────────────────────────────────────────

function BtcCard({
  settings, metrics, saving, saveErr, saveOk, lastFetchedAt,
  onSave, onToggleMode,
  lateSettings, onToggleLate, lateToggling, lateDone, lateErr,
  marketStatus,
  onActivateTestMode, testModeActivating, testModeDone, testModeErr,
  lateStat,
  onSaveLateSize, saveLateSize, saveLateSizeOk, saveLateSizeErr,
}: {
  settings:       BotSettings | null;
  metrics:        Metrics | null;
  saving:         boolean;
  saveErr:        string | null;
  saveOk:         boolean;
  onSave:         (fields: Record<string, unknown>) => void;
  onToggleMode:   (mode: 'PAPER' | 'LIVE', enabled: boolean) => void;
  lateSettings:   LateSettings | null;
  onToggleLate:   (enabled: boolean) => Promise<void>;
  lateToggling:   boolean;
  lateDone:       'on' | 'off' | null;
  lateErr:        string | null;
  marketStatus:   MarketStatus | null;
  onActivateTestMode:   () => Promise<void>;
  testModeActivating:   boolean;
  testModeDone:         boolean;
  testModeErr:          string | null;
  lateStat:           LateStat | null;
  lastFetchedAt?:     Date | null;
  onSaveLateSize:     (size: number) => Promise<void>;
  saveLateSize:       boolean;
  saveLateSizeOk:     boolean;
  saveLateSizeErr:    string | null;
}) {
  const ss = settings?.strategy_settings ?? {};
  const sig = signalLabel(ss.signal);
  // sta uses EMA bot settings for EMA-specific controls (mode, arm_live)
  const sta = statusLabel(settings?.is_enabled ?? false, settings?.mode ?? 'PAPER');
  // Primary BTC BOT badge/status reads from btc_5m_late (lateSettings)
  const lateSta = lateBotStatusLabel(lateSettings?.is_enabled, marketStatus);

  // Late-entry toggle modal state (owned here so it doesn't pollute the parent)
  const [lateModal, setLateModal] = useState<'on' | 'off' | null>(null);

  // Editable form state.
  // Trade size MUST initialize from lateSettings (btc_5m_late) not settings (btc_5m_ema).
  // lateSettings may not be available on first render, so we use lateStat as fallback.
  const [tradeSize,     setTradeSize]     = useState(String(
    lateSettings?.trade_size_usd ?? lateStat?.trade_size_usd ?? 0.10
  ));
  const [evalAt,        setEvalAt]        = useState(String((ss.entry_start_seconds as number) ?? 60));
  const [prefStart,     setPrefStart]     = useState(String((ss.preferred_entry_start as number) ?? 45));
  const [prefStop,      setPrefStop]      = useState(String((ss.preferred_entry_stop as number) ?? 30));
  const [stopAt,        setStopAt]        = useState(String((ss.entry_stop_seconds as number) ?? 20));
  const [minDist,       setMinDist]       = useState(String((ss.min_btc_distance as number) ?? 15));
  const [maxPrice,      setMaxPrice]      = useState(String((ss.max_contract_price as number) ?? 0.80));

  // Sync EMA strategy settings when EMA settings load
  useEffect(() => {
    if (!settings) return;
    const s = settings.strategy_settings ?? {};
    setEvalAt(String((s.entry_start_seconds as number) ?? 60));
    setPrefStart(String((s.preferred_entry_start as number) ?? 45));
    setPrefStop(String((s.preferred_entry_stop as number) ?? 30));
    setStopAt(String((s.entry_stop_seconds as number) ?? 20));
    setMinDist(String((s.min_btc_distance as number) ?? 15));
    setMaxPrice(String((s.max_contract_price as number) ?? 0.80));
  }, [settings]);

  // Sync trade size from btc_5m_late settings (higher priority than EMA settings)
  useEffect(() => {
    const lateSize = lateSettings?.trade_size_usd ?? lateStat?.trade_size_usd;
    if (lateSize != null) setTradeSize(String(lateSize));
  }, [lateSettings, lateStat]);

  const handleSave = () => {
    // EMA strategy settings only — trade_size_usd is saved separately via btc_5m_late
    onSave({
      strategy_settings: {
        entry_start_seconds:   parseFloat(evalAt) || 60,
        preferred_entry_start: parseFloat(prefStart) || 45,
        preferred_entry_stop:  parseFloat(prefStop) || 30,
        entry_stop_seconds:    parseFloat(stopAt) || 20,
        min_btc_distance:      parseFloat(minDist) || 15,
        max_contract_price:    parseFloat(maxPrice) || 0.80,
      },
    });
  };

  const slug   = typeof ss.market_slug === 'string' ? ss.market_slug : null;
  const isLive = settings?.mode === 'LIVE';
  const isPaper = settings?.mode === 'PAPER';
  const isOn   = settings?.is_enabled ?? false;

  // Late-entry toggle helpers
  const lateOn    = lateSettings?.is_enabled ?? false;
  const lateSize  = lateSettings?.trade_size_usd ?? 1;
  const lateColor = lateOn ? '#818cf8' : 'rgba(248,250,252,0.35)';
  const lateText  = lateOn ? 'PAPER ON' : 'OFF';

  // Test mode active: strategy_settings.test_mode or paper_test_mode is true
  // NOTE: does NOT require trade_size_usd === 0.10 — size comes from bot_settings
  const testModeActive = Boolean(
    (lateSettings?.strategy_settings as Record<string, unknown> | undefined)?.test_mode
    || (lateSettings?.strategy_settings as Record<string, unknown> | undefined)?.paper_test_mode
  );

  // Test mode modal
  const [testModeModal, setTestModeModal] = useState(false);

  const handleLateConfirm = async () => {
    const desired = lateModal === 'on';
    await onToggleLate(desired);
    setLateModal(null);
  };

  return (
    <>
    <div style={{
      width: '100%',
      background: 'rgba(15,17,26,0.6)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: '0.75rem',
      padding: '1rem',
    }}>
      {/* Header row 1: logo + title + EMA signal */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={CRYPTO_IMAGES.BTC.url}
            alt={CRYPTO_IMAGES.BTC.alt}
            style={{
              width: 56, height: 56,
              objectFit: 'contain',
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.04)',
              padding: '0.2rem',
              flexShrink: 0,
            }}
          />
          <span style={{ fontWeight: 700, fontSize: '0.85rem', letterSpacing: '0.04em' }}>BTC 5-MIN</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          {/* Primary badge reads btc_5m_late.is_enabled — never inferred from market or EMA state */}
          <span style={{
            fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.08em',
            color: lateSta.badgeColor, background: `${lateSta.badgeColor}18`,
            border: `1px solid ${lateSta.badgeColor}40`,
            borderRadius: '0.3rem', padding: '0.1rem 0.5rem',
          }}>{lateSta.badge}</span>
          {sig.text !== '—' && (
            <span style={{
              fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.06em',
              color: sig.color, background: `${sig.color}18`,
              border: `1px solid ${sig.color}40`,
              borderRadius: '0.3rem', padding: '0.1rem 0.5rem',
            }}>{sig.text}</span>
          )}
        </div>
      </div>

      {/* Header row 2: BTC BOT primary ON/OFF toggle */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap',
        padding: '0.45rem 0.6rem',
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: '0.45rem',
        marginBottom: '0.65rem',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.05rem', flex: 1 }}>
          <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'rgba(248,250,252,0.55)', letterSpacing: '0.05em' }}>
            BTC BOT
          </span>
          {/* Status text — reads directly from btc_5m_late.is_enabled */}
          <span style={{ fontSize: '0.6rem', color: lateSta.textColor, fontWeight: 600 }}>
            {lateSta.text}
          </span>
        </div>

        {/* Primary toggle button — changes only btc_5m_late.is_enabled */}
        <button
          className={`copy-btn copy-btn-sm ${lateOn ? 'copy-btn-secondary' : 'copy-btn-primary'}`}
          style={{ fontSize: '0.68rem', padding: '0.2rem 0.7rem', flexShrink: 0 }}
          disabled={lateToggling}
          onClick={() => setLateModal(lateOn ? 'off' : 'on')}
        >
          {lateToggling ? '…' : lateOn ? 'Turn OFF' : 'Turn ON'}
        </button>

        {/* LIVE NOT AVAILABLE */}
        <button
          className="copy-btn copy-btn-sm copy-btn-secondary"
          style={{ fontSize: '0.62rem', padding: '0.2rem 0.6rem', flexShrink: 0, opacity: 0.35, cursor: 'not-allowed' }}
          disabled
          title="LIVE mode is not available from this control"
        >LIVE NOT AVAILABLE</button>

        {/* TEST MODE button */}
        {testModeActive ? (
          <span style={{
            fontSize: '0.63rem', fontWeight: 700, letterSpacing: '0.07em',
            color: '#fbbf24', background: 'rgba(251,191,36,0.12)',
            border: '1px solid rgba(251,191,36,0.35)',
            borderRadius: '0.3rem', padding: '0.1rem 0.55rem', flexShrink: 0,
          }}>SIMPLE PAPER MODE · ${lateSize.toFixed(2)}</span>
        ) : (
          <button
            className="copy-btn copy-btn-sm"
            style={{ fontSize: '0.62rem', padding: '0.2rem 0.65rem', flexShrink: 0, background: 'rgba(251,191,36,0.15)', borderColor: 'rgba(251,191,36,0.4)', color: '#fbbf24' }}
            disabled={testModeActivating}
            onClick={() => setTestModeModal(true)}
            title="Enable test mode: $0.10 paper trade on next valid market"
          >{testModeActivating ? 'Activating…' : 'ACTIVATE TEST MODE'}</button>
        )}

        {/* Feedback */}
        {lateDone === 'on'  && <span style={{ fontSize: '0.65rem', color: '#34d399' }}>✓ BTC 5-Min bot turned ON</span>}
        {lateDone === 'off' && <span style={{ fontSize: '0.65rem', color: 'rgba(248,250,252,0.4)' }}>✓ BTC 5-Min bot turned OFF</span>}
        {lateErr           && <span style={{ fontSize: '0.65rem', color: '#f87171' }}>✗ {lateErr}</span>}
        {testModeDone      && <span style={{ fontSize: '0.65rem', color: '#fbbf24' }}>✓ Test mode ON — waiting for next market</span>}
        {testModeErr       && <span style={{ fontSize: '0.65rem', color: '#f87171' }}>✗ {testModeErr}</span>}
      </div>

      {!settings && (
        <div style={{ fontSize: '0.72rem', color: 'rgba(248,250,252,0.3)', padding: '0.5rem 0' }}>Waiting for market data…</div>
      )}

      {/* ── Legacy EMA warning ──────────────────────────────────────────────── */}
      {lateStat?.legacy_ema_enabled && (
        <div style={{
          marginBottom: '0.5rem', padding: '0.35rem 0.7rem',
          background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.3)',
          borderRadius: '0.4rem', fontSize: '0.68rem', color: '#fbbf24',
          display: 'flex', alignItems: 'center', gap: '0.4rem',
        }}>
          <span>⚠</span>
          <span>Legacy BTC EMA bot is also active — statistics shown are btc_5m_late only</span>
        </div>
      )}

      {/* ── Bot Summary Banner ─────────────────────────────────────────────── */}
      {lateStat && (() => {
        const s = lateStat.stats;
        const fmtPnl = (v: number) => `${v >= 0 ? '+' : ''}$${Math.abs(v).toFixed(2)}`;
        const pnlColor = (v: number) => v > 0 ? '#34d399' : v < 0 ? '#f87171' : 'rgba(248,250,252,0.55)';
        return (
          <div style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: '0.45rem',
            padding: '0.55rem 0.7rem',
            marginBottom: '0.65rem',
            fontSize: '0.7rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, color: 'rgba(248,250,252,0.9)', letterSpacing: '0.04em', marginBottom: '0.4rem' }}>
              <img
                src="https://jyhfffqximlbhlaarozs.supabase.co/storage/v1/object/public/Storage/image/Crypto/BTCfullsize.webp"
                alt="BTC"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', border: '1.5px solid rgba(251,146,60,0.45)', flexShrink: 0 }}
              />
              BTC 5-Min — {lateSettings?.is_enabled ? 'ACTIVE' : 'INACTIVE'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.2rem 1.2rem' }}>
              {[
                { label: 'Trades Today',    val: String(s.trades_today),   color: undefined },
                { label: 'Total Trades',    val: String(s.total_trades),   color: undefined },
                { label: 'Open',            val: String(s.open_trades),    color: undefined },
                { label: 'Closed',          val: String(s.closed_trades),  color: undefined },
                { label: 'Wins',            val: String(s.wins),           color: s.wins > 0 ? '#34d399' : undefined },
                { label: 'Losses',          val: String(s.losses),         color: s.losses > 0 ? '#f87171' : undefined },
                { label: 'Win Rate',        val: s.wins + s.losses > 0 ? `${(s.win_rate * 100).toFixed(0)}%` : '0%', color: undefined },
                { label: 'Open Exposure',   val: `$${s.open_exposure_usd.toFixed(2)}`, color: undefined },
                { label: 'Today P/L',       val: fmtPnl(s.today_pnl),     color: pnlColor(s.today_pnl) },
                { label: 'All-Time P/L',    val: fmtPnl(s.all_time_pnl),  color: pnlColor(s.all_time_pnl) },
              ].map(({ label, val, color }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.4rem' }}>
                  <span style={{ color: 'rgba(248,250,252,0.4)' }}>{label}</span>
                  <span style={{ fontWeight: 600, color: color ?? 'rgba(248,250,252,0.8)' }}>{val}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {settings && (
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          {/* ── Left: live stats ── */}
          <div style={{ flex: '1 1 140px', minWidth: 120 }}>
            <Stat label="Market"          value={slug ? slug.slice(0, 30) : '—'} />
            <ActiveMarketSection market={marketStatus} />
            <Stat label="Time remaining"  value="—" />
            <Stat label="Price to Beat"   value="—" />
            <Stat label="BTC ref price"   value={fmtNum(ss.last_close, 0) !== '—' ? `$${fmtNum(ss.last_close, 0)}` : '—'} />
            <Stat label="Leading side"    value={sig.text} color={sig.color} />
            <Stat label="Dist from PTB"   value="—" />
            <Stat label="UP ask"          value="—" />
            <Stat label="DOWN ask"        value="—" />
            <Stat label="EMA 9"           value={fmtNum(ss.ema9, 0)} />
            <Stat label="EMA 200"         value={fmtNum(ss.ema200, 0)} />
            <Stat label="Signal"          value={typeof ss.signal === 'string' ? ss.signal : '—'} color={sig.color} />
            <Stat label="Last decision"   value="—" />
            {/* Per-bot stats from paper_positions (btc_5m_late) via /api/crypto/bots */}
            {(() => {
              const s = lateStat?.stats;
              const today      = s?.trades_today       ?? 0;
              const total      = s?.total_trades       ?? 0;
              const open       = s?.open_trades        ?? 0;
              const closed     = s?.closed_trades      ?? 0;
              const wins       = s?.wins               ?? 0;
              const losses     = s?.losses             ?? 0;
              const pushes     = s?.pushes             ?? 0;
              const winRate    = s?.win_rate           ?? 0;
              const amtTraded  = s?.total_amount_traded ?? 0;
              const todayPnl   = s?.today_pnl          ?? 0;
              const allTimePnl = s?.all_time_pnl       ?? 0;
              const fmtPnl = (v: number) => `${v >= 0 ? '+' : ''}$${Math.abs(v).toFixed(2)}`;
              const pnlColor = (v: number) => v > 0 ? '#34d399' : v < 0 ? '#f87171' : undefined;
              return (<>
                <Stat label="Trades Today"     value={String(today)} />
                <Stat label="Total Trades"     value={String(total)} />
                <Stat label="Open"             value={String(open)} />
                <Stat label="Closed"           value={String(closed)} />
                <Stat label="Wins"             value={String(wins)}   color={wins > 0 ? '#34d399' : undefined} />
                <Stat label="Losses"           value={String(losses)} color={losses > 0 ? '#f87171' : undefined} />
                {pushes > 0 && <Stat label="Pushes" value={String(pushes)} />}
                <Stat label="Win Rate"         value={wins + losses > 0 ? `${(winRate * 100).toFixed(0)}%` : '0%'} />
                <Stat label="Total Traded"     value={`$${amtTraded.toFixed(2)}`} />
                <Stat label="Today P/L"        value={fmtPnl(todayPnl)}   color={pnlColor(todayPnl)} />
                <Stat label="All-Time P/L"     value={fmtPnl(allTimePnl)} color={pnlColor(allTimePnl)} />
              </>);
            })()}
            {metrics && (
              <Stat label="Open exposure" value={fmtUsd(metrics.open_exposure)} />
            )}
            <Stat label="Open positions"  value={String(ss.open_position_count ?? 0)} />
          </div>

          {/* ── Right: controls ── */}
          <div style={{ flex: '1 1 160px', minWidth: 140 }}>
            {/* Mode toggles */}
            <div style={{ marginBottom: '0.6rem' }}>
              <div style={{ fontSize: '0.65rem', color: 'rgba(248,250,252,0.3)', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Mode</div>
              <div style={{ display: 'flex', gap: '0.35rem' }}>
                <button
                  className={`copy-btn copy-btn-sm ${isPaper && isOn ? 'copy-btn-primary' : 'copy-btn-secondary'}`}
                  style={{ fontSize: '0.68rem', padding: '0.2rem 0.65rem' }}
                  onClick={() => onToggleMode('PAPER', !(isPaper && isOn))}
                  title={isPaper && isOn ? 'Disable PAPER mode' : 'Enable PAPER mode'}
                >PAPER</button>
                <button
                  className={`copy-btn copy-btn-sm ${isLive && isOn ? 'copy-btn-primary' : 'copy-btn-secondary'}`}
                  style={{ fontSize: '0.68rem', padding: '0.2rem 0.65rem', opacity: 0.5 }}
                  disabled
                  title="LIVE requires all safety gates — configure via FastLoop"
                >LIVE</button>
              </div>
            </div>

            {/* BTC 5-Min Trade Size — reads/saves btc_5m_late (NOT btc_5m_ema) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem', marginBottom: '0.25rem' }}>
              <label style={{ fontSize: '0.62rem', color: 'rgba(248,250,252,0.35)' }}>
                BTC 5-Min trade size ($) — btc_5m_late
              </label>
              <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                <input
                  className="copy-form-input"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={tradeSize}
                  onChange={(e) => setTradeSize(e.target.value)}
                  style={{ padding: '0.18rem 0.35rem', fontSize: '0.75rem', flex: 1 }}
                />
                <button
                  className="copy-btn copy-btn-primary"
                  style={{ fontSize: '0.68rem', padding: '0.18rem 0.5rem', whiteSpace: 'nowrap' }}
                  onClick={() => onSaveLateSize(parseFloat(tradeSize) || 0.10)}
                  disabled={saveLateSize}
                >
                  {saveLateSize ? 'Saving…' : 'Save Size'}
                </button>
              </div>
              {saveLateSizeErr && <div style={{ fontSize: '0.65rem', color: '#f87171' }}>✗ {saveLateSizeErr}</div>}
              {saveLateSizeOk  && <div style={{ fontSize: '0.65rem', color: '#34d399' }}>✓ BTC trade size saved</div>}
            </div>

            {/* EMA strategy-specific settings */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              {[
                { label: 'Start eval (sec remaining)', value: evalAt, set: setEvalAt, step: '1', min: '1' },
                { label: 'Pref entry start (sec)', value: prefStart, set: setPrefStart, step: '1', min: '1' },
                { label: 'Pref entry stop (sec)', value: prefStop, set: setPrefStop, step: '1', min: '1' },
                { label: 'Stop entries (sec remaining)', value: stopAt, set: setStopAt, step: '1', min: '1' },
                { label: 'Min BTC distance ($)', value: minDist, set: setMinDist, step: '1', min: '0' },
                { label: 'Max contract price ($)', value: maxPrice, set: setMaxPrice, step: '0.01', min: '0.01', max: '1' },
              ].map(({ label, value, set, step, min, max }) => (
                <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                  <label style={{ fontSize: '0.62rem', color: 'rgba(248,250,252,0.35)' }}>{label}</label>
                  <input
                    className="copy-form-input"
                    type="number"
                    step={step}
                    min={min}
                    max={max}
                    value={value}
                    onChange={(e) => set(e.target.value)}
                    style={{ padding: '0.18rem 0.35rem', fontSize: '0.75rem' }}
                  />
                </div>
              ))}
            </div>

            <button
              className="copy-btn copy-btn-primary"
              style={{ marginTop: '0.6rem', width: '100%', fontSize: '0.72rem', padding: '0.3rem' }}
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save EMA Settings'}
            </button>
            {saveErr && <div style={{ fontSize: '0.65rem', color: '#f87171', marginTop: '0.25rem' }}>✗ {saveErr}</div>}
            {saveOk  && <div style={{ fontSize: '0.65rem', color: '#34d399', marginTop: '0.25rem' }}>✓ EMA Settings saved</div>}
            <div style={{ fontSize: '0.6rem', color: 'rgba(248,250,252,0.2)', marginTop: '0.3rem' }}>
              Mode: {settings.mode} · Strategy: BTC 5M EMA
            </div>
          </div>
        </div>
      )}

      {/* ── Stored trade size (from bot_settings.trade_size_usd for btc_5m_late) ── */}
      {lateStat && (
        <div style={{
          marginTop: '0.55rem',
          padding: '0.4rem 0.7rem',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: '0.4rem',
          fontSize: '0.68rem',
          display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap',
        }}>
          <span style={{ color: 'rgba(248,250,252,0.4)' }}>Stored trade size (bot_settings):</span>
          <span style={{ fontWeight: 700, color: '#fbbf24' }}>${lateStat.trade_size_usd.toFixed(2)}</span>
          {lastFetchedAt && (
            <span style={{ color: 'rgba(248,250,252,0.25)', fontSize: '0.62rem', marginLeft: 'auto' }}>
              Updated {Math.round((Date.now() - lastFetchedAt.getTime()) / 1000)}s ago
            </span>
          )}
        </div>
      )}

      {/* ── BTC Paper Balance Summary ─────────────────────────────────────── */}
      {lateStat && (() => {
        const pnlColor = lateStat.realized_pnl >= 0 ? '#34d399' : '#f87171';
        const rows: [string, string, string?][] = [
          ['Starting Balance', `$${lateStat.starting_balance.toFixed(2)}`],
          ['Realized P/L',     `${lateStat.realized_pnl >= 0 ? '+' : ''}$${lateStat.realized_pnl.toFixed(2)}`, lateStat.realized_pnl !== 0 ? (lateStat.realized_pnl > 0 ? '#34d399' : '#f87171') : undefined],
          ['Open Exposure',    `$${lateStat.open_exposure.toFixed(2)}`],
          ['Available',        `$${lateStat.available_balance.toFixed(2)}`],
          ['Account Equity',   `$${lateStat.account_equity.toFixed(2)}`, pnlColor],
        ];
        return (
          <div style={{
            marginTop: '0.65rem',
            padding: '0.55rem 0.7rem',
            background: 'rgba(255,255,255,0.025)',
            border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: '0.45rem',
            fontSize: '0.7rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700, fontSize: '0.65rem', letterSpacing: '0.05em', color: 'rgba(248,250,252,0.4)', textTransform: 'uppercase', marginBottom: '0.4rem' }}>
              <img
                src="https://jyhfffqximlbhlaarozs.supabase.co/storage/v1/object/public/Storage/image/Crypto/BTCfullsize.webp"
                alt="BTC" onError={(e) => { e.currentTarget.style.display = 'none'; }}
                style={{ width: 20, height: 20, borderRadius: '50%', objectFit: 'cover', border: '1.5px solid rgba(251,146,60,0.45)', flexShrink: 0 }}
              />
              Shared Paper Account
            </div>
            {rows.map(([label, val, color]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.1rem 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <span style={{ color: 'rgba(248,250,252,0.4)' }}>{label}</span>
                <span style={{ fontWeight: 600, color: color ?? 'rgba(248,250,252,0.85)', fontFamily: 'monospace' }}>{val}</span>
              </div>
            ))}
          </div>
        );
      })()}

      {/* ── BTC Equity Chart ─────────────────────────────────────────────── */}
      {lateStat && (
        <div style={{ marginTop: '0.75rem' }}>
          <BtcEquityChart
            curve={lateStat.equity_curve ?? []}
            startingBalance={lateStat.starting_balance}
          />
        </div>
      )}

      {/* ── Latest BTC Trade ─────────────────────────────────────────────── */}
      {lateStat?.latest_trade && (() => {
        const lt = lateStat.latest_trade!;
        const ts = lt.start_ts ? new Date(lt.start_ts) : null;
        const timeStr = ts ? ts.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
        const side = lt.side ?? '—';
        const sideColor = side === 'UP' ? '#34d399' : side === 'DOWN' ? '#f87171' : 'rgba(248,250,252,0.6)';
        const result = lt.result ?? '—';
        const resultColor = result === 'WIN' ? '#34d399' : result === 'LOSS' ? '#f87171' : result === 'OPEN' ? '#fbbf24' : 'rgba(248,250,252,0.5)';
        const pnl = lt.pnl_usd;
        const pnlStr = pnl != null && lt.status !== 'OPEN' ? `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(4)}` : (lt.status === 'OPEN' ? 'Open' : '—');
        const pnlColor = pnl != null && pnl > 0 ? '#34d399' : pnl != null && pnl < 0 ? '#f87171' : 'rgba(248,250,252,0.5)';
        const slugShort = (lt.slug ?? '').replace(/^btc-updown-5m-/i, '').slice(0, 20) || (lt.slug ?? '—');
        return (
          <div style={{
            marginTop: '0.65rem',
            padding: '0.6rem 0.7rem',
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '0.45rem',
            fontSize: '0.7rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.05em', color: 'rgba(248,250,252,0.45)', textTransform: 'uppercase', marginBottom: '0.45rem' }}>
              <img
                src="https://jyhfffqximlbhlaarozs.supabase.co/storage/v1/object/public/Storage/image/Crypto/BTCfullsize.webp"
                alt="BTC" onError={(e) => { e.currentTarget.style.display = 'none'; }}
                style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover', border: '1.5px solid rgba(251,146,60,0.45)', flexShrink: 0 }}
              />
              Latest BTC Trade
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '0.2rem 1rem' }}>
              {([
                { label: 'Market',  val: slugShort, color: 'rgba(248,250,252,0.6)' },
                { label: 'Time',    val: timeStr,   color: 'rgba(248,250,252,0.55)' },
                { label: 'Side',    val: side,       color: sideColor },
                { label: 'Size',    val: lt.size_usd != null ? `$${Number(lt.size_usd).toFixed(2)}` : '—', color: undefined },
                { label: 'Entry',   val: lt.entry_price != null ? `$${Number(lt.entry_price).toFixed(3)}` : '—', color: undefined },
                { label: 'Status',  val: lt.status ?? '—', color: lt.status === 'OPEN' ? '#fbbf24' : 'rgba(248,250,252,0.6)' },
                { label: 'Result',  val: result,    color: resultColor },
                { label: 'P/L',     val: pnlStr,    color: pnlColor },
              ] as { label: string; val: string; color: string | undefined }[]).map(({ label, val, color }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.3rem' }}>
                  <span style={{ color: 'rgba(248,250,252,0.35)' }}>{label}</span>
                  <span style={{ fontWeight: 600, color: color ?? 'rgba(248,250,252,0.8)' }}>{val}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Recent BTC Trades (shown below equity chart) ───────────────────── */}
      {lateStat && lateStat.recent_trades.length > 0 && (() => {
        const cols = ['Time', 'Market', 'Side', 'Size', 'Entry', 'Result', 'P/L', 'Equity'];
        return (
          <div style={{ marginTop: '0.75rem' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '0.4rem',
              fontSize: '0.67rem', fontWeight: 700, letterSpacing: '0.06em',
              color: 'rgba(248,250,252,0.4)', textTransform: 'uppercase',
              marginBottom: '0.4rem',
            }}>
              <img
                src="https://jyhfffqximlbhlaarozs.supabase.co/storage/v1/object/public/Storage/image/Crypto/BTCfullsize.webp"
                alt="BTC" onError={(e) => { e.currentTarget.style.display = 'none'; }}
                style={{ width: 20, height: 20, borderRadius: '50%', objectFit: 'cover', border: '1.5px solid rgba(251,146,60,0.45)', flexShrink: 0 }}
              />
              Recent BTC Trades
            </div>

            {/* Desktop table */}
            <div className="btc-trades-desktop" style={{ overflowX: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.65rem' }}>
                <thead>
                  <tr>
                    {cols.map((h) => (
                      <th key={h} style={{
                        textAlign: 'left', padding: '0.2rem 0.3rem',
                        color: 'rgba(248,250,252,0.3)', fontWeight: 600,
                        borderBottom: '1px solid rgba(255,255,255,0.07)',
                        fontSize: '0.61rem', letterSpacing: '0.05em', whiteSpace: 'nowrap',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lateStat.recent_trades.map((t, i) => {
                    const ts = t.start_ts ? new Date(t.start_ts) : null;
                    const timeStr = ts ? ts.toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
                    const slugDisplay = (t.slug ?? '').replace(/^btc-updown-5m-/i, '').slice(0, 12) || (t.slug ?? '—');
                    const side = t.side ?? '—';
                    const sideColor = side === 'UP' ? '#34d399' : side === 'DOWN' ? '#f87171' : 'inherit';
                    const status = t.status ?? '—';
                    const result = t.result ?? '—';
                    const resultColor = result === 'WIN' ? '#34d399' : result === 'LOSS' ? '#f87171' : result === 'OPEN' ? '#fbbf24' : 'rgba(248,250,252,0.45)';
                    const pnl = t.pnl_usd ?? null;
                    const pnlStr = pnl != null && status !== 'OPEN' ? `${pnl >= 0 ? '+' : ''}$${Math.abs(pnl).toFixed(4)}` : '—';
                    const pnlColor = pnl != null && pnl > 0 ? '#34d399' : pnl != null && pnl < 0 ? '#f87171' : 'rgba(248,250,252,0.4)';
                    const sizeStr = t.size_usd != null ? `$${Number(t.size_usd).toFixed(2)}` : '—';
                    const entryStr = t.entry_price != null ? `$${Number(t.entry_price).toFixed(3)}` : '—';
                    const eqStr = t.equity_after != null ? `$${Number(t.equity_after).toFixed(2)}` : '—';
                    return (
                      <tr key={t.id ?? i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ padding: '0.22rem 0.3rem', color: 'rgba(248,250,252,0.5)', whiteSpace: 'nowrap' }}>{timeStr}</td>
                        <td style={{ padding: '0.22rem 0.3rem', color: 'rgba(248,250,252,0.55)', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.slug ?? ''}>{slugDisplay}</td>
                        <td style={{ padding: '0.22rem 0.3rem', fontWeight: 700, color: sideColor }}>{side}</td>
                        <td style={{ padding: '0.22rem 0.3rem', color: 'rgba(248,250,252,0.6)' }}>{sizeStr}</td>
                        <td style={{ padding: '0.22rem 0.3rem', color: 'rgba(248,250,252,0.5)' }}>{entryStr}</td>
                        <td style={{ padding: '0.22rem 0.3rem', fontWeight: 700, color: resultColor }}>{result}</td>
                        <td style={{ padding: '0.22rem 0.3rem', fontWeight: 600, color: pnlColor, whiteSpace: 'nowrap' }}>{pnlStr}</td>
                        <td style={{ padding: '0.22rem 0.3rem', color: 'rgba(248,250,252,0.4)', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: '0.6rem' }}>{eqStr}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile stacked cards */}
            <div className="btc-trades-mobile">
              {lateStat.recent_trades.map((t, i) => {
                const ts = t.start_ts ? new Date(t.start_ts) : null;
                const timeStr = ts ? ts.toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
                const side = t.side ?? '—';
                const sideColor = side === 'UP' ? '#34d399' : side === 'DOWN' ? '#f87171' : 'rgba(248,250,252,0.6)';
                const result = t.result ?? '—';
                const resultColor = result === 'WIN' ? '#34d399' : result === 'LOSS' ? '#f87171' : result === 'OPEN' ? '#fbbf24' : 'rgba(248,250,252,0.45)';
                const pnl = t.pnl_usd ?? null;
                const pnlStr = pnl != null && t.status !== 'OPEN' ? `${pnl >= 0 ? '+' : ''}$${Math.abs(pnl).toFixed(4)}` : '—';
                const pnlColor = pnl != null && pnl > 0 ? '#34d399' : pnl != null && pnl < 0 ? '#f87171' : 'rgba(248,250,252,0.4)';
                return (
                  <div key={t.id ?? i} style={{
                    marginBottom: '0.4rem', padding: '0.45rem 0.6rem',
                    background: 'rgba(255,255,255,0.03)',
                    borderRadius: '0.35rem', fontSize: '0.68rem',
                    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.15rem 0.6rem',
                  }}>
                    <span style={{ color: 'rgba(248,250,252,0.4)' }}>{timeStr}</span>
                    <span style={{ fontWeight: 700, color: sideColor }}>{side}</span>
                    <span style={{ color: 'rgba(248,250,252,0.5)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.slug ?? '—'}</span>
                    <span style={{ fontWeight: 700, color: resultColor }}>{result} · <span style={{ color: pnlColor }}>{pnlStr}</span></span>
                    {t.equity_after != null && <span style={{ color: 'rgba(248,250,252,0.3)', fontSize: '0.62rem', gridColumn: '1 / -1' }}>Equity: ${Number(t.equity_after).toFixed(2)}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>

    {/* ── Confirmation modal: Turn ON ── */}
    {lateModal === 'on' && (
      <div className="copy-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !lateToggling) setLateModal(null); }}>
        <div className="copy-modal" role="dialog" aria-modal="true" style={{ maxWidth: 420 }}>
          <div className="copy-modal-header">
            <h3 className="copy-modal-title">Enable BTC 5-Min PAPER Trading?</h3>
            <button className="copy-modal-close" onClick={() => setLateModal(null)} disabled={lateToggling}>×</button>
          </div>
          <div className="copy-modal-body">
            {[
              ['Strategy',  'BTC 5-Min Late Entry'],
              ['Mode',      'PAPER'],
              ['Trade size', `$${lateSize}`],
              ['LIVE',      'OFF — not available'],
              ['ARM LIVE',  'OFF — forced'],
            ].map(([label, value]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', padding: '0.2rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <span style={{ color: 'rgba(248,250,252,0.45)' }}>{label}</span>
                <span style={{ fontWeight: 600 }}>{value}</span>
              </div>
            ))}
            <p style={{ fontSize: '0.72rem', color: 'rgba(248,250,252,0.4)', marginTop: '0.6rem' }}>
              FastLoop will evaluate BTC 5-minute markets during the configured late-entry window. No trade is placed immediately.
            </p>
          </div>
          <div className="copy-modal-footer">
            <button className="copy-btn copy-btn-secondary" onClick={() => setLateModal(null)} disabled={lateToggling}>Cancel</button>
            <button className="copy-btn copy-btn-primary" onClick={handleLateConfirm} disabled={lateToggling}>
              {lateToggling ? 'Enabling…' : 'TURN ON BTC PAPER'}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* ── Confirmation modal: Turn OFF ── */}
    {lateModal === 'off' && (
      <div className="copy-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !lateToggling) setLateModal(null); }}>
        <div className="copy-modal" role="dialog" aria-modal="true" style={{ maxWidth: 420 }}>
          <div className="copy-modal-header">
            <h3 className="copy-modal-title">Turn Off BTC 5-Min PAPER Trading?</h3>
            <button className="copy-modal-close" onClick={() => setLateModal(null)} disabled={lateToggling}>×</button>
          </div>
          <div className="copy-modal-body">
            <p style={{ fontSize: '0.8rem', color: 'rgba(248,250,252,0.65)', marginBottom: '0.75rem' }}>
              This stops new BTC 5-minute entries. Existing paper positions will still be allowed to settle.
            </p>
            {[
              ['Copy bots affected',  'None'],
              ['Open positions',      'Unchanged — allowed to settle'],
              ['Bankroll',            'Unchanged'],
              ['ARM LIVE',            'OFF — forced'],
            ].map(([label, value]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', padding: '0.2rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <span style={{ color: 'rgba(248,250,252,0.45)' }}>{label}</span>
                <span style={{ fontWeight: 600 }}>{value}</span>
              </div>
            ))}
          </div>
          <div className="copy-modal-footer">
            <button className="copy-btn copy-btn-secondary" onClick={() => setLateModal(null)} disabled={lateToggling}>Cancel</button>
            <button
              className="copy-btn copy-btn-primary"
              onClick={handleLateConfirm}
              disabled={lateToggling}
              style={{ background: 'rgba(239,68,68,0.12)', borderColor: 'rgba(239,68,68,0.4)', color: '#f87171' }}
            >
              {lateToggling ? 'Turning Off…' : 'TURN OFF BTC PAPER'}
            </button>
          </div>
        </div>
      </div>
    )}
    {/* ── Test mode activation modal ── */}
    {testModeModal && (
      <div className="copy-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !testModeActivating) setTestModeModal(false); }}>
        <div className="copy-modal" role="dialog" aria-modal="true" style={{ maxWidth: 440 }}>
          <div className="copy-modal-header">
            <h3 className="copy-modal-title" style={{ color: '#fbbf24' }}>Activate BTC 5-Min Paper Test Mode</h3>
            <button className="copy-modal-close" onClick={() => setTestModeModal(false)} disabled={testModeActivating}>×</button>
          </div>
          <div className="copy-modal-body">
            <p style={{ fontSize: '0.8rem', color: 'rgba(248,250,252,0.65)', marginBottom: '0.75rem' }}>
              Places one $0.10 paper trade on the next valid BTC 5-minute market — no distance, momentum, or ask-ceiling requirements.
              LIVE trading remains impossible.
            </p>
            {[
              ['Mode',          'PAPER — forced'],
              ['ARM LIVE',      'OFF — forced'],
              ['Trade size',    '$0.10 (fixed)'],
              ['Entry window',  '45 – 20 seconds remaining'],
              ['Direction',     'BTC price vs Price to Beat'],
              ['Max per market','1 trade'],
              ['Settlement',    'Normal WIN/LOSS/P&L'],
              ['Copy bots',     'Unaffected'],
              ['LIVE trading',  'Impossible — mode gate enforced'],
            ].map(([label, value]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', padding: '0.2rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <span style={{ color: 'rgba(248,250,252,0.45)' }}>{label}</span>
                <span style={{ fontWeight: 600 }}>{value}</span>
              </div>
            ))}
          </div>
          <div className="copy-modal-footer">
            <button className="copy-btn copy-btn-secondary" onClick={() => setTestModeModal(false)} disabled={testModeActivating}>Cancel</button>
            <button
              className="copy-btn copy-btn-primary"
              disabled={testModeActivating}
              style={{ background: 'rgba(251,191,36,0.15)', borderColor: 'rgba(251,191,36,0.4)', color: '#fbbf24' }}
              onClick={async () => { setTestModeModal(false); await onActivateTestMode(); }}
            >
              {testModeActivating ? 'Activating…' : 'ACTIVATE TEST MODE'}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

// ─── Main Panel ────────────────────────────────────────────────────────────────

export default function Crypto5MinPanel() {
  const [settings,      setSettings]      = useState<BotSettings | null>(null);
  const [metrics,       setMetrics]       = useState<Metrics | null>(null);
  const [lateSettings,  setLateSettings]  = useState<LateSettings | null>(null);
  const [marketStatus,  setMarketStatus]  = useState<MarketStatus | null>(null);
  // Stats for btc_5m_late from /api/crypto/bots — uses LateStat type (module scope)
  const [lateStat,     setLateStat]     = useState<LateStat | null>(null);
  const [allBotStats,  setAllBotStats]  = useState<LateStat[] | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  const [loading,       setLoading]       = useState(true);
  const [saving,        setSaving]        = useState(false);
  const [saveErr,       setSaveErr]       = useState<string | null>(null);
  const [saveOk,        setSaveOk]        = useState(false);
  const [lateToggling,      setLateToggling]      = useState(false);
  const [lateDone,          setLateDone]          = useState<'on' | 'off' | null>(null);
  const [lateErr,           setLateErr]           = useState<string | null>(null);
  const [testModeActivating, setTestModeActivating] = useState(false);
  const [testModeDone,       setTestModeDone]       = useState(false);
  const [testModeErr,        setTestModeErr]        = useState<string | null>(null);
  // btc_5m_late trade size save state (separate from EMA settings save)
  const [saveLateSize,    setSaveLateSize]    = useState(false);
  const [saveLateSizeOk,  setSaveLateSizeOk]  = useState(false);
  const [saveLateSizeErr, setSaveLateSizeErr] = useState<string | null>(null);
  const [expanded,      setExpanded]      = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [settRes, metRes, lateRes, mktRes, cryptoBotsRes] = await Promise.all([
        fetch('/api/bot-settings?bot_id=btc_5m_ema', { cache: 'no-store' }),
        fetch('/api/btc-ema-metrics', { cache: 'no-store' }),
        fetch('/api/btc-5m-late', { cache: 'no-store' }),
        fetch(`/api/btc-5m-market?ts=${Date.now()}`, { cache: 'no-store' }),
        fetch('/api/crypto/bots', { cache: 'no-store' }),
      ]);
      const settJson        = await settRes.json()       as { ok: boolean; settings?: BotSettings };
      const metJson         = await metRes.json()        as { ok: boolean; open_count?: number; open_exposure?: number; total_pnl?: number };
      const lateJson        = await lateRes.json()       as { ok: boolean; settings?: LateSettings };
      const mktJson         = await mktRes.json()        as MarketStatus;
      const cryptoBotsJson  = await cryptoBotsRes.json() as { ok: boolean; bots?: LateStat[] };
      if (settJson.ok && settJson.settings) setSettings(settJson.settings);
      if (metJson.ok) setMetrics({ open_count: metJson.open_count ?? 0, open_exposure: metJson.open_exposure ?? 0, total_pnl: metJson.total_pnl ?? 0 });
      if (lateJson.ok && lateJson.settings) setLateSettings(lateJson.settings);
      if (mktJson.ok !== false) setMarketStatus(mktJson);
      // Use first bot row — contains stats sub-object + recent_trades
      if (cryptoBotsJson.ok && Array.isArray(cryptoBotsJson.bots) && cryptoBotsJson.bots.length > 0) {
        setLateStat(cryptoBotsJson.bots[0]);
        setAllBotStats(cryptoBotsJson.bots as LateStat[]);
        setLastFetchedAt(new Date());
      }
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    loadData();
    // 5s poll so btc_5m_late.is_enabled is always fresh (never stale OFF after worker enables)
    const interval = setInterval(loadData, 5_000);
    // Immediate re-fetch when control center or another source changes bot state
    const onBotChange = () => loadData();
    window.addEventListener('crypto:bot-state-changed', onBotChange);
    return () => {
      clearInterval(interval);
      window.removeEventListener('crypto:bot-state-changed', onBotChange);
    };
  }, [loadData]);

  const handleSave = async (fields: Record<string, unknown>) => {
    setSaving(true); setSaveErr(null); setSaveOk(false);
    try {
      const res = await fetch('/api/bot-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bot_id: 'btc_5m_ema', ...fields }),
        cache: 'no-store',
      });
      const payload = await res.json() as { ok: boolean; error?: string };
      if (payload.ok) { setSaveOk(true); setTimeout(() => setSaveOk(false), 3000); await loadData(); }
      else setSaveErr(payload.error ?? 'Save failed');
    } catch { setSaveErr('Network error'); }
    finally { setSaving(false); }
  };

  const handleToggleMode = async (mode: 'PAPER' | 'LIVE', enabled: boolean) => {
    await handleSave({ mode, is_enabled: enabled });
  };

  const handleToggleLate = async (enabled: boolean) => {
    setLateToggling(true); setLateErr(null); setLateDone(null);
    try {
      const res = await fetch('/api/btc-5m-late', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_enabled: enabled }),
        cache: 'no-store',
      });
      const payload = await res.json() as { ok: boolean; settings?: LateSettings; error?: string };
      if (payload.ok && payload.settings) {
        setLateSettings(payload.settings);
        setLateDone(enabled ? 'on' : 'off');
        setTimeout(() => setLateDone(null), 4000);
        // Notify control center and other listeners of the state change
        window.dispatchEvent(new CustomEvent('crypto:bot-state-changed'));
      } else {
        setLateErr(payload.error ?? 'Toggle failed');
      }
    } catch { setLateErr('Network error'); }
    finally { setLateToggling(false); }
  };

  // Save btc_5m_late trade size only — never touches EMA settings or bot states.
  const handleSaveLateSize = async (size: number) => {
    setSaveLateSize(true); setSaveLateSizeErr(null); setSaveLateSizeOk(false);
    try {
      const res = await fetch('/api/btc-5m-late', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trade_size_usd: size }),
        cache: 'no-store',
      });
      const payload = await res.json() as { ok: boolean; settings?: LateSettings; error?: string };
      if (payload.ok && payload.settings) {
        setLateSettings(payload.settings);
        setSaveLateSizeOk(true);
        setTimeout(() => setSaveLateSizeOk(false), 3000);
        await loadData(); // refresh all stats from API
      } else {
        setSaveLateSizeErr(payload.error ?? 'Save failed');
      }
    } catch { setSaveLateSizeErr('Network error'); }
    finally { setSaveLateSize(false); }
  };

  // Activate test mode: is_enabled=true, mode=PAPER, arm_live=false, trade_size_usd=0.10,
  // strategy_settings.test_mode=true. Never submits a live order.
  const handleActivateTestMode = async () => {
    setTestModeActivating(true); setTestModeErr(null); setTestModeDone(false);
    try {
      const res = await fetch('/api/btc-5m-late', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_enabled: true, test_mode: true, trade_size_usd: 0.10 }),
        cache: 'no-store',
      });
      const payload = await res.json() as { ok: boolean; settings?: LateSettings; test_mode_activated?: boolean; error?: string };
      if (payload.ok && payload.settings) {
        setLateSettings(payload.settings);
        setTestModeDone(true);
        setTimeout(() => setTestModeDone(false), 6000);
        await loadData(); // refresh snapshot
      } else {
        setTestModeErr(payload.error ?? 'Activation failed');
      }
    } catch { setTestModeErr('Network error'); }
    finally { setTestModeActivating(false); }
  };

  return (
    <section style={{
      margin: '0.75rem 0 0',
      background: 'rgba(15,17,26,0.4)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: '0.75rem',
      overflow: 'hidden',
    }}>
      {/* ── Section header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0.75rem 1.25rem',
        borderBottom: expanded ? '1px solid rgba(255,255,255,0.06)' : 'none',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <h2 style={{ margin: 0, fontSize: '0.88rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Crypto 5-Min
            </h2>
            {loading && <span style={{ fontSize: '0.65rem', color: 'rgba(248,250,252,0.3)' }}>Loading…</span>}
          </div>
          <p style={{ margin: '0.1rem 0 0', fontSize: '0.68rem', color: 'rgba(248,250,252,0.35)' }}>
            Fast-cycle crypto prediction trading with controlled entries and automatic resolution tracking.
          </p>
        </div>
        <button
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(248,250,252,0.4)', fontSize: '0.8rem', padding: '0.25rem 0.5rem' }}
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? 'Collapse' : 'Expand'}
        >{expanded ? '▲' : '▼'}</button>
      </div>

      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', padding: '1rem 1.25rem' }}>

          {/* ── BTC — full-width primary strategy panel ── */}
          <BtcCard
            settings={settings}
            metrics={metrics}
            saving={saving}
            saveErr={saveErr}
            saveOk={saveOk}
            onSave={handleSave}
            onToggleMode={handleToggleMode}
            lateSettings={lateSettings}
            onToggleLate={handleToggleLate}
            lateToggling={lateToggling}
            lateDone={lateDone}
            lateErr={lateErr}
            marketStatus={marketStatus}
            onActivateTestMode={handleActivateTestMode}
            testModeActivating={testModeActivating}
            testModeDone={testModeDone}
            testModeErr={testModeErr}
            lateStat={lateStat}
            lastFetchedAt={lastFetchedAt}
            onSaveLateSize={handleSaveLateSize}
            saveLateSize={saveLateSize}
            saveLateSizeOk={saveLateSizeOk}
            saveLateSizeErr={saveLateSizeErr}
          />

          {/* ── ETH / SOL / XRP — active paper bot cards ── */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '0.75rem',
          }}>
            {(['ETH', 'SOL', 'XRP'] as const).map((asset) => (
              <CryptoAssetPaperCard
                key={asset}
                asset={asset}
                allBotStats={allBotStats}
              />
            ))}
          </div>

        </div>
      )}
    </section>
  );
}
