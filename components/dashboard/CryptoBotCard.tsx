'use client';

// CryptoBotCard — compact equal-height card for one crypto asset.
//
// Used for BTC, ETH, SOL and XRP in the four-column grid below the bankroll cards.
// All four cards use this exact same component — only asset data and accent differ.
//
// Data flows down from CryptoBotSection (parent). No individual API calls here.
// Toggle calls the onToggle callback; parent handles API + reload.
//
// Shows:
//   - Asset icon, name, mode badge, status dot
//   - ON/OFF toggle button
//   - Today P/L, All-time P/L, open trades, win rate
//   - Mini equity chart (same height for all 4)
//   - "Details" button to expand the detail panel below

import CryptoEquityChart, { type EquityPoint } from './CryptoEquityChart';

// ── Asset config ───────────────────────────────────────────────────────────────

export const ASSET_META = {
  BTC: {
    botId:  'btc_5m_late',
    label:  'BTC 5-Min',
    color:  '#f97316',
    isBtc:  true,
    imgUrl: 'https://jyhfffqximlbhlaarozs.supabase.co/storage/v1/object/public/Storage/image/Crypto/BTCfullsize.webp',
    imgAlt: 'Bitcoin',
    slugPrefix: 'btc-updown-5m-',
  },
  ETH: {
    botId:  'eth_5m_paper',
    label:  'ETH 5-Min',
    color:  '#818cf8',
    isBtc:  false,
    imgUrl: 'https://jyhfffqximlbhlaarozs.supabase.co/storage/v1/object/public/Storage/image/Crypto/ETHfullsize.webp',
    imgAlt: 'Ethereum',
    slugPrefix: 'eth-updown-5m-',
  },
  SOL: {
    botId:  'sol_5m_paper',
    label:  'SOL 5-Min',
    color:  '#a78bfa',
    isBtc:  false,
    imgUrl: 'https://jyhfffqximlbhlaarozs.supabase.co/storage/v1/object/public/Storage/image/Crypto/SOL-logo.webp',
    imgAlt: 'Solana',
    slugPrefix: 'sol-updown-5m-',
  },
  XRP: {
    botId:  'xrp_5m_paper',
    label:  'XRP 5-Min',
    color:  '#38bdf8',
    isBtc:  false,
    imgUrl: 'https://jyhfffqximlbhlaarozs.supabase.co/storage/v1/object/public/Storage/image/Crypto/XRP-logo.webp',
    imgAlt: 'XRP',
    slugPrefix: 'xrp-updown-5m-',
  },
} as const;

export type AssetKey = keyof typeof ASSET_META;

// ── Bot data type (matches /api/crypto/bots response per-bot object) ───────────

export type BotData = {
  bot_id:            string;
  name:              string;
  is_enabled:        boolean;
  mode:              string;
  trade_size_usd:    number;
  starting_balance:  number;
  realized_pnl:      number;     // shared pnl
  open_exposure:     number;     // per-bot
  available_balance: number;
  account_equity:    number;     // shared equity
  strategy_settings: Record<string, unknown>;
  stats: {
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
    all_time_pnl:        number;  // per-bot cumulative
  };
  equity_curve:  EquityPoint[];
  recent_trades: RecentTrade[];
  latest_trade:  LatestTrade | null;
};

export type RecentTrade = {
  status?:      string | null;
  start_ts?:    string | null;
  slug?:        string | null;
  side?:        string | null;
  size_usd?:    number | null;
  entry_price?: number | null;
  pnl_usd?:    number | null;
  result?:      string | null;
  equity_after?: number | null;
};

export type LatestTrade = RecentTrade;

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtUsd(v: number, digits = 2) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: digits,
  }).format(v);
}

function pnlColor(v: number) {
  if (v > 0) return '#34d399';
  if (v < 0) return '#f87171';
  return 'rgba(248,250,252,0.5)';
}

function pnlStr(v: number) {
  const abs = Math.abs(v);
  const sign = v >= 0 ? '+' : '-';
  return `${sign}$${abs.toFixed(2)}`;
}

function winRatePct(wins: number, losses: number) {
  const d = wins + losses;
  return d === 0 ? '—' : `${((wins / d) * 100).toFixed(0)}%`;
}

// ── Props ──────────────────────────────────────────────────────────────────────

type Props = {
  asset:     AssetKey;
  bot:       BotData | null;       // null while loading
  selected:  boolean;
  toggling:  boolean;
  onSelect:  () => void;
  onToggle:  (enable: boolean) => void;
};

// ── Component ──────────────────────────────────────────────────────────────────

