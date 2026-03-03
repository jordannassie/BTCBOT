import { getDashboardStats } from '@/lib/botData';
import ProfileCards from '@/components/dashboard/ProfileCards';
import AccountSummaryCard from '@/components/dashboard/AccountSummaryCard';
import PaperStrategyCard from '@/components/dashboard/PaperStrategyCard';
import PaperCopyCard from '@/components/dashboard/PaperCopyCard';
import PaperScalperCard from '@/components/dashboard/PaperScalperCard';
import LiveCard from '@/components/dashboard/LiveCard';
import DashboardContent from '@/components/dashboard/DashboardContent';

export const revalidate = 0;

export default async function DashboardPage() {
  const stats = await getDashboardStats();

  return (
    <div className="dashboard-container">
      <div className="cards-grid">
        <ProfileCards stats={stats} />
        <AccountSummaryCard />
        <PaperStrategyCard botId="paper_fastloop" label="PAPER — FASTLOOP" />
        <PaperStrategyCard botId="paper_sniper" label="PAPER — SNIPER" />
        <PaperCopyCard botId="paper_copy" label="PAPER — COPY" />
        <PaperScalperCard botId="paper_scalper" label="PAPER — SCALPER" />
        <LiveCard />
      </div>
      <DashboardContent />
    </div>
  );
}
