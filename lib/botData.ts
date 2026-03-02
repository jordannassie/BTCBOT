import { supabase } from './supabaseClient';

export type BotSettings = {
  bot_id: string;
  is_enabled: boolean;
  mode: 'PAPER' | 'LIVE';
  edge_threshold?: number | null;
  max_trades_per_hour?: number | null;
  paper_balance_usd?: number | null;
  trade_size?: number | null;
  trade_size_usd?: number | null;
  paper_pnl_usd?: number | null;
  created_at?: string;
  updated_at?: string;
};

export type BotHeartbeat = {
  bot_id: string;
  status: string;
  last_ping: string;
  metadata?: Record<string, unknown>;
};

export type BotTrade = {
  id: string;
  bot_id: string;
  market_slug: string;
  side: string;
  size: number;
  price?: number;
  status: string;
  created_at: string;
  updated_at?: string;
  market?: string | null;
  pnl_usd?: number | null;
};

export type PositionGroup = {
  market_slug: string;
  side: string;
  total_size: number;
  trade_count: number;
  avg_price: number;
  status: string;
  last_updated: string;
};

export type PaperPosition = {
  id: string;
  bot_id: string;
  status: string;
  market_slug: string;
  side: 'yes' | 'no';
  entry_price: number;
  size_usd: number;
  opened_at: string;
};

const BOT_ID = 'default';

export async function getBotSettings(): Promise<BotSettings | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('bot_settings')
    .select('*')
    .eq('bot_id', BOT_ID)
    .single();

  if (error) {
    console.error('Error fetching bot_settings:', error);
    return null;
  }

  return data as BotSettings;
}

export async function updateBotSettings(updates: Partial<BotSettings>): Promise<boolean> {
  if (!supabase) return false;

  const { error } = await supabase
    .from('bot_settings')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('bot_id', BOT_ID);

  if (error) {
    console.error('Error updating bot_settings:', error);
    return false;
  }

  return true;
}

export async function getBotHeartbeat(): Promise<BotHeartbeat | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('bot_heartbeat')
    .select('*')
    .eq('bot_id', BOT_ID)
    .order('last_ping', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    console.error('Error fetching bot_heartbeat:', error);
    return null;
  }

  return data as BotHeartbeat;
}

export async function getBotTrades(limit = 100): Promise<BotTrade[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('bot_trades')
    .select('*')
    .eq('bot_id', BOT_ID)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Error fetching bot_trades:', error);
    return [];
  }

  return (data as BotTrade[]) || [];
}

export async function fetchOpenPaperPositions(botId: string): Promise<PaperPosition[]> {
  try {
    const baseUrl =
      process.env.URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    const response = await fetch(`${baseUrl}/api/paper-positions`, {
      cache: 'no-store'
    });

    if (!response.ok) {
      console.error('paper positions API error', response.status, await response.text());
      return [];
    }

    const payload = await response.json();
    return Array.isArray(payload.rows) ? payload.rows : [];
  } catch (error) {
    console.error('Error fetching paper positions via API:', error);
    return [];
  }
}

export type PaperPnlResult = {
  total_pnl_usd: number;
  pnl_24h_usd: number;
};

export async function fetchPaperPnl(): Promise<PaperPnlResult> {
  const baseUrl =
    process.env.URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

  try {
    const response = await fetch(`${baseUrl}/api/paper-pnl`, { cache: 'no-store' });
    if (!response.ok) {
      console.error('paper pnl API error', response.status, await response.text());
      return { total_pnl_usd: 0, pnl_24h_usd: 0 };
    }

    const payload = await response.json();
    if (!payload.ok) {
      console.error('paper pnl payload error', payload.error);
      return { total_pnl_usd: 0, pnl_24h_usd: 0 };
    }

    return {
      total_pnl_usd: Number(payload.total_pnl_usd ?? 0),
      pnl_24h_usd: Number(payload.pnl_24h_usd ?? 0)
    };
  } catch (error) {
    console.error('Error fetching paper pnl via API', error);
    return { total_pnl_usd: 0, pnl_24h_usd: 0 };
  }
}

export async function getPositions(): Promise<PositionGroup[]> {
  const trades = await getBotTrades(1000);

  const grouped = trades.reduce((acc, trade) => {
    const key = `${trade.market_slug}-${trade.side}`;
    if (!acc[key]) {
      acc[key] = {
        market_slug: trade.market_slug,
        side: trade.side,
        total_size: 0,
        trade_count: 0,
        avg_price: 0,
        status: trade.status,
        last_updated: trade.created_at,
        total_price: 0
      };
    }

    acc[key].total_size += trade.size;
    acc[key].trade_count += 1;
    acc[key].total_price += (trade.price || 0) * trade.size;

    if (new Date(trade.created_at) > new Date(acc[key].last_updated)) {
      acc[key].last_updated = trade.created_at;
      acc[key].status = trade.status;
    }

    return acc;
  }, {} as Record<string, PositionGroup & { total_price: number }>);

  return Object.values(grouped).map(({ total_price, ...pos }) => ({
    ...pos,
    avg_price: pos.total_size > 0 ? total_price / pos.total_size : 0
  }));
}

export async function getDashboardStats() {
  const settingsPromise = getBotSettings();
  const heartbeatPromise = getBotHeartbeat();
  const tradesPromise = getBotTrades(1000);
  const positionsPromise = getPositions();
  const paperPnlPromise = fetchPaperPnl();

  const [settings, heartbeat, trades, positions, paperPnl] = await Promise.all([
    settingsPromise,
    heartbeatPromise,
    tradesPromise,
    positionsPromise,
    paperPnlPromise
  ]);

  const paperPositions = await fetchOpenPaperPositions(BOT_ID);

  const positionsValue = positions.reduce((sum, p) => sum + p.total_size * p.avg_price, 0);

  const tradesLast30Days = trades.filter((t) => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return new Date(t.created_at) >= thirtyDaysAgo;
  }).length;

  return {
    settings,
    heartbeat,
    positionsValue,
    tradesLast30Days,
    totalTrades: trades.length,
    positions,
    paperPositions,
    paperPnl
  };
}
