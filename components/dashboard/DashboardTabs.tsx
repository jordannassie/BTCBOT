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
