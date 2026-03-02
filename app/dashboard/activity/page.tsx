import { getDashboardStats, getBotTrades } from '@/lib/botData';
import ProfileCards from '@/components/dashboard/ProfileCards';
import ActivitySection from '@/components/dashboard/ActivitySection';

export const revalidate = 0;

export default async function ActivityPage() {
  const stats = await getDashboardStats();
  const trades = await getBotTrades(100);

  return (
    <div className="dashboard-container">
      <ProfileCards stats={stats} />
      <ActivitySection initialTrades={trades} />
    </div>
  );
}
