import type { BotTrade } from '@/lib/botData';

type ActivityListProps = {
  trades: BotTrade[];
};

function formatTimeAgo(dateString: string): string {
  const now = new Date();
  const date = new Date(dateString);
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function getTypeLabel(status: string, side: string): string {
  if (status.toLowerCase().includes('paper')) return 'Paper';
  return 'Buy';
}

function formatMarketName(slug: string): string {
  return slug
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function getBadgeColor(side: string): string {
  const lower = side.toLowerCase();
  if (lower === 'yes' || lower === 'long' || lower === 'buy') return 'badge-green';
  if (lower === 'no' || lower === 'short' || lower === 'sell') return 'badge-red';
  return 'badge-gray';
}

export default function ActivityList({ trades }: ActivityListProps) {
  if (!trades || trades.length === 0) {
    return (
      <div className="activity-container">
        <div className="activity-table">
          <div className="table-header">
            <div className="col-type">TYPE</div>
            <div className="col-market-activity">MARKET</div>
            <div className="col-amount">AMOUNT</div>
          </div>
          <div className="empty-state">
            <p>No activity yet</p>
            <p className="empty-subtitle">Trade activity will appear here once your bot executes trades.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="activity-container">
      <div className="activity-table">
        <div className="table-header">
          <div className="col-type">TYPE</div>
          <div className="col-market-activity">MARKET</div>
          <div className="col-amount">AMOUNT</div>
        </div>

        {trades.map((trade) => (
          <div key={trade.id} className="table-row">
            <div className="col-type">
              <span className="type-label">{getTypeLabel(trade.status, trade.side)}</span>
            </div>
            <div className="col-market-activity">
              <div className="market-icon">
                <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                  <circle cx="16" cy="16" r="15" fill="#F7931A"/>
                  <path d="M20 14c0-1.5-1-2.5-2.5-2.5h-3v5h3c1.5 0 2.5-1 2.5-2.5z" fill="white"/>
                  <path d="M20 18.5c0-1.5-1-2.5-2.5-2.5h-3v5h3c1.5 0 2.5-1 2.5-2.5z" fill="white"/>
                </svg>
              </div>
              <div className="market-info">
                <div className="market-title">Bitcoin Up or Down - {formatMarketName(trade.market_slug)}</div>
                <div className="market-meta">
                  <span className={`badge ${getBadgeColor(trade.side)}`}>{trade.side}</span>
                  <span className="shares">{trade.size.toFixed(1)} shares</span>
                </div>
              </div>
            </div>
            <div className="col-amount">
              <div className="amount-main">${(trade.size * (trade.price || 1)).toFixed(2)}</div>
              <div className="amount-time">{formatTimeAgo(trade.created_at)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
