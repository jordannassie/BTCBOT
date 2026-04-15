'use client';

import { useCallback, useEffect, useState } from 'react';

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
  walletCount: number;          // alias for walletsActive (legacy compat)
  walletsActive: number;        // tracked_wallets WHERE is_active = true
  walletsTotal: number;         // tracked_wallets all rows
  activeBotCount: number;       // copy_bots WHERE is_enabled = true
  botsTotal: number;            // copy_bots all rows
  openPositionCount: number;    // copied_positions WHERE status = 'OPEN'
  openExposure: number;         // SUM(size) WHERE status = 'OPEN'
  avgOpenSize: number;          // openExposure / openPositionCount
  largestOpenPosition: number;  // MAX(size) WHERE status = 'OPEN'
  attemptsTodayCount: number;   // copy_attempts since midnight UTC today
  settings: Settings | null;
  fetchedAt?: string;           // ISO timestamp from server
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

// ─── Component ─────────────────────────────────────────────────────────────────

export default function CopyOverviewCards() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Client-side timestamp when we last received a successful response
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  // Used to force re-render of the "X ago" string every second
  const [, setTick] = useState(0);

  const fetchSummary = useCallback(async () => {
    try {
      const r = await fetch('/api/copy/summary', { cache: 'no-store' });
      const payload = await r.json();
      if (payload.ok) {
        setData(payload as Overview);
        setLastUpdated(new Date());
        setError(null);
      } else {
        setError(payload.error ?? 'Failed to load summary');
      }
    } catch {
      setError('Network error loading summary');
    }
  }, []);

  const handleManualRefresh = async () => {
    setRefreshing(true);
    await fetchSummary();
    setRefreshing(false);
  };

  useEffect(() => {
    // Initial fetch
    fetchSummary();

    // Poll every 15 s so counts stay fresh while the worker updates Supabase
    const poll = setInterval(fetchSummary, POLL_MS);

    // Re-fetch whenever the browser tab regains focus
    const onVisible = () => { if (!document.hidden) fetchSummary(); };
    document.addEventListener('visibilitychange', onVisible);

    // Tick every second to keep "X ago" fresh without re-fetching
    const ticker = setInterval(() => setTick((n) => n + 1), 1000);

    return () => {
      clearInterval(poll);
      clearInterval(ticker);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchSummary]);

  if (error) {
    return (
      <div className="copy-section" style={{ padding: '1rem 1.5rem' }}>
        <p style={{ fontSize: '0.82rem', color: '#ef4444', margin: 0 }}>{error}</p>
        <button className="copy-btn copy-btn-secondary copy-btn-sm" style={{ marginTop: '0.5rem' }} onClick={handleManualRefresh}>
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

  const walletsActive = data.walletsActive ?? data.walletCount;
  const walletsTotal  = data.walletsTotal ?? walletsActive;
  const botsEnabled   = data.activeBotCount;
  const botsTotal     = data.botsTotal ?? botsEnabled;

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

        {/* ── Copy Bots — show enabled / total when they differ ── */}
        <div className="copy-stat-card">
          <div className="copy-stat-header">
            <div className="copy-stat-icon"><IconBot /></div>
            <span className="copy-stat-label">Copy Bots</span>
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
            {botsTotal > botsEnabled
              ? `${botsEnabled} enabled · ${botsTotal} total`
              : 'All bots are enabled'}
          </div>
        </div>

        {/* ── Open Positions — OPEN status only, never closed/cancelled ── */}
        <div className="copy-stat-card">
          <div className="copy-stat-header">
            <div className="copy-stat-icon"><IconPosition /></div>
            <span className="copy-stat-label">Open Positions</span>
          </div>
          <div className="copy-stat-value">{data.openPositionCount}</div>
          <div className="copy-stat-helper">
            <span className="copy-stat-badge copy-stat-badge-open">OPEN</span>
            {' '}status only · not closed or cancelled
          </div>
        </div>

        {/* ── Open Exposure — SUM(size) WHERE status = 'OPEN' ── */}
        <div className="copy-stat-card">
          <div className="copy-stat-header">
            <div className="copy-stat-icon"><IconDollar /></div>
            <span className="copy-stat-label">Open Exposure</span>
          </div>
          <div className="copy-stat-value">{fmtUsd(data.openExposure ?? 0)}</div>
          <div className="copy-stat-helper">
            SUM(size) across{' '}
            <span className="copy-stat-badge copy-stat-badge-open">OPEN</span>
            {' '}positions
          </div>
        </div>

        {/* ── Avg Open Size — openExposure / openPositionCount ── */}
        <div className="copy-stat-card">
          <div className="copy-stat-header">
            <div className="copy-stat-icon"><IconDollar /></div>
            <span className="copy-stat-label">Avg Open Size</span>
          </div>
          <div className="copy-stat-value">{fmtUsd(data.avgOpenSize ?? 0)}</div>
          <div className="copy-stat-helper">
            {data.openPositionCount > 0
              ? `Avg of ${data.openPositionCount} open position${data.openPositionCount !== 1 ? 's' : ''}`
              : 'No open positions'}
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

        {/* ── Live On ── */}
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
          <div className="copy-stat-helper">{liveOn ? 'Master gate is active' : 'Master gate is closed'}</div>
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

      {/* ── Last updated footer ── */}
      <div className="copy-overview-footer">
        <span className="copy-overview-freshness">
          {lastUpdated
            ? <>Updated {fmtAge(lastUpdated.toISOString())} · refreshes every 15s</>
            : 'Loading…'}
        </span>
        <button
          className="copy-overview-refresh-btn"
          onClick={handleManualRefresh}
          disabled={refreshing}
          title="Refresh now"
          aria-label="Refresh summary"
        >
          <IconRefresh />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
    </>
  );
}
