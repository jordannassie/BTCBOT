// LEGACY — not mounted anywhere in the current dashboard.
// This was an earlier composition of DashboardTabs + PaperPositionsPanel using
// Next.js route-based tab navigation. Replaced by DashboardContent, which
// handles both Positions and Activity tabs via client-side state.
// Safe to delete once DashboardTabs is also removed.

'use client';

import { useState } from 'react';
import DashboardTabs from './DashboardTabs';
import StrategyFilter, { StrategyOption } from './StrategyFilter';
import PaperPositionsPanel from './PaperPositionsPanel';

export default function PositionsSection() {
  const [strategy, setStrategy] = useState<StrategyOption>('ALL');

  return (
    <>
      <div className="tabs-row">
        <DashboardTabs activeTab="positions" />
        <div className="strategy-filter-wrapper">
          <StrategyFilter value={strategy} onChange={setStrategy} />
        </div>
      </div>
      <PaperPositionsPanel strategy={strategy} />
    </>
  );
}
