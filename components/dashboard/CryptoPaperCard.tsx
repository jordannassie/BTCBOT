'use client';

// CryptoPaperCard — Large, prominent paper bankroll card for the crypto dashboard.
//
// Data source: GET /api/crypto/bots (btc_5m_late only — single confirmed source)
// Polling: 5 seconds for live equity updates.
//
// Displays: Current Equity · Starting Balance · Realized P/L · Today P/L ·
//           Open Exposure · Open Positions · Win Rate · Total Trades · Equity mini-chart
//
// This is READ-ONLY display. No trading logic, no writes, no calculations beyond display formatting.

import { useCallback, useEffect, useState } from 'react';
import BtcEquityChart, { type EquityPoint } from './BtcEquityChart';
import SourceAvatar, { BTC_AVATAR_URL } from '@/components/copy/SourceAvatar';

// ── Types ─────────────────────────────────────────────────────────────────────

type BotStats = {
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

type CryptoBot = {
  bot_id:            string;
  name:              string;
  is_enabled:        boolean;
  trade_size_usd:    number;
  starting_balance:  number;
  realized_pnl:      number;
  open_exposure:     number;
  available_balance: number;
  account_equity:    number;
  stats:             BotStats;
  equity_curve:      EquityPoint[];
};

type ApiResponse = {
  ok:    boolean;
  bots?: CryptoBot[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const usd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);

function pnlColor(v: number): string {
  if (v > 0) return '#34d399';
  if (v < 0) return '#f87171';
  return 'rgba(248,250,252,0.6)';
}

function pnlStr(v: number): string {
  return `${v >= 0 ? '+' : ''}${usd(v)}`;
}

function winRatePct(wins: number, losses: number): string {
  const d = wins + losses;
  if (d === 0) return '—';
  return `${((wins / d) * 100).toFixed(0)}%`;
}

function UpdatedAgo({ date }: { date: Date | null }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  if (!date) return <span style={{ color: 'rgba(248,250,252,0.25)', fontSize: '0.65rem' }}>Loading…</span>;
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  const label = s < 5 ? 'just now' : s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`;
  return <span style={{ color: 'rgba(248,250,252,0.25)', fontSize: '0.65rem' }}>Updated {label}</span>;
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function CryptoPaperCard() {
  const [bot,         setBot]         = useState<CryptoBot | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [fetchedAt,   setFetchedAt]   = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const res  = await fetch('/api/crypto/bots', { cache: 'no-store' });
      const json = await res.json() as ApiResponse;
      if (json.ok && json.bots?.length) {
        setBot(json.bots[0]);
        setFetchedAt(new Date());
      }
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 5_000);
    return () => clearInterval(interval);
  }, [load]);

  const s = bot?.stats;

  // Equity change direction for equity card color
  const equityDelta = bot ? bot.account_equity - bot.starting_balance : 0;

  return (
    <div className="crypto-paper-card" style={{
      flex:           1,
      minWidth:       0,
      background:     'rgba(15, 17, 26, 0.7)',
      border:         '1px solid rgba(255,255,255,0.08)',
      borderRadius:   '1rem',
      padding:        '1.5rem',
      display:        'flex',
      flexDirection:  'column',
      gap:            '1rem',
      boxShadow:      '0 8px 32px rgba(0,0,0,0.3)',
      position:       'relative',
      overflow:       'hidden',
    }}>
      {/* Background accent */}
      <div style={{
        position:   'absolute', top: 0, right: 0,
        width:      '280px', height: '280px',
        background: 'radial-gradient(circle at top right, rgba(251,146,60,0.06), transparent 70%)',
        pointerEvents: 'none',
      }} />

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <img
            src={BTC_AVATAR_URL}
            alt="BTC"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
            style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', border: '2px solid rgba(251,146,60,0.4)', flexShrink: 0 }}
          />
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#f8fafc', letterSpacing: '0.04em' }}>
              BTC Paper Account
            </div>
            <div style={{ fontSize: '0.68rem', color: 'rgba(248,250,252,0.35)', marginTop: '0.1rem' }}>
              btc_5m_late · PAPER · {bot?.is_enabled ? 'ACTIVE' : 'OFF'}
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          {bot && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
              padding: '0.2rem 0.55rem', borderRadius: '0.3rem',
              background: bot.is_enabled ? 'rgba(52,211,153,0.1)' : 'rgba(248,250,252,0.05)',
              border: `1px solid ${bot.is_enabled ? 'rgba(52,211,153,0.3)' : 'rgba(255,255,255,0.08)'}`,
              fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.06em',
              color: bot.is_enabled ? '#34d399' : 'rgba(248,250,252,0.35)',
            }}>
              {bot.is_enabled ? '● ACTIVE' : '○ OFF'}
            </div>
          )}
          <div style={{ marginTop: '0.25rem' }}><UpdatedAgo date={fetchedAt} /></div>
        </div>
      </div>

      {/* ── Hero equity number ── */}
      {loading ? (
        <div style={{ fontSize: '2.2rem', fontWeight: 800, color: 'rgba(248,250,252,0.2)', fontFamily: 'monospace' }}>
          Loading…
        </div>
      ) : bot ? (
        <div>
          <div style={{ fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(248,250,252,0.3)', marginBottom: '0.2rem' }}>
            Current Paper Equity
          </div>
          <div style={{
            fontSize: '2.6rem', fontWeight: 800, fontFamily: 'monospace',
            color: equityDelta >= 0 ? '#f8fafc' : '#f87171',
            letterSpacing: '-0.02em', lineHeight: 1,
          }}>
            {usd(bot.account_equity)}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'rgba(248,250,252,0.4)', marginTop: '0.35rem', display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            <span>Starting: <span style={{ color: 'rgba(248,250,252,0.65)' }}>{usd(bot.starting_balance)}</span></span>
            {equityDelta !== 0 && (
              <span style={{ color: pnlColor(equityDelta) }}>{pnlStr(equityDelta)} all-time</span>
            )}
          </div>
        </div>
      ) : (
        <div style={{ color: 'rgba(248,250,252,0.25)', fontSize: '0.75rem' }}>No data</div>
      )}

      {/* ── Stats grid ── */}
      {s && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.6rem',
          borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.75rem',
        }}>
          {([
            { label: 'Realized P/L',  val: pnlStr(bot!.realized_pnl),  color: pnlColor(bot!.realized_pnl) },
            { label: 'Today P/L',     val: pnlStr(s.today_pnl),         color: pnlColor(s.today_pnl) },
            { label: 'Open Exposure', val: usd(bot!.open_exposure),      color: undefined },
            { label: 'Open Positions',val: String(s.open_trades),        color: s.open_trades > 0 ? '#fbbf24' : undefined },
            { label: 'Win Rate',      val: winRatePct(s.wins, s.losses), color: undefined },
            { label: 'Total Trades',  val: String(s.total_trades),       color: undefined },
          ] as { label: string; val: string; color?: string }[]).map(({ label, val, color }) => (
            <div key={label} style={{
              background: 'rgba(255,255,255,0.03)', borderRadius: '0.5rem',
              padding: '0.5rem 0.65rem',
              border: '1px solid rgba(255,255,255,0.06)',
            }}>
              <div style={{ fontSize: '0.6rem', color: 'rgba(248,250,252,0.3)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.25rem' }}>{label}</div>
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: color ?? '#f8fafc', fontFamily: 'monospace' }}>{val}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Mini equity chart ── */}
      {bot?.equity_curve && bot.equity_curve.length > 0 && (
        <div style={{ marginTop: '-0.25rem' }}>
          <BtcEquityChart curve={bot.equity_curve} startingBalance={bot.starting_balance} />
        </div>
      )}

      {/* ── W/L breakdown ── */}
      {s && (s.wins > 0 || s.losses > 0) && (
        <div style={{
          display: 'flex', gap: '0.5rem', flexWrap: 'wrap',
          fontSize: '0.7rem', color: 'rgba(248,250,252,0.4)',
          borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.6rem',
        }}>
          <span style={{ color: '#34d399' }}>✓ {s.wins} win{s.wins !== 1 ? 's' : ''}</span>
          <span style={{ color: 'rgba(248,250,252,0.25)' }}>·</span>
          <span style={{ color: '#f87171' }}>✗ {s.losses} loss{s.losses !== 1 ? 'es' : ''}</span>
          {s.pushes > 0 && (
            <>
              <span style={{ color: 'rgba(248,250,252,0.25)' }}>·</span>
              <span>= {s.pushes} push{s.pushes !== 1 ? 'es' : ''}</span>
            </>
          )}
          {s.trades_today > 0 && (
            <>
              <span style={{ color: 'rgba(248,250,252,0.25)' }}>·</span>
              <span>{s.trades_today} trade{s.trades_today !== 1 ? 's' : ''} today</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
