import { getDashboardStats } from '@/lib/botData';
import ProfileCards from '@/components/dashboard/ProfileCards';
import DashboardTabs from '@/components/dashboard/DashboardTabs';
import ActivityList from '@/components/dashboard/ActivityList';

export const revalidate = 0;

export default async function ActivityPage() {
  const stats = await getDashboardStats();

  return (
    <section className="dashboard-panel">
      <ProfileCards stats={stats} />
      <DashboardTabs activeTab="activity" />
      <ActivityList trades={stats.latestTrades} />
    </section>
  );
}
