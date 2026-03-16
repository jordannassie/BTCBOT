'use server';

import { getPaperSummary } from '@/lib/paperSummary';
import { getAllStrategyPnl24h } from '@/lib/strategyPnl';
import ResetPaperBankrollButton from '@/components/dashboard/ResetPaperBankrollButton';

const formatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const formatUSD = (value?: number | null) => formatter.format(value ?? 0);

export default async function AccountSummaryCard() {
  const rows = await getPaperSummary();
  const totalBalance = rows.reduce((sum, row) => sum + Number(row.paper_balance_usd ?? 0), 0);
  const totalPnl = rows.reduce((sum, row) => sum + Number(row.paper_pnl_usd ?? 0), 0);
  const totals24h = await getAllStrategyPnl24h();
  const totalPnl24h = Object.values(totals24h).reduce((sum, value) => sum + value, 0);
  const pnlColor = totalPnl > 0 ? '#10b981' : totalPnl < 0 ? '#ef4444' : '#f8fafc';
  const pnl24hColor = totalPnl24h > 0 ? '#10b981' : totalPnl24h < 0 ? '#ef4444' : '#f8fafc';

  return (
    <div className="profile-card account-summary-card">
      <div className="account-summary-content">
        <div className="account-summary-main">
          <div className="account-summary-header">
            <div className="account-summary-title">
              <span>PAPER BANKROLL</span>
              <p className="account-summary-subtext">Shared paper total balance &amp; P/L</p>
            </div>
            <div className="account-summary-range">
              <button className="range-btn active">1D</button>
              <button className="range-btn">1W</button>
              <button className="range-btn">1M</button>
              <button className="range-btn">ALL</button>
            </div>
          </div>
          <ResetPaperBankrollButton />
          <div className="account-summary-value">{formatUSD(totalBalance)}</div>
          <div className="account-summary-pnls">
            <div>
              <span className="account-summary-pnl-label">24h P/L</span>
              <span className="account-summary-pnl-value" style={{ color: pnl24hColor }}>
                {formatUSD(totalPnl24h)}
              </span>
            </div>
            <div>
              <span className="account-summary-pnl-label">All-time P/L</span>
              <span className="account-summary-pnl-value" style={{ color: pnlColor }}>
                {formatUSD(totalPnl)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
