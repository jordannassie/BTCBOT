import { getDashboardStats, getBotTrades } from '@/lib/botData';
import ProfileCards from '@/components/dashboard/ProfileCards';
import DashboardTabs from '@/components/dashboard/DashboardTabs';
import PositionsTable from '@/components/dashboard/PositionsTable';

export default async function DashboardPage() {
  const stats = await getDashboardStats();

  return (
    <div className="dashboard-container">
      <ProfileCards stats={stats} />
      <DashboardTabs activeTab="positions" />
      <PositionsTable positions={stats.positions} />
    </div>
  );
}
