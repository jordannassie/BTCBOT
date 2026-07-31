'use client';

import { useCallback, useEffect, useState } from 'react';
import SourceAvatar from './SourceAvatar';

// ─── Types ─────────────────────────────────────────────────────────────────────

type Settings = {
  live_on: boolean;
  emergency_stop: boolean;
  max_total_live_exposure: number;
  default_slippage_cap: number;
  default_position_size: number;
  default_max_positions: number;
};

type Overview = {
  walletCount: number;              // alias for walletsActive (legacy compat)
  walletsActive: number;            // tracked_wallets WHERE is_active = true
  walletsTotal: number;             // tracked_wallets all rows
  activeBotCount: number;           // copy_bots WHERE is_enabled = true (Active Trading Bots)
  botsTotal: number;                // copy_bots all rows
  paperBotsEnabled: number;         // enabled bots in PAPER mode
  armLiveBotsCount: number;         // enabled bots with arm_live = true
  liveActiveNow: number;            // ARM LIVE bots that can fire (live_on gate must be open)
  activeCryptoBotCount?: number;    // bot_settings WHERE is_enabled = true AND bot_id IN ('btc_5m_late')
  // ── Overall totals (PAPER + LIVE combined) ──────────────────────────────────
  openPositionCount: number;        // copy_open_position_stats RPC: COUNT all OPEN
  openExposure: number;             // copy_open_position_stats RPC: SUM(size) all OPEN
  avgOpenSize: number;              // copy_open_position_stats RPC: AVG(size) all OPEN
  largestOpenPosition: number;      // copy_open_position_stats RPC: MAX(size) all OPEN
  // ── Per-mode splits (copy_open_exposure_by_mode RPC) — copy trading only ───
  paperPositionCount: number;       // PAPER mode OPEN count (copied_positions)
  paperExposure: number;            // PAPER mode SUM(size) (copied_positions)
  paperAvgSize: number;             // PAPER mode AVG(size) (copied_positions)
  livePositionCount: number;        // LIVE mode OPEN count
  liveExposure: number;             // LIVE mode SUM(size)
  liveAvgSize: number;              // LIVE mode AVG(size)
  // ── Crypto paper exposure (paper_positions WHERE bot_id = 'btc_5m_late') ───
  cryptoPaperPositionCount?: number; // open paper_positions for btc_5m_late
  cryptoPaperExposure?: number;      // SUM(trade_size_usd) for those positions
  // ── Trade counts today (distinct from attempt counts) ───────────────────────
  copyTradesToday?: number;          // copied_positions opened since midnight UTC
  cryptoTradesToday?: number;        // paper_positions (btc_5m_late) opened since midnight UTC
  // ───────────────────────────────────────────────────────────────────────────
  attemptsTodayCount: number;       // copy_attempts since midnight UTC today
  // Phase 3 — recent closed positions (last 24 h)
  recentClosedCount?: number;       // CLOSED copied_positions in last 24 h
  recentAvgPnl?: number | null;     // average P/L across those closes
  settings: Settings | null;
  fetchedAt?: string;               // ISO timestamp from server
};

const POLL_MS = 15_000; // refresh every 15 seconds

// ─── Icons ─────────────────────────────────────────────────────────────────────

function IconWallet() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/>
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/>
      <path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>
    </svg>
  );
}

function IconBot() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="10" rx="2"/>
      <circle cx="12" cy="5" r="2"/>
      <path d="M12 7v4"/>
      <line x1="8" y1="16" x2="8" y2="16"/>
      <line x1="16" y1="16" x2="16" y2="16"/>
    </svg>
  );
}

function IconPosition() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
      <polyline points="16 7 22 7 22 13"/>
    </svg>
  );
}

function IconActivity() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  );
}

function IconLive() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  );
}

function IconAlert() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/>
      <line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  );
}

function IconDollar() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23"/>
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
    </svg>
  );
}

function IconRefresh() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10"/>
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
    </svg>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmtAge(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 5)  return 'just now';
  if (diff < 60) return `${diff}s ago`;
  return `${Math.floor(diff / 60)}m ago`;
}

