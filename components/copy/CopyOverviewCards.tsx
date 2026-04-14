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
  walletCount: number;
  activeBotCount: number;
  openPositionCount: number;
  attemptsTodayCount: number;
  settings: Settings | null;
};

export default function CopyOverviewCards() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/copy/overview', { cache: 'no-store' })
      .then((r) => r.json())
      .then((payload) => {
        if (payload.ok) setData(payload);
        else setError(payload.error ?? 'Failed to load overview');
      })
      .catch(() => setError('Network error loading overview'));
  }, []);

  const cards = data
    ? [
        { label: 'Tracked Wallets', value: String(data.walletCount), cls: '' },
        { label: 'Active Bots', value: String(data.activeBotCount), cls: '' },
        { label: 'Open Positions', value: String(data.openPositionCount), cls: '' },
        { label: 'Attempts Today', value: String(data.attemptsTodayCount), cls: '' },
        {
          label: 'Live On',
          value: data.settings?.live_on ? 'ON' : 'OFF',
          cls: data.settings?.live_on ? 'status-on' : 'status-off',
        },
        {
          label: 'Emergency Stop',
          value: data.settings?.emergency_stop ? 'ACTIVE' : 'Clear',
          cls: data.settings?.emergency_stop ? 'status-danger' : 'status-off',
        },
      ]
    : null;

  if (error) {
    return (
      <div className="copy-section" style={{ padding: '1rem 1.5rem' }}>
        <p style={{ fontSize: '0.82rem', color: '#ef4444', margin: 0 }}>{error}</p>
      </div>
    );
  }

  return (
    <div className="copy-overview-grid">
      {cards
        ? cards.map((card) => (
            <div key={card.label} className="copy-stat-card">
              <div className="copy-stat-label">{card.label}</div>
              <div className={`copy-stat-value ${card.cls}`}>{card.value}</div>
            </div>
          ))
        : Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="copy-stat-card">
              <div className="copy-stat-label">—</div>
              <div className="copy-stat-value" style={{ opacity: 0.2 }}>—</div>
            </div>
          ))}
    </div>
  );
}
