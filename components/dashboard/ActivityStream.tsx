'use client';

import { useEffect, useState } from 'react';
import type { BotTrade } from '@/lib/botData';
import ActivityList from './ActivityList';
import type { StrategyOption } from './StrategyFilter';

type ActivityStreamProps = {
  initialTrades: BotTrade[];
  strategy: StrategyOption;
};

export default function ActivityStream({ initialTrades, strategy }: ActivityStreamProps) {
  const [trades, setTrades] = useState<BotTrade[]>(
    Array.isArray(initialTrades)
      ? initialTrades.filter((trade) =>
          strategy === 'ALL' ? true : (trade.strategy_id ?? '').toUpperCase() === strategy
        )
      : []
  );

  useEffect(() => {
    let isMounted = true;

    const fetchTrades = async () => {
      try {
        const base = '/api/bot-trades';
        const params = new URLSearchParams();
        if (strategy !== 'ALL') params.set('strategy', strategy);
        params.set('_t', String(Date.now()));
        const response = await fetch(`${base}?${params.toString()}`, { cache: 'no-store' });
        if (!response.ok) return;
        const payload = await response.json();
        if (isMounted && payload.trades) {
          const allTrades: BotTrade[] = Array.isArray(payload.trades) ? payload.trades : [];
          setTrades(
            allTrades.filter((trade) =>
              strategy === 'ALL' ? true : (trade.strategy_id ?? '').toUpperCase() === strategy
            )
          );
        }
      } catch (error) {
        console.error('Failed to refresh trades', error);
      }
    };

    fetchTrades();
    const interval = setInterval(fetchTrades, 5000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [strategy]);

  try {
    return <ActivityList trades={trades} />;
  } catch (error) {
    console.error('Activity list render error', error);
    return (
      <div className="activity-container">
        <div className="activity-table">
          <div className="empty-state">
            <p>Unable to render activity.</p>
            <p className="empty-subtitle">Try refreshing the page.</p>
          </div>
        </div>
      </div>
    );
  }
}
