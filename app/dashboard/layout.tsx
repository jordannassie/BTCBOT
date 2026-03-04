import type { ReactNode } from 'react';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import ModeBar from '@/components/dashboard/ModeBar';
import './dashboard.css';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="dashboard-wrapper">
      <DashboardHeader />
      <ModeBar />
      <main className="dashboard-main">{children}</main>
    </div>
  );
}
