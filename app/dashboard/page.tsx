import { getDashboardStats } from '@/lib/botData';
import ProfileCards from '@/components/dashboard/ProfileCards';
import PaperStrategyCard from '@/components/dashboard/PaperStrategyCard';
import LiveCard from '@/components/dashboard/LiveCard';
import DashboardContent from '@/components/dashboard/DashboardContent';

export const revalidate = 0;

export default async function DashboardPage() {
  const stats = await getDashboardStats();

  return (
    <div className="dashboard-container">
      <div className="cards-grid">
        <ProfileCards stats={stats} />
        <PaperStrategyCard botId="paper_fastloop" label="PAPER — FASTLOOP" />
        <PaperStrategyCard botId="paper_sniper" label="PAPER — SNIPER" />
        <LiveCard />
      </div>
      <DashboardContent />
    </div>
  );
}
