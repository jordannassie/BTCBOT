'use client';

// CryptoBotDetails — expanded detail panel shown below the four-column card grid.
//
// Displayed when the user selects a card (BTC by default).
// Uses one shared component for all four assets — only asset data differs.
//
// Shows:
//   - Full performance stats
//   - Full equity chart (larger)
//   - Latest trade
//   - Recent trades table (last 10)
//   - Trade size input + save
//
// Data flows from CryptoBotSection (parent) as props. No direct API calls here,
// except for the trade-size save which needs to write to:
//   POST /api/btc-5m-late       — for BTC
//   POST /api/crypto-5m         — for ETH/SOL/XRP

import { useCallback, useState } from 'react';
import CryptoEquityChart          from './CryptoEquityChart';
import { ASSET_META, type AssetKey, type BotData, type RecentTrade } from './CryptoBotCard';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtUsd(v: number | null | undefined, digits = 2): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: digits,
  }).format(n);
}

function pnlColor(v: number) {
  if (v > 0) return '#34d399';
  if (v < 0) return '#f87171';
  return 'rgba(248,250,252,0.5)';
}

function pnlStr(v: number) {
  return `${v >= 0 ? '+' : ''}${fmtUsd(v)}`;
}

function winRatePct(wins: number, losses: number) {
  const d = wins + losses;
  return d === 0 ? '—' : `${((wins / d) * 100).toFixed(1)}%`;
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// ── Props ──────────────────────────────────────────────────────────────────────

type Props = {
  asset:    AssetKey;
  bot:      BotData | null;
  onToggle: (enable: boolean) => void;
  onReload: () => void;
};

// ── Component ──────────────────────────────────────────────────────────────────

export default function CryptoBotDetails({ asset, bot, onToggle, onReload }: Props) {
  const meta   = ASSET_META[asset];
  const s      = bot?.stats;
  const isOn   = bot?.is_enabled ?? false;
  const curve  = bot?.equity_curve ?? [];

  // ── Trade size save ──────────────────────────────────────────────────────
  const [tradeSize,    setTradeSize]    = useState('');
  const [savingSize,   setSavingSize]   = useState(false);
  const [saveSizeOk,   setSaveSizeOk]   = useState(false);
  const [saveSizeErr,  setSaveSizeErr]  = useState<string | null>(null);

  const handleSaveSize = useCallback(async () => {
    const size = parseFloat(tradeSize);
    if (!Number.isFinite(size) || size <= 0) {
      setSaveSizeErr('Enter a valid positive amount');
      return;
    }
    setSavingSize(true); setSaveSizeOk(false); setSaveSizeErr(null);
    try {
      let res: Response;
      if (meta.isBtc) {
        res = await fetch('/api/btc-5m-late', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trade_size_usd: size }),
          cache: 'no-store',
        });
      } else {
        res = await fetch('/api/crypto-5m', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bot_id: meta.botId, trade_size_usd: size }),
          cache: 'no-store',
        });
      }
      const json = await res.json() as { ok: boolean; error?: string };
      if (json.ok) {
        setSaveSizeOk(true);
        setTradeSize('');
        onReload();
        setTimeout(() => setSaveSizeOk(false), 3000);
      } else {
        setSaveSizeErr(json.error ?? 'Save failed');
      }
    } catch {
      setSaveSizeErr('Network error');
    } finally {
      setSavingSize(false);
    }
  }, [tradeSize, meta, onReload]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{
      background:   'rgba(15,17,26,0.65)',
      border:       `1px solid ${meta.color}25`,
      borderRadius: '0.85rem',
      padding:      '1.5rem',
      display:      'flex',
      flexDirection:'column',
      gap:          '1.25rem',
      position:     'relative',
      overflow:     'hidden',
    }}>
      {/* Background accent */}
      <div style={{
        position: 'absolute', top: 0, left: 0,
        width: '100%', height: 4,
        background: `linear-gradient(90deg, ${meta.color}60, transparent)`,
        pointerEvents: 'none',
      }} />

      {/* ── Detail header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <img
            src={meta.imgUrl}
            alt={meta.imgAlt}
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
            style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', border: `2px solid ${meta.color}45`, flexShrink: 0 }}
          />
          <div>
            <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#f8fafc', letterSpacing: '0.03em' }}>
              {meta.label} — Bot Details
            </div>
            <div style={{ fontSize: '0.62rem', color: 'rgba(248,250,252,0.3)', marginTop: '0.05rem' }}>
              {meta.botId} · PAPER · {bot ? (isOn ? 'ACTIVE' : 'OFF') : 'Loading…'}
            </div>
          </div>
        </div>

        {/* Toggle in details */}
        <button
          onClick={() => onToggle(!isOn)}
          disabled={!bot}
          style={{
            padding:      '0.35rem 1rem',
            borderRadius: '0.45rem',
            fontSize:     '0.72rem',
            fontWeight:   700,
            cursor:       !bot ? 'not-allowed' : 'pointer',
            background:   isOn ? `${meta.color}15` : 'rgba(255,255,255,0.05)',
            border:       `1px solid ${isOn ? `${meta.color}40` : 'rgba(255,255,255,0.12)'}`,
            color:        isOn ? meta.color : 'rgba(248,250,252,0.4)',
          }}
        >
          {isOn ? '● Turn Off' : '○ Turn On'}
        </button>
      </div>

      {/* ── Full stats grid ── */}
      {s ? (
        <div style={{
          display:             'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap:                 '0.5rem',
        }}>
          {[
            { label: 'Today P/L',      val: pnlStr(s.today_pnl),               color: pnlColor(s.today_pnl) },
            { label: 'All-time P/L',   val: pnlStr(s.all_time_pnl),            color: pnlColor(s.all_time_pnl) },
            { label: 'Today Trades',   val: String(s.trades_today),             color: undefined },
            { label: 'Total Trades',   val: String(s.total_trades),             color: undefined },
            { label: 'Open Positions', val: String(s.open_trades),              color: s.open_trades > 0 ? '#fbbf24' : undefined },
            { label: 'Open Exposure',  val: fmtUsd(s.open_exposure_usd),        color: undefined },
            { label: 'Win Rate',       val: winRatePct(s.wins, s.losses),       color: undefined },
            { label: 'Wins / Losses',  val: `${s.wins}W / ${s.losses}L`,        color: undefined },
          ].map(({ label, val, color }) => (
            <div key={label} style={{
              background:   'rgba(255,255,255,0.03)',
              border:       '1px solid rgba(255,255,255,0.06)',
              borderRadius: '0.5rem',
              padding:      '0.55rem 0.7rem',
            }}>
              <div style={{ fontSize: '0.58rem', color: 'rgba(248,250,252,0.3)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.25rem' }}>
                {label}
              </div>
              <div style={{ fontSize: '0.88rem', fontWeight: 700, color: color ?? '#f8fafc', fontFamily: 'monospace' }}>
                {val}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ textAlign: 'center', color: 'rgba(248,250,252,0.2)', fontSize: '0.75rem', padding: '1rem' }}>
          Loading stats…
        </div>
      )}

      {/* ── Full equity chart ── */}
      <div>
        <div style={{
          fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.07em',
          textTransform: 'uppercase', color: 'rgba(248,250,252,0.3)',
          marginBottom: '0.5rem',
        }}>
          {asset} Performance Equity Curve
        </div>
        <CryptoEquityChart
          asset={asset}
          curve={curve}
          startingBalance={bot?.starting_balance ?? 1000}
          accentColor={meta.color}
          compact={false}
        />
      </div>

      {/* ── Latest trade ── */}
      {bot?.latest_trade && (
        <LatestTradeRow trade={bot.latest_trade} meta={meta} />
      )}

      {/* ── Recent trades table ── */}
      {(bot?.recent_trades?.length ?? 0) > 0 && (
        <RecentTradesTable trades={bot!.recent_trades.slice(0, 10)} meta={meta} />
      )}

      {/* ── Trade size save ── */}
      <div style={{
        borderTop:   '1px solid rgba(255,255,255,0.06)',
        paddingTop:  '0.75rem',
        display:     'flex',
        flexDirection: 'column',
        gap:         '0.4rem',
      }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'rgba(248,250,252,0.3)' }}>
          Trade Settings
        </div>
        <div style={{ fontSize: '0.72rem', color: 'rgba(248,250,252,0.4)', marginBottom: '0.2rem' }}>
          Saved trade size: <span style={{ color: '#f8fafc', fontWeight: 700, fontFamily: 'monospace' }}>
            {bot ? fmtUsd(bot.trade_size_usd) : '—'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="number"
            value={tradeSize}
            onChange={(e) => { setTradeSize(e.target.value); setSaveSizeErr(null); setSaveSizeOk(false); }}
            placeholder={bot ? String(bot.trade_size_usd) : '10.00'}
            step="0.01" min="0.01"
            style={{
              flex: '1 1 120px', maxWidth: 180,
              padding: '0.4rem 0.6rem',
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '0.4rem', color: '#f8fafc', fontSize: '0.82rem', fontFamily: 'monospace',
              outline: 'none',
            }}
          />
          <button
            onClick={handleSaveSize}
            disabled={savingSize || !bot || !tradeSize}
            style={{
              padding:      '0.4rem 0.9rem',
              borderRadius: '0.4rem',
              fontSize:     '0.72rem',
              fontWeight:   700,
              cursor:       savingSize || !bot || !tradeSize ? 'not-allowed' : 'pointer',
              background:   saveSizeOk ? 'rgba(52,211,153,0.15)' : `${meta.color}15`,
              border:       `1px solid ${saveSizeOk ? 'rgba(52,211,153,0.4)' : `${meta.color}40`}`,
              color:        saveSizeOk ? '#34d399' : meta.color,
              opacity:      !bot || !tradeSize ? 0.5 : 1,
            }}
          >
            {savingSize ? 'Saving…' : saveSizeOk ? '✓ Saved' : 'Save Size'}
          </button>
        </div>
        {saveSizeErr && (
          <div style={{ fontSize: '0.68rem', color: '#f87171' }}>✗ {saveSizeErr}</div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

// ── Sub-components can call the top-level fmtUsd defined above ────────────────

function LatestTradeRow({ trade, meta }: { trade: RecentTrade; meta: (typeof ASSET_META)[AssetKey] }) {
  const pnl    = Number(trade.pnl_usd ?? 0);
  const isOpen = (trade.status ?? '').toUpperCase() === 'OPEN';

  return (
    <div style={{
      borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.75rem',
      display: 'flex', flexDirection: 'column', gap: '0.35rem',
    }}>
      <div style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'rgba(248,250,252,0.3)' }}>
        Latest Trade
      </div>
      <div style={{
        display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center',
        background: 'rgba(255,255,255,0.02)', borderRadius: '0.5rem',
        border: '1px solid rgba(255,255,255,0.06)', padding: '0.55rem 0.75rem',
        fontSize: '0.72rem',
      }}>
        <span style={{ color: 'rgba(248,250,252,0.4)' }}>
          {trade.start_ts ? new Date(trade.start_ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
        </span>
        {trade.slug && (
          <a
            href={`https://polymarket.com/market/${trade.slug}`}
            target="_blank" rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{ color: meta.color, fontSize: '0.65rem', textDecoration: 'none' }}
          >
            {trade.slug.slice(-10)} ↗
          </a>
        )}
        {trade.side && (
          <span style={{
            padding: '0.1rem 0.45rem', borderRadius: '0.3rem', fontSize: '0.65rem', fontWeight: 700,
            background: trade.side === 'UP' ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.12)',
            border: `1px solid ${trade.side === 'UP' ? 'rgba(52,211,153,0.3)' : 'rgba(248,113,113,0.3)'}`,
            color: trade.side === 'UP' ? '#34d399' : '#f87171',
          }}>
            {trade.side}
          </span>
        )}
        <span style={{ color: 'rgba(248,250,252,0.5)' }}>
          Size: <span style={{ color: '#f8fafc', fontWeight: 600, fontFamily: 'monospace' }}>{fmtUsd(trade.size_usd ?? 0)}</span>
        </span>
        {!isOpen && (
          <span style={{ color: (trade.pnl_usd ?? 0) >= 0 ? '#34d399' : '#f87171', fontWeight: 700, fontFamily: 'monospace' }}>
            P/L: {pnl >= 0 ? '+' : ''}{fmtUsd(pnl)}
          </span>
        )}
        <span style={{
          padding: '0.1rem 0.45rem', borderRadius: '0.3rem', fontSize: '0.65rem', fontWeight: 700,
          background: isOpen ? 'rgba(251,191,36,0.1)' : trade.result === 'WIN' ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)',
          color: isOpen ? '#fbbf24' : trade.result === 'WIN' ? '#34d399' : '#f87171',
        }}>
          {trade.result ?? '—'}
        </span>
      </div>
    </div>
  );
}

