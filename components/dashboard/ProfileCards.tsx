'use client';

import { useCallback, useEffect, useState } from 'react';
import type { BotSettings } from '@/lib/botData';
import OperatorControlsCard from './OperatorControlsCard';

const formatUSD = (value?: number | null) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value ?? 0);

type ProfileCardsProps = {
  stats: {
    positionsValue: number;
    tradesLast30Days: number;
    totalTrades: number;
    settings?: BotSettings | null;
  };
};

export default function ProfileCards({ stats }: ProfileCardsProps) {
  const [confirmedSettings, setConfirmedSettings] = useState<BotSettings | null>(stats.settings ?? null);
  const [liveBalance, setLiveBalance] = useState<number | null>(stats.settings?.live_balance_usd ?? null);
  const [liveUpdatedAt, setLiveUpdatedAt] = useState<string | null>(stats.settings?.live_updated_at ?? null);

  const loadSettings = useCallback(async () => {
    try {
      const response = await fetch('/api/bot-settings', { cache: 'no-store' });
      if (!response.ok) return;
      const payload = await response.json();
      if (payload.ok && payload.settings) {
        setConfirmedSettings(payload.settings);
      }
    } catch (error) {
      console.error('Failed to refresh operator settings', error);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const settings = confirmedSettings ?? stats.settings;
  const paperBalance = settings?.paper_balance_usd ?? 0;
  const paperPnl = settings?.paper_pnl_usd ?? 0;
  const formattedLive = formatUSD(liveBalance);
  const formattedPaper = formatUSD(paperBalance);

  useEffect(() => {
    setLiveBalance(settings?.live_balance_usd ?? null);
    setLiveUpdatedAt(settings?.live_updated_at ?? null);
  }, [settings]);

  const refreshLiveBalance = useCallback(async () => {
    try {
      await fetch('/api/live-balance', { cache: 'no-store' });
    } finally {
      await loadSettings();
    }
  }, [loadSettings]);

  useEffect(() => {
    refreshLiveBalance();
    const interval = setInterval(refreshLiveBalance, 60_000);
    return () => clearInterval(interval);
  }, [refreshLiveBalance]);

  return (
    <div className="profile-section">
      <div className="profile-card">
        <div className="profile-avatar">
          <div className="avatar-gradient"></div>
        </div>
        <div className="profile-info">
          <h2 className="profile-name">default</h2>
          <p className="profile-meta">Joined Dec 2025 · {stats.totalTrades} trades</p>
        </div>

        <div className="profile-stats">
          <div className="stat-item">
            <div className="stat-value">${stats.positionsValue > 0 ? (stats.positionsValue / 1000).toFixed(1) + 'K' : '—'}</div>
            <div className="stat-label">Positions Value</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">—</div>
            <div className="stat-label">Biggest Win</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">{stats.totalTrades.toLocaleString()}</div>
            <div className="stat-label">Predictions</div>
          </div>
        </div>
      </div>

      <div className="pnl-card">
        <div className="pnl-header">
          <div className="pnl-header-left">
            <div className="pnl-indicator">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <circle cx="6" cy="6" r="5" fill="#10b981" />
              </svg>
              <span>Profit/Loss</span>
            </div>
            <div className="pnl-tabs">
              <button className="pnl-tab active">1D</button>
              <button className="pnl-tab">1W</button>
              <button className="pnl-tab">1M</button>
              <button className="pnl-tab">ALL</button>
            </div>
          </div>
        </div>
        <div className="pnl-amount">{formattedPaper}</div>
        <div className="pnl-period">Paper Balance</div>
        <div className="balance-lines">
          <span>Live Balance (USDC): {liveBalance != null ? formattedLive : "--"}</span>
          <span>Paper Balance: {formattedPaper}</span>
          <span>
            Live Updated: {liveUpdatedAt ? new Date(liveUpdatedAt).toLocaleString() : "--"}
          </span>
        </div>
        <div className="pnl-chart">
          <svg width="100%" height="100" viewBox="0 0 400 100" preserveAspectRatio="none">
            <defs>
              <linearGradient id="chartGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d="M0,80 Q50,75 100,70 T200,50 T300,40 T400,30"
              fill="url(#chartGradient)"
              stroke="#3b82f6"
              strokeWidth="2"
            />
          </svg>
        </div>
        <div className="pnl-footer">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="2" y="2" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <span>Polymarket</span>
        </div>
      </div>

      <div className="live-card profile-card">
        <div className="pnl-indicator">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <circle cx="6" cy="6" r="5" fill="#10b981" />
          </svg>
          <span>LIVE</span>
        </div>
        <div className="live-balance">
          <div className="pnl-amount">{formattedLive}</div>
          <p className="pnl-subtext">USDC (Polygon)</p>
          <p className="pnl-subtext">
            Updated: {liveUpdatedAt ? new Date(liveUpdatedAt).toLocaleString() : "--"}
          </p>
          <button className="operator-save" onClick={refreshLiveBalance}>
            Refresh
          </button>
        </div>
      </div>
      <OperatorControlsCard />

    </div>
  );
}
