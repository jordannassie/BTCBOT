import type { PositionGroup } from '@/lib/botData';

type PositionsTableProps = {
  positions: PositionGroup[];
};

const formatMarketTitle = (slug: string) =>
  slug
    .split(/[-_]/g)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(value);

const formatTimeAgo = (value: string) => {
  if (!value) return '—';
  const delta = Math.floor((Date.now() - new Date(value).getTime()) / 1000);
  if (Number.isNaN(delta)) return '—';
  if (delta < 60) return 'just now';
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
};

export default function PositionsTable({ positions }: PositionsTableProps) {
  if (!positions.length) {
    return (
      <div className="positions-empty">
        <p>No positions yet</p>
        <p className="empty-subtitle">Trades will appear here once your bot engages the market.</p>
      </div>
    );
  }

  return (
    <div className="positions-list">
      {positions.map((position) => (
        <article key={position.market_slug} className="position-row">
          <div className="position-row__header">
            <div className="market-chip">
              <div className="subtle-icon" aria-hidden="true"></div>
              <div>
                <p className="market-title">{formatMarketTitle(position.market_slug)}</p>
                <p className="market-meta">
                  {position.trade_count} trades · {formatTimeAgo(position.last_updated)}
                </p>
              </div>
            </div>
            <span className={`side-pill side-pill--${(position.side ?? 'neutral').toLowerCase()}`}>
              {(position.side ?? '—').toUpperCase()}
            </span>
          </div>

          <div className="position-row__body">
            <div className="position-metric">
              <p>Value</p>
              <strong>{formatCurrency(position.total_notional)}</strong>
            </div>
            <div className="position-metric">
              <p>Avg price</p>
              <strong>{formatCurrency(position.avg_price)}</strong>
            </div>
            <div className="position-metric">
              <p>Status</p>
              <strong>{position.status ?? '—'}</strong>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
