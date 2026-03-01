import type { ReactNode } from 'react';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import './dashboard.css';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="dashboard-wrapper">
      <DashboardHeader />
      <main className="dashboard-main">{children}</main>
    </div>
  );
}
