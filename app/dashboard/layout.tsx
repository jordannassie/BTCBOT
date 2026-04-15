import type { ReactNode } from 'react';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import './dashboard.css';
import './copy/copy.css';

// ModeBar (Trade Mode ONE/ALL) removed — product is now Copy Trading only.
// LastSaveProvider kept but unused; will be removed in Phase 2 cleanup.

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="dashboard-wrapper">
      <DashboardHeader />
      <main className="dashboard-main">{children}</main>
    </div>
  );
}
