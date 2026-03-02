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
