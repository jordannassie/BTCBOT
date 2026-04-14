import CopyOverviewCards from '@/components/copy/CopyOverviewCards';
import LiveCopySafetyCard from '@/components/copy/LiveCopySafetyCard';
import GlobalSettingsPanel from '@/components/copy/GlobalSettingsPanel';
import TrackedWalletsSection from '@/components/copy/TrackedWalletsSection';
import CopyBotsSection from '@/components/copy/CopyBotsSection';
import CopyAttemptsSection from '@/components/copy/CopyAttemptsSection';
import CopiedPositionsSection from '@/components/copy/CopiedPositionsSection';

export const revalidate = 0;

export default function CopyPage() {
  return (
    <div className="dashboard-container copy-page">
      <div className="copy-page-header">
        <h1 className="copy-page-title">Copy Trading</h1>
        <p className="copy-page-subtitle">Monitor wallets, manage copy bots, and control live execution safely</p>
      </div>

      <CopyOverviewCards />
      <LiveCopySafetyCard />
      <GlobalSettingsPanel />
      <TrackedWalletsSection />
      <CopyBotsSection />
      <CopyAttemptsSection />
      <CopiedPositionsSection />
    </div>
  );
}
