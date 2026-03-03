import { getDashboardStats, getBotTrades } from '@/lib/botData';
import ProfileCards from '@/components/dashboard/ProfileCards';
import PaperStrategyCard from '@/components/dashboard/PaperStrategyCard';
import LiveCard from '@/components/dashboard/LiveCard';
import ActivitySection from '@/components/dashboard/ActivitySection';

export const revalidate = 0;

export default async function ActivityPage() {
  const stats = await getDashboardStats();
  const trades = await getBotTrades(100);

  return (
    <div className="dashboard-container">
      <div className="cards-grid">
        <ProfileCards stats={stats} />
        <PaperStrategyCard botId="paper_fastloop" label="PAPER — FASTLOOP" />
        <PaperStrategyCard botId="paper_sniper" label="PAPER — SNIPER" />
        <LiveCard />
      </div>
      <ActivitySection initialTrades={trades} />
    </div>
  );
}
