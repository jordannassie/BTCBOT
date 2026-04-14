// LEGACY — not mounted anywhere in the current dashboard.
// This component renders Next.js Link-based tab navigation pointing to
// /dashboard (positions) and /dashboard/activity. The activity route is a
// redirect stub (sends users back to /dashboard), so the Activity link is
// effectively broken. The active dashboard uses DashboardContent instead,
// which handles tabs via client-side state.
// Safe to delete once PositionsSection and ActivitySection are also removed.

import Link from 'next/link';

type DashboardTabsProps = {
  activeTab: 'positions' | 'activity';
};

export default function DashboardTabs({ activeTab }: DashboardTabsProps) {
  return (
    <div className="dashboard-tabs">
      <Link 
        href="/dashboard" 
        className={`tab ${activeTab === 'positions' ? 'active' : ''}`}
      >
        Positions
      </Link>
      <Link 
        href="/dashboard/activity" 
        className={`tab ${activeTab === 'activity' ? 'active' : ''}`}
      >
        Activity
      </Link>
    </div>
  );
}
