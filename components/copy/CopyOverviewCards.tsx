'use client';

import { useEffect, useState } from 'react';

type Settings = {
  live_on: boolean;
  emergency_stop: boolean;
  max_total_live_exposure: number;
  default_slippage_cap: number;
  default_position_size: number;
  default_max_positions: number;
};

type Overview = {
  walletCount: number;      // active wallets (is_active = true)
  walletsActive: number;
  walletsTotal: number;
  activeBotCount: number;
  openPositionCount: number;
  attemptsTodayCount: number;
  settings: Settings | null;
};

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

export default function CopyOverviewCards() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // /api/copy/summary: dedicated copy-trading-only endpoint.
    // Counts only is_active wallets, is_enabled bots, OPEN positions, and
    // today's copy_attempts. No legacy BTC or bot_settings data.
    fetch('/api/copy/summary', { cache: 'no-store' })
      .then((r) => r.json())
      .then((payload) => {
        if (payload.ok) setData(payload);
        else setError(payload.error ?? 'Failed to load summary');
      })
      .catch(() => setError('Network error loading summary'));
  }, []);

  if (error) {
    return (
      <div className="copy-section" style={{ padding: '1rem 1.5rem' }}>
        <p style={{ fontSize: '0.82rem', color: '#ef4444', margin: 0 }}>{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="copy-overview-grid">
        {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
    );
  }

  const liveOn = data.settings?.live_on ?? false;
  const emergencyStop = data.settings?.emergency_stop ?? false;

  return (
    <div className="copy-overview-grid">

      {/* Tracked Wallets — only active wallets count */}
      <div className="copy-stat-card">
        <div className="copy-stat-header">
          <div className="copy-stat-icon"><IconWallet /></div>
          <span className="copy-stat-label">Tracked Wallets</span>
        </div>
        <div className="copy-stat-value">{data.walletsActive ?? data.walletCount}</div>
        <div className="copy-stat-helper">
          Active wallet sources
          {data.walletsTotal > (data.walletsActive ?? data.walletCount) && (
            <span style={{ color: 'rgba(248,250,252,0.3)', marginLeft: '0.3rem' }}>
              / {data.walletsTotal} total
            </span>
          )}
        </div>
      </div>

      {/* Active Bots */}
      <div className="copy-stat-card">
        <div className="copy-stat-header">
          <div className="copy-stat-icon"><IconBot /></div>
          <span className="copy-stat-label">Active Copy Bots</span>
        </div>
        <div className="copy-stat-value">{data.activeBotCount}</div>
        <div className="copy-stat-helper">Bots currently enabled</div>
      </div>

      {/* Open Positions */}
      <div className="copy-stat-card">
        <div className="copy-stat-header">
          <div className="copy-stat-icon"><IconPosition /></div>
          <span className="copy-stat-label">Open Positions</span>
        </div>
        <div className="copy-stat-value">{data.openPositionCount}</div>
        <div className="copy-stat-helper">Copied positions open</div>
      </div>

      {/* Attempts Today */}
      <div className="copy-stat-card">
        <div className="copy-stat-header">
          <div className="copy-stat-icon"><IconActivity /></div>
          <span className="copy-stat-label">Attempts Today</span>
        </div>
        <div className="copy-stat-value">{data.attemptsTodayCount}</div>
        <div className="copy-stat-helper">Copy decisions made today</div>
      </div>

      {/* Live On */}
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

      {/* Emergency Stop */}
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
  );
}
