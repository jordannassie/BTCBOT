'use client';

import type { BotSettings } from '@/lib/botData';

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
  const paperBalance = stats.settings?.paper_balance_usd ?? 0;
  const paperPnl = stats.settings?.paper_pnl_usd ?? 0;

  if (process.env.NODE_ENV === 'development') {
    console.log('balance loaded', stats.settings?.paper_balance_usd, stats.settings?.paper_pnl_usd);
  }

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
        <div className="pnl-amount">{formatUSD(paperPnl)}</div>
        <div className="pnl-period">Paper Balance</div>
        <p className="pnl-subtext">{formatUSD(paperBalance)}</p>
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

    </div>
  );
}
