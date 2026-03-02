'use client';

import type { DashboardStats } from '@/lib/botData';
import ProfitLossCard from './ProfitLossCard';

type ProfileCardsProps = {
  stats: DashboardStats;
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);

export default function ProfileCards({ stats }: ProfileCardsProps) {
  const mode = stats.settings?.mode ?? 'PAPER';
  const enabled = stats.settings?.is_enabled ?? false;

  return (
    <section className="profile-grid">
      <article className="profile-card summary-card">
        <header className="summary-header">
          <div>
            <p className="summary-eyebrow">Operator</p>
            <h2 className="profile-name">default</h2>
          </div>
          <span className={`status-pill ${enabled ? 'status-pill--active' : ''}`}>
            {enabled ? 'Enabled' : 'Paused'}
          </span>
        </header>

        <div className="summary-body">
          <div className="summary-metric">
            <p>Positions value</p>
            <strong>{formatCurrency(stats.positionsValue)}</strong>
          </div>
          <div className="summary-metric">
            <p>Trades (30d)</p>
            <strong>{stats.tradesLast30Days.toLocaleString()}</strong>
          </div>
          <div className="summary-metric">
            <p>Total trades</p>
            <strong>{stats.totalTrades.toLocaleString()}</strong>
          </div>
        </div>

        <footer className="summary-meta">
          <div>
            <p>Mode</p>
            <strong>{mode}</strong>
          </div>
          <div>
            <p>Heartbeat</p>
            <strong>{stats.heartbeat?.status ?? '—'}</strong>
          </div>
        </footer>
      </article>

      <ProfitLossCard paperBalance={stats.settings?.paper_balance_usd ?? 0} />
    </section>
  );
}
