import type { PositionGroup, PaperPosition } from '@/lib/botData';

type PositionsTableProps = {
  positions: PositionGroup[];
  paperPositions?: PaperPosition[];
};

function formatMarketTitle(slug: string): string {
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function getBadgeColor(side: string): string {
  const lower = side.toLowerCase();
  if (lower === 'yes' || lower === 'long' || lower === 'buy') return 'badge-green';
  if (lower === 'no' || lower === 'short' || lower === 'sell') return 'badge-red';
  return 'badge-gray';
}

export default function PositionsTable({ positions, paperPositions }: PositionsTableProps) {
  const showingPaper = Array.isArray(paperPositions) && paperPositions.length > 0;

  if (showingPaper) {
    return (
      <div className="positions-container">
        <div className="positions-header">
          <button className="filter-btn active">Paper Positions</button>
          <button className="filter-btn">Closed</button>
        </div>

        <div className="positions-table">
          <div className="table-header">
            <div className="col-market">MARKET</div>
            <div className="col-avg">ENTRY</div>
            <div className="col-current">STATUS</div>
            <div className="col-value">SIZE (USD)</div>
          </div>

          {paperPositions!.map((position) => (
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
                  <div className="market-title">Bitcoin Up or Down - {formatMarketTitle(position.market_slug)}</div>
                  <div className="market-meta">
                    <span className={`badge ${getBadgeColor(position.side)}`}>{position.side}</span>
                    <span className="shares">${position.size_usd.toFixed(2)} USD</span>
                  </div>
                </div>
              </div>
              <div className="col-avg">${position.entry_price.toFixed(2)}</div>
              <div className="col-current">OPEN</div>
              <div className="col-value">
                <div className="value-main">${position.size_usd.toFixed(2)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!positions || positions.length === 0) {
    return (
      <div className="positions-container">
        <div className="positions-header">
          <button className="filter-btn active">Active</button>
          <button className="filter-btn">Closed</button>
          <div className="search-positions">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M11 11L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input type="text" placeholder="Search positions" disabled />
          </div>
          <button className="sort-btn">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 4h10M4 7h6M6 10h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            Value
          </button>
        </div>

        <div className="empty-state">
          <p>No active positions</p>
          <p className="empty-subtitle">Your bot positions will appear here once trades are executed.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="positions-container">
      <div className="positions-header">
        <button className="filter-btn active">Active</button>
        <button className="filter-btn">Closed</button>
        <div className="search-positions">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M11 11L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input type="text" placeholder="Search positions" disabled />
        </div>
        <button className="sort-btn">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 4h10M4 7h6M6 10h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          Value
        </button>
      </div>

      <div className="positions-table">
        <div className="table-header">
          <div className="col-market">MARKET</div>
          <div className="col-avg">AVG</div>
          <div className="col-current">CURRENT</div>
          <div className="col-value">VALUE</div>
        </div>

        {positions.map((position, idx) => (
          <div key={`${position.market_slug}-${position.side}-${idx}`} className="table-row">
            <div className="col-market">
              <div className="market-icon">
                <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                  <circle cx="16" cy="16" r="15" fill="#F7931A" />
                  <path d="M20 14c0-1.5-1-2.5-2.5-2.5h-3v5h3c1.5 0 2.5-1 2.5-2.5z" fill="white" />
                  <path d="M20 18.5c0-1.5-1-2.5-2.5-2.5h-3v5h3c1.5 0 2.5-1 2.5-2.5z" fill="white" />
                </svg>
              </div>
              <div className="market-info">
                <div className="market-title">Bitcoin Up or Down - {formatMarketTitle(position.market_slug)}</div>
                <div className="market-meta">
                  <span className={`badge ${getBadgeColor(position.side)}`}>{position.side}</span>
                  <span className="shares">{position.total_size.toFixed(1)} shares</span>
                </div>
              </div>
            </div>
            <div className="col-avg">{position.avg_price > 0 ? `${(position.avg_price * 100).toFixed(1)}¢` : '—'}</div>
            <div className="col-current">100¢</div>
            <div className="col-value">
              <div className="value-main">${(position.total_size * position.avg_price).toFixed(2)}</div>
              <div className="value-change positive">+${(position.total_size * 0.14).toFixed(2)} (38.49%)</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
