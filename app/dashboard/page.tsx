import LiveCard from '@/components/dashboard/LiveCard';
import CopyPaperBankrollCard from '@/components/copy/CopyPaperBankrollCard';
import CopyOverviewCards from '@/components/copy/CopyOverviewCards';
import LiveCopySafetyCard from '@/components/copy/LiveCopySafetyCard';
import GlobalSettingsPanel from '@/components/copy/GlobalSettingsPanel';
import TrackedWalletsSection from '@/components/copy/TrackedWalletsSection';
import CopyBotsSection from '@/components/copy/CopyBotsSection';
import CopyAttemptsSection from '@/components/copy/CopyAttemptsSection';
import CopiedPositionsSection from '@/components/copy/CopiedPositionsSection';

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

      {/* Bankroll overview — live capital and paper capital */}
      <section className="copy-bankroll-row">
        <LiveCard />
        <CopyPaperBankrollCard />
      </section>

      {/* Copy trading stat cards */}
      <CopyOverviewCards />

      {/* Live safety briefing */}
      <LiveCopySafetyCard />

      {/* Global safety controls */}
      <GlobalSettingsPanel />

      {/* Wallet sources */}
      <TrackedWalletsSection />

      {/* Copy bots */}
      <CopyBotsSection />

      {/* Audit trail */}
      <CopyAttemptsSection />

      {/* Open / closed positions */}
      <CopiedPositionsSection />
    </div>
  );
}
