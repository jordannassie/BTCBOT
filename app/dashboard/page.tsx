import { getDashboardStats } from '@/lib/botData';
import ProfileCards from '@/components/dashboard/ProfileCards';
import AccountSummaryCard from '@/components/dashboard/AccountSummaryCard';
import PaperStrategyCard from '@/components/dashboard/PaperStrategyCard';
import LiveCard from '@/components/dashboard/LiveCard';
import DashboardContent from '@/components/dashboard/DashboardContent';
import PaperCandleBiasCard from '@/components/dashboard/PaperCandleBiasCard';

export const revalidate = 0;

export default async function DashboardPage() {
  const stats = await getDashboardStats();

  return (
    <div className="dashboard-container">
      <section className="overview-row">
        <ProfileCards stats={stats} />
        <LiveCard />
        <AccountSummaryCard />
      </section>

      <section className="strategy-grid">
        <PaperStrategyCard botId="paper_fastloop" label="PAPER — FASTLOOP" />
        <PaperStrategyCard botId="paper_sniper" label="PAPER — SNIPER" />
        <PaperCandleBiasCard />
        <PaperStrategyCard botId="paper_sweep_reclaim" label="PAPER — SWEEP_RECLAIM" />
        <PaperStrategyCard botId="paper_breakout_close" label="PAPER — BREAKOUT_CLOSE" />
        <PaperStrategyCard botId="paper_engulfing_level" label="PAPER — ENGULFING_LEVEL" />
        <PaperStrategyCard botId="paper_rejection_wick" label="PAPER — REJECTION_WICK" />
        <PaperStrategyCard botId="paper_follow_through" label="PAPER — FOLLOW_THROUGH" />
      </section>

      <DashboardContent />
    </div>
  );
}
