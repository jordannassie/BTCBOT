import CopyOverviewCards from '@/components/copy/CopyOverviewCards';
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
        <p className="copy-page-subtitle">Manage tracked wallets, copy bots, and global settings</p>
      </div>

      <CopyOverviewCards />
      <GlobalSettingsPanel />
      <TrackedWalletsSection />
      <CopyBotsSection />
      <CopyAttemptsSection />
      <CopiedPositionsSection />
    </div>
  );
}
