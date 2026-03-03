'use client';

import type { BotSettings } from '@/lib/botData';

type ProfileCardsProps = {
  stats: {
    positionsValue: number;
    tradesLast30Days: number;
    totalTrades: number;
    settings?: BotSettings | null;
  };
};

export default function ProfileCards({ stats }: ProfileCardsProps) {
  return (
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
          <div className="stat-value">
            {stats.positionsValue > 0
              ? `$${(stats.positionsValue / 1000).toFixed(1)}K`
              : '—'}
          </div>
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
  );
}