function RecentTradesTable({ trades, meta }: { trades: RecentTrade[]; meta: (typeof ASSET_META)[AssetKey] }) {
  return (
    <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.75rem' }}>
      <div style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'rgba(248,250,252,0.3)', marginBottom: '0.5rem' }}>
        Recent Trades
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
        {/* Header */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1.4fr 0.7fr 0.7fr 0.9fr 0.9fr 0.7fr',
          gap: '0.4rem', padding: '0.25rem 0.5rem',
          fontSize: '0.58rem', color: 'rgba(248,250,252,0.3)',
          textTransform: 'uppercase', letterSpacing: '0.07em',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}>
          <span>Time</span>
          <span>Side</span>
          <span>Size</span>
          <span>P/L</span>
          <span>Equity</span>
          <span>Result</span>
        </div>
        {trades.map((t, i) => {
          const isOpen = (t.status ?? '').toUpperCase() === 'OPEN';
          const pnl = Number(t.pnl_usd ?? 0);
          return (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '1.4fr 0.7fr 0.7fr 0.9fr 0.9fr 0.7fr',
              gap: '0.4rem', padding: '0.25rem 0.5rem',
              fontSize: '0.65rem',
              background: i % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'transparent',
              borderRadius: '0.3rem',
              alignItems: 'center',
            }}>
              <span style={{ color: 'rgba(248,250,252,0.4)', fontFamily: 'monospace', fontSize: '0.6rem' }}>
                {t.start_ts ? new Date(t.start_ts).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
              </span>
              <span style={{
                fontWeight: 600, fontSize: '0.62rem',
                color: t.side === 'UP' ? '#34d399' : t.side === 'DOWN' ? '#f87171' : 'rgba(248,250,252,0.4)',
              }}>
                {t.side ?? '—'}
              </span>
              <span style={{ fontFamily: 'monospace', color: 'rgba(248,250,252,0.7)' }}>
                ${Number(t.size_usd ?? 0).toFixed(2)}
              </span>
              <span style={{ fontFamily: 'monospace', color: isOpen ? '#fbbf24' : pnl >= 0 ? '#34d399' : '#f87171', fontWeight: 600 }}>
                {isOpen ? 'OPEN' : `${pnl >= 0 ? '+' : ''}$${Math.abs(pnl).toFixed(2)}`}
              </span>
              <span style={{ fontFamily: 'monospace', color: 'rgba(248,250,252,0.5)', fontSize: '0.6rem' }}>
                {t.equity_after != null ? `$${Number(t.equity_after).toFixed(2)}` : '—'}
              </span>
              <span style={{
                fontSize: '0.6rem', fontWeight: 600,
                color: t.result === 'WIN' ? '#34d399' : t.result === 'LOSS' ? '#f87171' : t.result === 'OPEN' ? '#fbbf24' : 'rgba(248,250,252,0.4)',
              }}>
                {t.result ?? '—'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
