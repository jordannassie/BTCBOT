import LiveCard from '@/components/dashboard/LiveCard';
import CopyPaperBankrollCard from '@/components/copy/CopyPaperBankrollCard';
import CopyTradingTabs from '@/components/copy/CopyTradingTabs';

export const revalidate = 0;

export default async function DashboardPage() {
  return (
    <div className="dashboard-container copy-page">
      <div className="copy-page-header">
        <h1 className="copy-page-title">Copy Trading</h1>
        <p className="copy-page-subtitle">
          Monitor wallets, manage copy bots, and control live execution safely
        </p>
      </div>

      {/* Bankroll cards stay pinned at the top, server-rendered */}
      <section className="copy-bankroll-row">
        <LiveCard />
        <CopyPaperBankrollCard />
      </section>

      {/* Tabbed layout — replaces the long stacked scroll */}
      <CopyTradingTabs />
    </div>
  );
}
