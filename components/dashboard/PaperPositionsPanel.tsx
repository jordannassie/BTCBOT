'use client';

import { useEffect, useState } from 'react';
import type { StrategyOption } from './StrategyFilter';

type PaperPositionRow = {
  id: string;
  bot_id: string;
  status: string;
  market_slug: string;
  side: 'yes' | 'no';
  entry_price: number;
  size_usd: number;
  opened_at: string;
  resolved_side?: string | null;
  pnl_usd?: number | null;
  closed_at?: string | null;
  strategy_id?: string | null;
};

const STATUS_LABELS: Record<'OPEN' | 'CLOSED', string> = {
  OPEN: 'Paper Positions',
  CLOSED: 'Closed'
};

type PaperPositionsPanelProps = {
  strategy: StrategyOption;
};

export default function PaperPositionsPanel({ strategy }: PaperPositionsPanelProps) {
  const [status, setStatus] = useState<'OPEN' | 'CLOSED'>('OPEN');
  const [positions, setPositions] = useState<PaperPositionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPositions = async () => {
      setLoading(true);
      setError(null);
      try {
        const queryParams = [`status=${status}`];
        if (strategy !== 'ALL') {
          queryParams.push(`strategy=${strategy}`);
        }
        const queryString = queryParams.join('&');
        const response = await fetch(`/api/paper-positions?${queryString}`, { cache: 'no-store' });
        if (!response.ok) {
          const payload = await response.text();
          setError(`Failed to load positions (${response.status}): ${payload}`);
          return;
        }

        const payload = await response.json();
        if (payload.ok && Array.isArray(payload.rows)) {
          setPositions(payload.rows as PaperPositionRow[]);
        } else {
          setPositions([]);
          setError(payload.error ?? 'Unexpected response');
        }
      } catch (ex) {
        console.error('paper positions fetch failed', ex);
        setError('Unable to load paper positions.');
      } finally {
        setLoading(false);
      }
    };

    fetchPositions();
  }, [status, strategy]);

  const renderRow = (position: PaperPositionRow) => (
    <div key={position.id} className="table-row">
      <div className="col-market">
        <div className="market-icon">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="15" fill="#F7931A" />
            <path d="M20 14c0-1.5-1-2.5-2.5-2.5h-3v5h3c1.5 0 2.5-1 2.5-2.5z" fill="white" />
            <path d="M20 18.5c0-1.5-1-2.5-2.5-2.5h-3v5h3c1.5 0 2.5-1 2.5-2.5z" fill="white" />
          </svg>
        </div>
        <div className="market-info">
          <div className="market-title">Bitcoin Up or Down - {position.market_slug}</div>
          <div className="market-meta">
            <span className={`badge ${position.side === 'yes' ? 'badge-green' : 'badge-red'}`}>
              {position.side.toUpperCase()}
            </span>
            <span className="shares">{position.size_usd.toFixed(2)} USD</span>
            {position.strategy_id && (
              <span className={`strategy-badge strategy-${position.strategy_id.toLowerCase()}`}>
                {position.strategy_id.toUpperCase()}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="col-avg">${position.entry_price.toFixed(2)}</div>
      <div className="col-current">
        {status === 'OPEN' ? 'OPEN' : position.resolved_side?.toUpperCase() ?? 'CLOSED'}
      </div>
      <div className="col-value">
        <div className="value-main">${position.size_usd.toFixed(2)}</div>
        {status === 'CLOSED' && typeof position.pnl_usd === 'number' && (
          <div className="amount-time">P/L: ${position.pnl_usd.toFixed(2)}</div>
        )}
        {status === 'CLOSED' && position.closed_at && (
          <div className="amount-time">{new Date(position.closed_at).toLocaleString()}</div>
        )}
        {status === 'OPEN' && position.opened_at && (
          <div className="amount-time">Opened: {new Date(position.opened_at).toLocaleString()}</div>
        )}
      </div>
    </div>
  );

  return (
    <div className="positions-container">
      <div className="positions-header">
        <button
          className={`filter-btn ${status === 'OPEN' ? 'active' : ''}`}
          onClick={() => setStatus('OPEN')}
        >
          {STATUS_LABELS.OPEN}
        </button>
        <button
          className={`filter-btn ${status === 'CLOSED' ? 'active' : ''}`}
          onClick={() => setStatus('CLOSED')}
        >
          {STATUS_LABELS.CLOSED}
        </button>
      </div>

      {loading ? (
        <div className="empty-state">
          <p>Loading {STATUS_LABELS[status]}...</p>
        </div>
      ) : error ? (
        <div className="empty-state">
          <p>{error}</p>
        </div>
      ) : positions.length === 0 ? (
        <div className="empty-state">
          <p>No {STATUS_LABELS[status].toLowerCase()} yet.</p>
        </div>
      ) : (
        <div className="positions-table">
          <div className="table-header">
            <div className="col-market">MARKET</div>
            <div className="col-avg">ENTRY</div>
            <div className="col-current">STATUS</div>
            <div className="col-value">SIZE</div>
          </div>
          {positions.map(renderRow)}
        </div>
      )}
    </div>
  );
}
