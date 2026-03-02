import { getDashboardStats, getBotTrades } from '@/lib/botData';
import ProfileCards from '@/components/dashboard/ProfileCards';
import DashboardTabs from '@/components/dashboard/DashboardTabs';
import ActivityStream from '@/components/dashboard/ActivityStream';

export const revalidate = 0;

export default async function ActivityPage() {
  const stats = await getDashboardStats();
  const trades = await getBotTrades(100);

  return (
    <div className="dashboard-container">
      <ProfileCards stats={stats} />
      <DashboardTabs activeTab="activity" />
      <ActivityStream initialTrades={trades} />
    </div>
  );
}
