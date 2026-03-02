import { getDashboardStats } from '@/lib/botData';
import ProfileCards from '@/components/dashboard/ProfileCards';
import DashboardTabs from '@/components/dashboard/DashboardTabs';
import PositionsTable from '@/components/dashboard/PositionsTable';

export const revalidate = 0;

export default async function DashboardPage() {
  const stats = await getDashboardStats();

  return (
    <div className="dashboard-container">
      <ProfileCards stats={stats} />
      <DashboardTabs activeTab="positions" />
      <div className="debug-line">
        paperPositions: {stats.paperPositions?.length ?? 0}
        {stats.paperPositions && stats.paperPositions.length > 0 && (
          <span> · first market: {stats.paperPositions[0].market_slug}</span>
        )}
      </div>
      <PositionsTable positions={stats.positions} paperPositions={stats.paperPositions} />
    </div>
  );
}
