import Link from 'next/link';
import { getDashboardStats } from '@/lib/botData';
import ProfileCards from '@/components/dashboard/ProfileCards';
import AccountSummaryCard from '@/components/dashboard/AccountSummaryCard';
import PaperStrategyCard from '@/components/dashboard/PaperStrategyCard';
import LiveCard from '@/components/dashboard/LiveCard';
import DashboardContent from '@/components/dashboard/DashboardContent';
import PaperCandleBiasCard from '@/components/dashboard/PaperCandleBiasCard';

export const revalidate = 0;

export default async function StrategiesPage() {
  const stats = await getDashboardStats();

  return (
    <div className="dashboard-container">

      {/* Callout: Copy Trading is now the primary product */}
      <div className="strategies-callout">
        <span>Copy Trading is now the main dashboard experience</span>
        <Link href="/dashboard" className="strategies-callout-cta">
          Open Copy Trading →
        </Link>
      </div>

      {/* Page header */}
      <div className="strategies-page-header">
        <h1 className="strategies-page-title">BTC Strategies</h1>
        <p className="strategies-page-subtitle">
          Paper strategy testing — Bitcoin Up or Down prediction bots
        </p>
      </div>

      {/* Bankroll / profile overview */}
      <section className="overview-row">
        <ProfileCards stats={stats} />
        <LiveCard />
        <AccountSummaryCard />
      </section>

      {/* Strategy cards grid */}
      <section className="strategy-grid">
        <PaperStrategyCard botId="paper_fastloop"       label="PAPER — FASTLOOP" />
        <PaperStrategyCard botId="paper_sniper"         label="PAPER — SNIPER" />
        <PaperCandleBiasCard />
        <PaperStrategyCard botId="paper_sweep_reclaim"  label="PAPER — SWEEP_RECLAIM" />
        <PaperStrategyCard botId="paper_breakout_close" label="PAPER — BREAKOUT_CLOSE" />
        <PaperStrategyCard botId="paper_engulfing_level" label="PAPER — ENGULFING_LEVEL" />
        <PaperStrategyCard botId="paper_rejection_wick" label="PAPER — REJECTION_WICK" />
        <PaperStrategyCard botId="paper_follow_through" label="PAPER — FOLLOW_THROUGH" />
      </section>

      {/* Activity and positions panel */}
      <DashboardContent />

    </div>
  );
}
