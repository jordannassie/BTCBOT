import { getDashboardStats, getBotTrades } from '@/lib/botData';
import ProfileCards from '@/components/dashboard/ProfileCards';
import DashboardTabs from '@/components/dashboard/DashboardTabs';
import ActivityList from '@/components/dashboard/ActivityList';

export default async function ActivityPage() {
  const stats = await getDashboardStats();
  const trades = await getBotTrades(100);

  return (
    <div className="dashboard-container">
      <ProfileCards stats={stats} />
      <DashboardTabs activeTab="activity" />
      <ActivityList trades={trades} />
    </div>
  );
}
