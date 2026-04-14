import Link from 'next/link';

export default function CopyTradingPromoCard() {
  return (
    <div className="copy-promo-card">
      <div className="copy-promo-body">
        <div className="copy-promo-badge">
          <span className="copy-promo-badge-dot" />
          New Feature
        </div>
        <h2 className="copy-promo-title">Copy Top Polymarket Traders</h2>
        <p className="copy-promo-desc">
          Automatically mirror positions from proven wallets in real-time.
          Configure sizing, filters, and risk controls — paper or live.
        </p>
        <div className="copy-promo-actions">
          <Link href="/dashboard/copy" className="copy-promo-cta">
            Open Copy Trading
            <span className="copy-promo-cta-arrow">→</span>
          </Link>
        </div>
      </div>

      <div className="copy-promo-stats">
        <div className="copy-promo-stat">
          <div className="copy-promo-stat-value">8</div>
          <div className="copy-promo-stat-label">New Tables</div>
        </div>
        <div className="copy-promo-divider" />
        <div className="copy-promo-stat">
          <div className="copy-promo-stat-value">Live</div>
          <div className="copy-promo-stat-label">Paper &amp; Live</div>
        </div>
        <div className="copy-promo-divider" />
        <div className="copy-promo-stat">
          <div className="copy-promo-stat-value">∞</div>
          <div className="copy-promo-stat-label">Wallets</div>
        </div>
      </div>
    </div>
  );
}