export default function CryptoBotCard({ asset, bot, selected, toggling, onSelect, onToggle }: Props) {
  const meta   = ASSET_META[asset];
  const isOn   = bot?.is_enabled ?? false;
  const s      = bot?.stats;
  const curve  = bot?.equity_curve ?? [];

  const accentAlpha = selected ? '35' : '12';
  const borderColor = selected
    ? `${meta.color}55`
    : 'rgba(255,255,255,0.08)';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(); }}
      aria-pressed={selected}
      style={{
        background:    `rgba(15,17,26,0.7)`,
        border:        `1px solid ${borderColor}`,
        borderRadius:  '0.85rem',
        padding:       '1rem',
        display:       'flex',
        flexDirection: 'column',
        gap:           '0.6rem',
        cursor:        'pointer',
        transition:    'border-color 0.15s, box-shadow 0.15s',
        boxShadow:     selected ? `0 0 0 1px ${meta.color}30, 0 8px 24px rgba(0,0,0,0.25)` : '0 4px 12px rgba(0,0,0,0.2)',
        position:      'relative',
        overflow:      'hidden',
      }}
    >
      {/* Background accent glow */}
      <div style={{
        position:      'absolute', top: 0, right: 0,
        width:         160, height: 160, pointerEvents: 'none',
        background:    `radial-gradient(circle at top right, ${meta.color}${accentAlpha}, transparent 70%)`,
      }} />

      {/* ── Header: icon + name + status ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
          <img
            src={meta.imgUrl}
            alt={meta.imgAlt}
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
            style={{
              width: 28, height: 28, borderRadius: '50%', objectFit: 'cover',
              border: `1.5px solid ${meta.color}50`, flexShrink: 0,
            }}
          />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#f8fafc', letterSpacing: '0.03em', whiteSpace: 'nowrap' }}>
              {meta.label}
            </div>
            <div style={{ fontSize: '0.6rem', color: 'rgba(248,250,252,0.3)', marginTop: '0.05rem', whiteSpace: 'nowrap' }}>
              PAPER · {bot ? (isOn ? 'ACTIVE' : 'OFF') : '…'}
            </div>
          </div>
        </div>

        {/* Status dot */}
        <div style={{
          width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
          background: isOn ? meta.color : 'rgba(255,255,255,0.15)',
          boxShadow:  isOn ? `0 0 6px ${meta.color}80` : 'none',
        }} />
      </div>

      {/* ── Toggle button — stop propagation so click doesn't also select ── */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggle(!isOn); }}
        disabled={toggling || !bot}
        style={{
          width:        '100%',
          padding:      '0.3rem 0.75rem',
          borderRadius: '0.45rem',
          fontSize:     '0.7rem',
          fontWeight:   700,
          letterSpacing:'0.04em',
          cursor:       toggling || !bot ? 'wait' : 'pointer',
          transition:   'all 0.15s',
          background:   isOn ? `${meta.color}15` : 'rgba(255,255,255,0.05)',
          border:       `1px solid ${isOn ? `${meta.color}40` : 'rgba(255,255,255,0.1)'}`,
          color:        isOn ? meta.color : 'rgba(248,250,252,0.4)',
        }}
      >
        {toggling ? 'Updating…' : isOn ? '● Turn Off' : '○ Turn On'}
      </button>

      {/* ── Key stats ── */}
      {s ? (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.35rem',
          borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.5rem',
        }}>
          {[
            { label: 'Today P/L',     val: pnlStr(s.today_pnl),              color: pnlColor(s.today_pnl) },
            { label: 'All-time P/L',  val: pnlStr(s.all_time_pnl),           color: pnlColor(s.all_time_pnl) },
            { label: 'Open',          val: String(s.open_trades),             color: s.open_trades > 0 ? '#fbbf24' : undefined },
            { label: 'Win Rate',      val: winRatePct(s.wins, s.losses),      color: undefined },
          ].map(({ label, val, color }) => (
            <div key={label} style={{
              background:   'rgba(255,255,255,0.03)',
              border:       '1px solid rgba(255,255,255,0.05)',
              borderRadius: '0.4rem',
              padding:      '0.35rem 0.5rem',
            }}>
              <div style={{ fontSize: '0.55rem', color: 'rgba(248,250,252,0.3)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: '0.15rem' }}>
                {label}
              </div>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: color ?? '#f8fafc', fontFamily: 'monospace' }}>
                {val}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ textAlign: 'center', fontSize: '0.65rem', color: 'rgba(248,250,252,0.2)', paddingTop: '0.5rem' }}>
          Loading…
        </div>
      )}

      {/* ── Mini equity chart ── */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ marginTop: '0.1rem', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '0.5rem' }}
      >
        <div style={{ fontSize: '0.55rem', color: 'rgba(248,250,252,0.25)', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
          {asset} EQUITY CURVE
        </div>
        <CryptoEquityChart
          asset={asset}
          curve={curve}
          startingBalance={bot?.starting_balance ?? 1000}
          accentColor={meta.color}
          compact
        />
        {curve.length > 0 && (
          <div style={{ fontSize: '0.55rem', color: 'rgba(248,250,252,0.2)', textAlign: 'right', marginTop: '0.1rem' }}>
            {curve.length} settled trade{curve.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* ── Details indicator ── */}
      <div style={{
        borderTop:  '1px solid rgba(255,255,255,0.05)',
        paddingTop: '0.4rem',
        textAlign:  'center',
        fontSize:   '0.62rem',
        color:      selected ? meta.color : 'rgba(248,250,252,0.25)',
        fontWeight: selected ? 600 : 400,
        letterSpacing: '0.04em',
      }}>
        {selected ? '▲ Details open below' : 'Click for details ▼'}
      </div>
    </div>
  );
}
