import type { BotTrade } from '@/lib/botData';

type ActivityListProps = {
  trades?: BotTrade[];
};

function safeString(value: unknown, fallback = '—'): string {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number') return String(value);
  return fallback;
}

function formatMarketName(slug: string | null | undefined): string {
  if (!slug) return 'Unknown';
  return slug
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatTimeAgo(dateString: string | null | undefined): string {
  if (!dateString) return '—';
  try {
    const now = new Date();
    const date = new Date(dateString);
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (Number.isNaN(seconds)) return dateString;
    if (seconds < 60) return 'now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  } catch {
    return dateString;
  }
}

function getTypeLabel(status: string | undefined, side: string | undefined): string {
  const normalizedStatus = status?.toLowerCase() ?? '';
  if (normalizedStatus.includes('paper')) return 'Paper';
  return 'Buy';
}

function getBadgeColor(side: string | undefined): string {
  const lower = (side ?? '').toLowerCase();
  if (lower === 'yes' || lower === 'long' || lower === 'buy') return 'badge-green';
  if (lower === 'no' || lower === 'short' || lower === 'sell') return 'badge-red';
  return 'badge-gray';
}

export default function ActivityList({ trades }: ActivityListProps) {
  const safeTrades: BotTrade[] = Array.isArray(trades)
    ? trades.flat().filter((item): item is BotTrade => typeof item === 'object' && item !== null)
    : [];

  if (safeTrades.length === 0) {
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

        {safeTrades.map((trade) => {
          const typeLabel = getTypeLabel(trade.status, trade.side);
          const badgeClass = getBadgeColor(trade.side);
          const rawMarketSlug = trade.market_slug ?? trade.market;
          const formattedMarket = formatMarketName(rawMarketSlug ?? null);
          const marketSlug = formattedMarket === 'Unknown' ? rawMarketSlug ?? 'Unknown' : formattedMarket;
          const resolvedPnl = typeof trade.pnl_usd === 'number' ? `$${trade.pnl_usd.toFixed(2)}` : null;
          const formattedSize = typeof trade.size === 'number' ? `$${trade.size.toFixed(2)}` : null;
          const formattedPnl = typeof trade.pnl_usd === 'number' ? `$${trade.pnl_usd.toFixed(2)}` : null;
          let amountMain = '$0.00';
          if ((trade.status ?? '').toUpperCase().startsWith('PAPER_')) {
            amountMain = formattedPnl ?? '$0.00';
          } else if (formattedSize) {
            amountMain = formattedSize;
          }
          const amountTime = formatTimeAgo(trade.created_at);

          return (
            <div key={trade.id ?? `${trade.bot_id}-${trade.created_at}`} className="table-row">
              <div className="col-type">
                <span className="type-label">{typeLabel}</span>
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
                  <div className="market-title">Bitcoin Up or Down - {marketSlug}</div>
                  <div className="market-meta">
                    <span className={`badge ${badgeClass}`}>{safeString(trade.side)}</span>
                    <span className="shares">{isFinite(Number(trade.size)) ? `${trade.size.toFixed(1)} shares` : '—'}</span>
                  </div>
                </div>
              </div>
              <div className="col-amount">
                <div className="amount-main">{amountMain}</div>
                <div className="amount-time">{amountTime}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
