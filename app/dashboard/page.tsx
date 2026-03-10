import { getDashboardStats } from '@/lib/botData';
import ProfileCards from '@/components/dashboard/ProfileCards';
import AccountSummaryCard from '@/components/dashboard/AccountSummaryCard';
import PaperStrategyCard from '@/components/dashboard/PaperStrategyCard';
import LiveCard from '@/components/dashboard/LiveCard';
import DashboardContent from '@/components/dashboard/DashboardContent';

export const revalidate = 0;

export default async function DashboardPage() {
  const stats = await getDashboardStats();

  return (
    <div className="dashboard-container">
      <section className="overview-row">
        <ProfileCards stats={stats} />
        <LiveCard />
        <AccountSummaryCard />
      </section>

      <section className="strategy-grid">
        <PaperStrategyCard botId="paper_fastloop" label="PAPER — FASTLOOP" />
        <PaperStrategyCard botId="paper_sniper" label="PAPER — SNIPER" />
      </section>

      <DashboardContent />
    </div>
  );
}
