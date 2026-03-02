'use client';

import { useState } from 'react';
import DashboardTabs from './DashboardTabs';
import StrategyFilter, { StrategyOption } from './StrategyFilter';
import ActivityStream from './ActivityStream';
import type { BotTrade } from '@/lib/botData';

type ActivitySectionProps = {
  initialTrades: BotTrade[];
};

export default function ActivitySection({ initialTrades }: ActivitySectionProps) {
  const [strategy, setStrategy] = useState<StrategyOption>('ALL');

  return (
    <>
      <div className="tabs-row">
        <DashboardTabs activeTab="activity" />
        <div className="strategy-filter-wrapper">
          <StrategyFilter value={strategy} onChange={setStrategy} />
        </div>
      </div>
      <ActivityStream initialTrades={initialTrades} strategy={strategy} />
    </>
  );
}
