import { getDashboardStats } from '@/lib/botData';
import ProfileCards from '@/components/dashboard/ProfileCards';
import PositionsSection from '@/components/dashboard/PositionsSection';

export const revalidate = 0;

export default async function DashboardPage() {
  const stats = await getDashboardStats();

  return (
    <div className="dashboard-container">
      <ProfileCards stats={stats} />
      <PositionsSection />
    </div>
  );
}