function fmtUsd(value: number): string {
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}k`;
  return `$${value.toFixed(2)}`;
}

function SkeletonCard() {
  return (
    <div className="copy-stat-card" style={{ opacity: 0.4 }}>
      <div className="copy-stat-header">
        <div className="copy-stat-icon" style={{ width: 32, height: 32, background: 'rgba(255,255,255,0.04)', borderRadius: 8 }} />
      </div>
      <div style={{ height: 36, width: '60%', background: 'rgba(255,255,255,0.05)', borderRadius: 6 }} />
      <div style={{ height: 12, width: '80%', background: 'rgba(255,255,255,0.03)', borderRadius: 4 }} />
    </div>
  );
}

// ─── BTC stats type (from /api/crypto/bots) ────────────────────────────────────

type BtcOverviewStats = {
  total_trades:  number;
  trades_today:  number;
  open_trades:   number;
  closed_trades: number;
  wins:          number;
  losses:        number;
  win_rate:      number;
  all_time_pnl:  number;
  today_pnl:     number;
};

type BtcBalance = {
  starting_balance:  number;
  realized_pnl:      number;
  open_exposure:     number;
  available_balance: number;
  account_equity:    number;
  trade_size_usd:    number;
};

// ─── Component ─────────────────────────────────────────────────────────────────

export default function CopyOverviewCards() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [btcStats,   setBtcStats]   = useState<BtcOverviewStats | null>(null);
  const [btcBalance, setBtcBalance] = useState<BtcBalance | null>(null);

  const fetchSummary = useCallback(async () => {
    try {
      const [summaryRes, cryptoBotsRes] = await Promise.all([
        fetch('/api/copy/summary', { cache: 'no-store' }),
        fetch('/api/crypto/bots',  { cache: 'no-store' }),
      ]);
      const payload = await summaryRes.json();
      if (payload.ok) {
        setData(payload as Overview);
        setError(null);
      } else {
        setError(payload.error ?? 'Failed to load summary');
      }
      // Extract BTC stats from the first bot (btc_5m_late only)
      try {
        const cryptoJson = await cryptoBotsRes.json() as { ok: boolean; bots?: (BtcBalance & { stats?: BtcOverviewStats })[] };
        if (cryptoJson.ok && cryptoJson.bots?.length) {
          const bot = cryptoJson.bots[0];
          if (bot.stats) setBtcStats(bot.stats);
          setBtcBalance({
            starting_balance:  bot.starting_balance  ?? 0,
            realized_pnl:      bot.realized_pnl      ?? 0,
            open_exposure:     bot.open_exposure      ?? 0,
            available_balance: bot.available_balance  ?? 0,
            account_equity:    bot.account_equity     ?? 0,
            trade_size_usd:    bot.trade_size_usd     ?? 0,
          });
        }
      } catch { /* non-blocking */ }
    } catch {
      setError('Network error loading summary');
    }
  }, []);

  useEffect(() => {
    // Initial fetch
    fetchSummary();

    // Poll every 15 s so counts stay fresh while the worker updates Supabase
    const poll = setInterval(fetchSummary, POLL_MS);

    // Re-fetch whenever the browser tab regains focus
    const onVisible = () => { if (!document.hidden) fetchSummary(); };
    document.addEventListener('visibilitychange', onVisible);

    // Immediately re-fetch when a Paper Restart completes so the Open Positions
    // and Total Open Exposure cards reflect zero without waiting for the next poll.
    const onPaperReset = () => fetchSummary();
    window.addEventListener('copy:paper-reset', onPaperReset);

    // Re-fetch when the page-level Refresh button is clicked
    const onRefresh = () => fetchSummary();
    window.addEventListener('copy:refresh', onRefresh);

    return () => {
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('copy:paper-reset', onPaperReset);
      window.removeEventListener('copy:refresh', onRefresh);
    };
  }, [fetchSummary]);

  if (error) {
    return (
      <div className="copy-section" style={{ padding: '1rem 1.5rem' }}>
        <p style={{ fontSize: '0.82rem', color: '#ef4444', margin: 0 }}>{error}</p>
        <button className="copy-btn copy-btn-secondary copy-btn-sm" style={{ marginTop: '0.5rem' }} onClick={fetchSummary}>
          Retry
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="copy-overview-grid">
        {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
    );
  }

  const liveOn        = data.settings?.live_on ?? false;
  const emergencyStop = data.settings?.emergency_stop ?? false;

  const walletsActive    = data.walletsActive ?? data.walletCount;
  const walletsTotal     = data.walletsTotal ?? walletsActive;
  const botsEnabled      = data.activeBotCount;               // copy-trader bots enabled
  const botsTotal        = data.botsTotal ?? botsEnabled;
  const armLiveBots      = data.armLiveBotsCount ?? 0;
  const liveActiveNow    = data.liveActiveNow ?? 0;
  const cryptoBotsActive  = data.activeCryptoBotCount ?? 0;    // btc_5m_late etc.
  const cryptoPaperCount  = data.cryptoPaperPositionCount ?? 0;
  const cryptoPaperExp    = data.cryptoPaperExposure ?? 0;
  const copyTradesToday   = data.copyTradesToday   ?? 0;
  const cryptoTradesToday = data.cryptoTradesToday ?? 0;

  return (
    <>
      <div className="copy-overview-grid">

        {/* ── Tracked Wallets ── */}
        <div className="copy-stat-card">
          <div className="copy-stat-header">
            <div className="copy-stat-icon"><IconWallet /></div>
            <span className="copy-stat-label">Tracked Wallets</span>
          </div>
          <div className="copy-stat-value">{walletsActive}</div>
          <div className="copy-stat-helper">
            Active (is_active = true)
            {walletsTotal > walletsActive && (
              <span style={{ color: 'rgba(248,250,252,0.35)', marginLeft: '0.3rem' }}>
                / {walletsTotal} total
              </span>
            )}
          </div>
        </div>

        {/* ── Active Trading Bots — copy-trader bots (copy_bots.is_enabled = true) ── */}
        <div className="copy-stat-card">
          <div className="copy-stat-header">
            <SourceAvatar sourceType="COPY_TRADER" size={28} style={{ flexShrink: 0 }} />
            <span className="copy-stat-label">Active Trading Bots</span>
          </div>
          <div className="copy-stat-value">
            {botsEnabled}
            {botsTotal > botsEnabled && (
              <span className="copy-stat-value-secondary">
                /{botsTotal}
              </span>
            )}
          </div>
          <div className="copy-stat-helper">
            Enabled copy-trader bots
            {botsTotal > botsEnabled && (
              <span style={{ color: 'rgba(248,250,252,0.35)', marginLeft: '0.3rem' }}>
                · {botsTotal} total
              </span>
            )}
            {armLiveBots > 0 && (
              <span style={{ display: 'block', marginTop: '0.2rem' }}>
                <span className="copy-stat-badge copy-stat-badge-live">ARM LIVE</span>
                {' '}{armLiveBots} bot{armLiveBots !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        {/* ── Active Crypto Bots — bot_settings.is_enabled for supported strategy IDs ── */}
        <div className="copy-stat-card">
          <div className="copy-stat-header">
            <SourceAvatar sourceType="BTC_CRYPTO" size={28} style={{ flexShrink: 0 }} />
            <span className="copy-stat-label">Active Crypto Bots</span>
          </div>
          <div className="copy-stat-value" style={{ color: cryptoBotsActive > 0 ? '#f8fafc' : 'rgba(248,250,252,0.35)' }}>
            {cryptoBotsActive}
          </div>
          <div className="copy-stat-helper">
            Enabled crypto strategy bots
            <span style={{ display: 'block', marginTop: '0.15rem', fontSize: '0.7rem', color: 'rgba(248,250,252,0.3)' }}>
              btc_5m_late {cryptoBotsActive > 0 ? '· ACTIVE' : '· OFF'}
            </span>
          </div>
        </div>

        {/* ── Copy Paper Exposure ──────────────────────────────────────────────────
             Source: copy_open_exposure_by_mode() RPC, PAPER mode row only.
             Reflects copied_positions only — NOT paper_positions (BTC strategy). ── */}
        <div className="copy-stat-card">
          <div className="copy-stat-header">
            <SourceAvatar sourceType="COPY_TRADER" size={28} style={{ flexShrink: 0 }} />
            <span className="copy-stat-label">Copy Paper Exposure</span>
          </div>
          <div className="copy-stat-value">{fmtUsd(data.paperExposure ?? 0)}</div>
          <div className="copy-stat-helper">
            <span className="copy-stat-badge copy-stat-badge-paper">COPY</span>
            {' '}·{' '}
            <span className="copy-stat-badge copy-stat-badge-open">OPEN</span>
            {' '}· {data.paperPositionCount ?? 0} position{(data.paperPositionCount ?? 0) !== 1 ? 's' : ''}
            {(data.paperAvgSize ?? 0) > 0 && (
              <span style={{ display: 'block', marginTop: '0.15rem', color: 'rgba(248,250,252,0.35)' }}>
                Avg {fmtUsd(data.paperAvgSize)}
              </span>
            )}
          </div>
        </div>

        {/* ── Crypto Paper Exposure ─────────────────────────────────────────────────
             Source: paper_positions WHERE bot_id = 'btc_5m_late' AND status = 'OPEN'
             Separate from copy paper exposure. ── */}
        <div className="copy-stat-card">
          <div className="copy-stat-header">
            <SourceAvatar sourceType="BTC_CRYPTO" size={28} style={{ flexShrink: 0 }} />
            <span className="copy-stat-label">Crypto Paper Exposure</span>
          </div>
          <div className="copy-stat-value" style={{ color: cryptoPaperExp > 0 ? '#f8fafc' : 'rgba(248,250,252,0.35)' }}>
            {fmtUsd(cryptoPaperExp)}
          </div>
          <div className="copy-stat-helper">
            <span className="copy-stat-badge copy-stat-badge-paper">BTC 5-Min</span>
            {' '}·{' '}
            <span className="copy-stat-badge copy-stat-badge-open">OPEN</span>
            {' '}· {cryptoPaperCount} position{cryptoPaperCount !== 1 ? 's' : ''}
          </div>
        </div>

        {/* ── Live Open Exposure ───────────────────────────────────────────────────
             Source: copy_open_exposure_by_mode() RPC, LIVE mode row only.
             Shows $0.00 / 0 positions when Live Trading is off. ── */}
        <div className="copy-stat-card">
          <div className="copy-stat-header">
            <div className="copy-stat-icon"><IconDollar /></div>
            <span className="copy-stat-label">Live Open Exposure</span>
          </div>
          <div className="copy-stat-value" style={{ color: (data.liveExposure ?? 0) > 0 ? '#f8fafc' : 'rgba(248,250,252,0.35)' }}>
            {fmtUsd(data.liveExposure ?? 0)}
          </div>
          <div className="copy-stat-helper">
            <span className="copy-stat-badge copy-stat-badge-live">LIVE</span>
            {' '}·{' '}
            <span className="copy-stat-badge copy-stat-badge-open">OPEN</span>
            {' '}· {data.livePositionCount ?? 0} position{(data.livePositionCount ?? 0) !== 1 ? 's' : ''}
            {(data.liveAvgSize ?? 0) > 0 && (
              <span style={{ display: 'block', marginTop: '0.15rem', color: 'rgba(248,250,252,0.35)' }}>
                Avg {fmtUsd(data.liveAvgSize)}
              </span>
            )}
          </div>
        </div>

        {/* ── Total Open Exposure ──────────────────────────────────────────────────
             Source: copy_open_position_stats() RPC = PAPER + LIVE combined.
             When LIVE = $0, Total = Paper. ── */}
        <div className="copy-stat-card">
          <div className="copy-stat-header">
            <div className="copy-stat-icon"><IconDollar /></div>
            <span className="copy-stat-label">Total Open Exposure</span>
          </div>
          <div className="copy-stat-value">{fmtUsd(data.openExposure ?? 0)}</div>
          <div className="copy-stat-helper">
            PAPER + LIVE ·{' '}
            <span className="copy-stat-badge copy-stat-badge-open">OPEN</span>
            {' '}· {data.openPositionCount} position{data.openPositionCount !== 1 ? 's' : ''}
            {(data.largestOpenPosition ?? 0) > 0 && (
              <span style={{ display: 'block', marginTop: '0.15rem', color: 'rgba(248,250,252,0.35)' }}>
                Largest: {fmtUsd(data.largestOpenPosition)}
              </span>
            )}
          </div>
        </div>

        {/* ── Attempts Today — since midnight UTC ── */}
        <div className="copy-stat-card">
          <div className="copy-stat-header">
            <div className="copy-stat-icon"><IconActivity /></div>
            <span className="copy-stat-label">Attempts Today</span>
          </div>
          <div className="copy-stat-value">{data.attemptsTodayCount}</div>
          <div className="copy-stat-helper">
            Copy decisions since midnight UTC
          </div>
        </div>

        {/* ── Copy Trades Today — positions opened since midnight UTC ── */}
        <div className="copy-stat-card">
          <div className="copy-stat-header">
            <SourceAvatar sourceType="COPY_TRADER" size={28} style={{ flexShrink: 0 }} />
            <span className="copy-stat-label">Copy Trades Today</span>
          </div>
          <div className="copy-stat-value">{copyTradesToday}</div>
          <div className="copy-stat-helper">
            <span className="copy-stat-badge copy-stat-badge-paper">COPY</span>
            {' '}positions opened since midnight UTC
          </div>
        </div>

        {/* ── Crypto Trades Today — paper_positions (btc_5m_late) opened today ── */}
        <div className="copy-stat-card">
          <div className="copy-stat-header">
            <SourceAvatar sourceType="BTC_CRYPTO" size={28} style={{ flexShrink: 0 }} />
            <span className="copy-stat-label">Crypto Trades Today</span>
          </div>
          <div className="copy-stat-value" style={{ color: cryptoTradesToday > 0 ? '#f8fafc' : 'rgba(248,250,252,0.35)' }}>
            {cryptoTradesToday}
          </div>
          <div className="copy-stat-helper">
            <span className="copy-stat-badge copy-stat-badge-paper">BTC 5-Min</span>
            {' '}paper trades opened today
          </div>
        </div>

        {/* ── BTC Performance — from /api/crypto/bots (btc_5m_late only) ── */}
        <div className="copy-stat-card">
          <div className="copy-stat-header">
            <SourceAvatar sourceType="BTC_CRYPTO" size={28} style={{ flexShrink: 0 }} />
            <span className="copy-stat-label">BTC 5-Min Performance</span>
          </div>
          <div className="copy-stat-value" style={{
            color: btcBalance && btcBalance.realized_pnl !== 0
              ? (btcBalance.realized_pnl > 0 ? '#34d399' : '#f87171')
              : 'rgba(248,250,252,0.35)',
            fontSize: '1.1rem',
          }}>
            {btcBalance
              ? `${btcBalance.account_equity >= 0 ? '' : ''}$${btcBalance.account_equity.toFixed(2)}`
              : '—'}
          </div>
          <div className="copy-stat-helper">
            {btcStats && btcBalance ? (<>
              <span className="copy-stat-badge copy-stat-badge-paper">BTC 5-Min</span>
              {' '}Account Equity
              <span style={{ display: 'block', marginTop: '0.25rem', lineHeight: 1.7, fontSize: '0.68rem' }}>
                Start: ${btcBalance.starting_balance.toFixed(2)}&nbsp;·&nbsp;
                P/L:{' '}
                <span style={{ color: btcBalance.realized_pnl > 0 ? '#34d399' : btcBalance.realized_pnl < 0 ? '#f87171' : 'inherit', fontWeight: 600 }}>
                  {btcBalance.realized_pnl >= 0 ? '+' : ''}${btcBalance.realized_pnl.toFixed(2)}
                </span>
                <br />
                Exposure: ${btcBalance.open_exposure.toFixed(2)}&nbsp;·&nbsp;
                Avail: ${btcBalance.available_balance.toFixed(2)}<br />
                Total: {btcStats.total_trades}&nbsp;·&nbsp;
                Open: {btcStats.open_trades}&nbsp;·&nbsp;
                Closed: {btcStats.closed_trades}<br />
                {btcStats.wins > 0 || btcStats.losses > 0 ? (
                  <>
                    W/L: {btcStats.wins}/{btcStats.losses}&nbsp;·&nbsp;
                    {(btcStats.win_rate * 100).toFixed(0)}% win rate
                  </>
                ) : 'No closed trades yet'}
              </span>
            </>) : 'Loading…'}
          </div>
        </div>

        {/* ── Closed Today — recent copy closes (last 24 h) ── */}
        <div className="copy-stat-card">
          <div className="copy-stat-header">
            <div className="copy-stat-icon"><IconPosition /></div>
            <span className="copy-stat-label">Closed Today</span>
          </div>
          <div className="copy-stat-value">{data.recentClosedCount ?? 0}</div>
          <div className="copy-stat-helper">
            Positions closed in last 24 h
            {(data.recentClosedCount ?? 0) > 0 && data.recentAvgPnl != null && (
              <span style={{ display: 'block', marginTop: '0.15rem' }}>
                Avg P/L:{' '}
                <span style={{
                  color: data.recentAvgPnl >= 0 ? '#34d399' : '#f87171',
                  fontWeight: 600,
                }}>
                  {data.recentAvgPnl >= 0 ? '+' : ''}${data.recentAvgPnl.toFixed(2)}
                </span>
              </span>
            )}
            {(data.recentClosedCount ?? 0) === 0 && (
              <span style={{ color: 'rgba(248,250,252,0.25)' }}> None yet</span>
            )}
          </div>
        </div>

        {/* ── Live Trading Gate + Active Bot Counts ── */}
        <div className={`copy-stat-card${liveOn ? ' copy-stat-card-live' : ''}`}>
          <div className="copy-stat-header">
            <div className="copy-stat-icon"><IconLive /></div>
            <span className="copy-stat-label">Live Trading</span>
          </div>
          <div className="copy-stat-status">
            <div className={`copy-stat-status-pill ${liveOn ? 'copy-stat-status-pill-on' : 'copy-stat-status-pill-off'}`}>
              <span className={`copy-stat-dot ${liveOn ? 'copy-stat-dot-on' : 'copy-stat-dot-off'}`} />
              {liveOn ? 'LIVE ON' : 'OFF'}
            </div>
          </div>
          <div className="copy-stat-helper">
            <span style={{ display: 'block' }}>
              Live Active Bots:{' '}
              <strong style={{ color: liveActiveNow > 0 ? '#60a5fa' : 'inherit' }}>{liveActiveNow}</strong>
            </span>
            <span style={{ display: 'block', marginTop: '0.15rem' }}>
              ARM LIVE Bots:{' '}
              <strong>{armLiveBots}</strong>
            </span>
          </div>
        </div>

        {/* ── Emergency Stop ── */}
        <div className={`copy-stat-card${emergencyStop ? ' copy-stat-card-danger' : ''}`}>
          <div className="copy-stat-header">
            <div className="copy-stat-icon"><IconAlert /></div>
            <span className="copy-stat-label">Emergency Stop</span>
          </div>
          <div className="copy-stat-status">
            <div className={`copy-stat-status-pill ${emergencyStop ? 'copy-stat-status-pill-danger' : 'copy-stat-status-pill-off'}`}>
              <span className={`copy-stat-dot ${emergencyStop ? 'copy-stat-dot-danger' : 'copy-stat-dot-off'}`} />
              {emergencyStop ? 'ACTIVE' : 'Clear'}
            </div>
          </div>
          <div className="copy-stat-helper">{emergencyStop ? 'All live orders halted' : 'No active stop'}</div>
        </div>

      </div>
    </>
  );
}
