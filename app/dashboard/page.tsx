import { getDashboardStats } from '@/lib/botData';
import ProfileCards from '@/components/dashboard/ProfileCards';
import DashboardTabs from '@/components/dashboard/DashboardTabs';
import PaperPositionsPanel from '@/components/dashboard/PaperPositionsPanel';

export const revalidate = 0;

export default async function DashboardPage() {
  const stats = await getDashboardStats();

  return (
    <div className="dashboard-container">
      <ProfileCards stats={stats} />
      <DashboardTabs activeTab="positions" />
      <PaperPositionsPanel />
    </div>
  );
}
