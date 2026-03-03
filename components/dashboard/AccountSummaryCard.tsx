'use server';

import { getPaperSummary } from '@/lib/paperSummary';

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
  const pnlColor = totalPnl > 0 ? '#10b981' : totalPnl < 0 ? '#ef4444' : '#f8fafc';

  return (
    <div className="profile-card account-summary-card">
      <div className="account-summary-header">
        <div className="account-summary-title">
          <span>Account Summary</span>
          <p className="account-summary-subtext">Live paper totals</p>
        </div>
        <div className="account-summary-range">
          <button className="range-btn active">1D</button>
          <button className="range-btn">1W</button>
          <button className="range-btn">1M</button>
          <button className="range-btn">ALL</button>
        </div>
      </div>

      <div className="account-summary-value">{formatUSD(totalBalance)}</div>
      <div className="account-summary-pnl" style={{ color: pnlColor }}>
        P/L {formatUSD(totalPnl)}
      </div>
    </div>
  );
}
