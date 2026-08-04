'use client';

// CryptoKPIStrip — Compact summary row of key crypto performance metrics.
//
// Data source: GET /api/crypto/bots (btc_5m_late) — same API as CryptoPaperCard.
// Polling: 5 seconds.
//
// READ-ONLY display — no writes, no trading logic.

import { useCallback, useEffect, useState } from 'react';

type BotStats = {
  total_trades:        number;
  trades_today:        number;
  open_trades:         number;
  wins:                number;
  losses:              number;
  win_rate:            number;
  open_exposure_usd:   number;
  today_pnl:           number;
  all_time_pnl:        number;
};

type CryptoBot = {
  is_enabled:       boolean;
  account_equity:   number;
  starting_balance: number;
  stats:            BotStats;
};

type ApiResponse = { ok: boolean; bots?: CryptoBot[] };

function pnlColor(v: number) {
  if (v > 0) return '#34d399';
  if (v < 0) return '#f87171';
  return 'rgba(248,250,252,0.5)';
}

function signedUsd(v: number) {
  const abs = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v >= 0 ? '+' : '-'}$${abs}`;
}

function winRatePct(wins: number, losses: number) {
  const d = wins + losses;
  if (d === 0) return '—';
  return `${((wins / d) * 100).toFixed(0)}%`;
}

type KPIItem = {
  label: string;
  value: string;
  color?: string;
  sub?:   string;
};

export default function CryptoKPIStrip() {
  const [bot, setBot] = useState<CryptoBot | null>(null);

  const load = useCallback(async () => {
    try {
      const res  = await fetch('/api/crypto/bots', { cache: 'no-store' });
      const json = await res.json() as ApiResponse;
      if (json.ok && json.bots?.length) setBot(json.bots[0]);
    } catch {}
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5_000);
    // Immediate re-fetch when paper account is reset
    const onReset = () => load();
    window.addEventListener('crypto:paper-reset', onReset);
    return () => {
      clearInterval(t);
      window.removeEventListener('crypto:paper-reset', onReset);
    };
  }, [load]);

  if (!bot) return null;

  const s = bot.stats;

  const items: KPIItem[] = [
    {
      label: 'Today P/L',
      value: s.today_pnl === 0 ? '$0.00' : signedUsd(s.today_pnl),
      color: pnlColor(s.today_pnl),
      sub:   `${s.trades_today} trade${s.trades_today !== 1 ? 's' : ''} today`,
    },
    {
      label: 'All-Time P/L',
      value: signedUsd(s.all_time_pnl),
      color: pnlColor(s.all_time_pnl),
      sub:   `${s.total_trades} total trades`,
    },
    {
      label: 'Win Rate',
      value: winRatePct(s.wins, s.losses),
      sub:   `${s.wins}W / ${s.losses}L`,
    },
    {
      label: 'Open Positions',
      value: String(s.open_trades),
      color: s.open_trades > 0 ? '#fbbf24' : undefined,
      sub:   s.open_trades > 0 ? `$${s.open_exposure_usd.toFixed(2)} exposure` : 'No open trades',
    },
    {
      label: 'Account Equity',
      value: `$${bot.account_equity.toFixed(2)}`,
      color: bot.account_equity >= bot.starting_balance ? undefined : '#f87171',
      sub:   `Start: $${bot.starting_balance.toFixed(2)}`,
    },
    {
      label: 'BTC Bot Status',
      value: bot.is_enabled ? 'ACTIVE' : 'OFF',
      color: bot.is_enabled ? '#34d399' : 'rgba(248,250,252,0.35)',
      sub:   'btc_5m_late · PAPER',
    },
  ];

  return (
    <div style={{
      display:       'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
      gap:           '0.5rem',
      padding:       '0.65rem 1rem',
      background:    'rgba(255,255,255,0.025)',
      border:        '1px solid rgba(255,255,255,0.06)',
      borderRadius:  '0.75rem',
      marginBottom:  '0.75rem',
    }}>
      {items.map(({ label, value, color, sub }) => (
        <div key={label} style={{
          display:       'flex',
          flexDirection: 'column',
          gap:           '0.12rem',
          padding:       '0.25rem 0.5rem',
          borderRight:   '1px solid rgba(255,255,255,0.05)',
        }}>
          <span style={{ fontSize: '0.59rem', color: 'rgba(248,250,252,0.3)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            {label}
          </span>
          <span style={{ fontSize: '0.9rem', fontWeight: 700, color: color ?? '#f8fafc', fontFamily: 'monospace' }}>
            {value}
          </span>
          {sub && (
            <span style={{ fontSize: '0.6rem', color: 'rgba(248,250,252,0.3)' }}>{sub}</span>
          )}
        </div>
      ))}
    </div>
  );
}
