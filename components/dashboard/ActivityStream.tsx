'use client';

import { useEffect, useState } from 'react';
import type { BotTrade } from '@/lib/botData';
import ActivityList from './ActivityList';

type ActivityStreamProps = {
  initialTrades: BotTrade[];
};

export default function ActivityStream({ initialTrades }: ActivityStreamProps) {
  const [trades, setTrades] = useState<BotTrade[]>(Array.isArray(initialTrades) ? initialTrades : []);

  useEffect(() => {
    let isMounted = true;

    const fetchTrades = async () => {
      try {
        const response = await fetch('/api/bot-trades', { cache: 'no-store' });
        if (!response.ok) return;
        const payload = await response.json();
        if (isMounted && payload.trades) {
          setTrades(Array.isArray(payload.trades) ? payload.trades : []);
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
  }, []);

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
