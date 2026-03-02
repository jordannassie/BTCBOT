import type { BotTrade } from '@/lib/botData';

type ActivityListProps = {
  trades: BotTrade[];
};

const formatMarketTitle = (value?: string | null) => {
  if (!value) return 'Unknown Market';
  return value
    .split(/[-_]/g)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

const formatTimeAgo = (value?: string) => {
  if (!value) return '—';
  const delta = Math.floor((Date.now() - new Date(value).getTime()) / 1000);
  if (Number.isNaN(delta)) return '—';
  if (delta < 60) return 'just now';
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
};

const formatAmount = (trade: BotTrade) => {
  if (typeof trade.pnl_usd === 'number') {
    return `$${trade.pnl_usd.toFixed(2)}`;
  }
  if (typeof trade.size === 'number' && typeof trade.price === 'number') {
    return `$${(trade.size * trade.price).toFixed(2)}`;
  }
  if (typeof trade.size === 'number') {
    return `${trade.size.toFixed(2)} qty`;
  }
  return '—';
};

const getTypeLabel = (trade: BotTrade) => {
  const normalized = trade.status?.toLowerCase() ?? '';
  if (normalized.includes('paper')) return 'Paper';
  if (normalized.includes('filled') || normalized.includes('closed')) return 'Filled';
  return trade.side?.toUpperCase() ?? 'Trade';
};

export default function ActivityList({ trades }: ActivityListProps) {
  if (!trades || trades.length === 0) {
    return (
      <div className="activity-empty">
        <p>No activity yet</p>
        <p className="empty-subtitle">Trades will populate here once the bot begins trading.</p>
      </div>
    );
  }

  return (
    <article className="activity-list">
      <header className="activity-list__header">
        <span>Type</span>
        <span>Market</span>
        <span>Amount</span>
        <span>Time</span>
      </header>

      <div className="activity-list__rows">
        {trades.map((trade) => (
          <div key={trade.id ?? `${trade.bot_id}-${trade.created_at}`} className="activity-row">
            <span className="activity-row__type">{getTypeLabel(trade)}</span>
            <span className="activity-row__market">{formatMarketTitle(trade.market_slug ?? trade.market)}</span>
            <span className="activity-row__amount">{formatAmount(trade)}</span>
            <span className="activity-row__time">{formatTimeAgo(trade.created_at)}</span>
          </div>
        ))}
      </div>
    </article>
  );
}
