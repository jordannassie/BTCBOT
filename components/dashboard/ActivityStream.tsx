'use client';

import { useEffect, useState } from 'react';
import type { BotTrade } from '@/lib/botData';
import ActivityList from './ActivityList';

type ActivityStreamProps = {
  initialTrades: BotTrade[];
};

export default function ActivityStream({ initialTrades }: ActivityStreamProps) {
  const [trades, setTrades] = useState(initialTrades);

  useEffect(() => {
    let isMounted = true;

    const fetchTrades = async () => {
      try {
        const response = await fetch('/api/bot-trades', { cache: 'no-store' });
        if (!response.ok) return;
        const payload = await response.json();
        if (isMounted && payload.trades) {
          setTrades(payload.trades);
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

  return <ActivityList trades={trades} />;
}
