'use client';

import { useState } from 'react';
import StrategyFilter, { StrategyOption } from './StrategyFilter';
import PaperPositionsPanel from './PaperPositionsPanel';
import ActivityStream from './ActivityStream';

type Tab = 'positions' | 'activity';

export default function DashboardContent() {
  const [activeTab, setActiveTab] = useState<Tab>('positions');
  const [strategy, setStrategy] = useState<StrategyOption>('ALL');

  return (
    <>
      <div className="tabs-row">
        <div className="dashboard-tabs">
          <button
            className={`tab ${activeTab === 'positions' ? 'active' : ''}`}
            onClick={() => setActiveTab('positions')}
          >
            Positions
          </button>
          <button
            className={`tab ${activeTab === 'activity' ? 'active' : ''}`}
            onClick={() => setActiveTab('activity')}
          >
            Activity
          </button>
        </div>
        <StrategyFilter value={strategy} onChange={setStrategy} />
      </div>

      {activeTab === 'positions' && <PaperPositionsPanel strategy={strategy} />}
      {activeTab === 'activity' && <ActivityStream initialTrades={[]} strategy={strategy} />}
    </>
  );
}
