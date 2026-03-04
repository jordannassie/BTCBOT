import type { ReactNode } from 'react';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import ModeBar from '@/components/dashboard/ModeBar';
import { LastSaveProvider } from '@/components/dashboard/LastSaveContext';
import './dashboard.css';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <LastSaveProvider>
      <div className="dashboard-wrapper">
        <DashboardHeader />
        <ModeBar />
        <main className="dashboard-main">{children}</main>
      </div>
    </LastSaveProvider>
  );
}
