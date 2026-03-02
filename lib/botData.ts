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
  total_notional: number;
};

export type DashboardStats = {
  settings: BotSettings | null;
  heartbeat: BotHeartbeat | null;
  positionsValue: number;
  tradesLast30Days: number;
  totalTrades: number;
  positionGroups: PositionGroup[];
  latestTrades: BotTrade[];
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

export type PaperEquityResult = {
  range: '1D' | '1W' | '1M' | 'ALL';
  start_equity: number;
  end_equity: number;
  pnl: number;
  points: { t: number; equity: number }[];
};

export async function fetchPaperEquity(range: '1D' | '1W' | '1M' | 'ALL'): Promise<PaperEquityResult | null> {
  const baseUrl =
    process.env.URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

  try {
    const response = await fetch(`${baseUrl}/api/paper-equity?range=${range}`, { cache: 'no-store' });
    if (!response.ok) {
      console.error('paper equity API error', response.status, await response.text());
      return null;
    }

    const payload = await response.json();
    if (!payload.ok) {
      console.error('paper equity payload error', payload.error);
      return null;
    }

    return {
      range: payload.range,
      start_equity: Number(payload.start_equity ?? 0),
      end_equity: Number(payload.end_equity ?? 0),
      pnl: Number(payload.pnl ?? 0),
      points: Array.isArray(payload.points) ? payload.points : []
    };
  } catch (error) {
    console.error('Error fetching paper equity via API', error);
    return null;
  }
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const [settings, heartbeat, trades] = await Promise.all([
    getBotSettings(),
    getBotHeartbeat(),
    getBotTrades(250)
  ]);

  const positionGroups = groupTradesByMarket(trades);

  const positionsValue = positionGroups.reduce((sum, group) => sum + group.total_notional, 0);

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const tradesLast30Days = trades.filter((trade) => new Date(trade.created_at) >= thirtyDaysAgo).length;

  return {
    settings,
    heartbeat,
    positionsValue,
    tradesLast30Days,
    totalTrades: trades.length,
    positionGroups,
    latestTrades: trades.slice(0, 30)
  };
}

function groupTradesByMarket(trades: BotTrade[]): PositionGroup[] {
  const aggregated = trades.reduce((acc, trade) => {
    const slug = trade.market_slug ?? trade.market ?? 'unknown';
    const existing = acc.get(slug) ?? {
      market_slug: slug,
      side: trade.side ?? 'unknown',
      total_size: 0,
      trade_count: 0,
      avg_price: 0,
      status: trade.status ?? 'unknown',
      last_updated: trade.created_at,
      total_notional: 0
    };

    const size = trade.size ?? 0;
    const price = trade.price ?? 0;

    existing.total_size += size;
    existing.total_notional += price * size;
    existing.trade_count += 1;

    if (!existing.last_updated || new Date(trade.created_at) > new Date(existing.last_updated)) {
      existing.last_updated = trade.created_at;
      existing.status = trade.status ?? existing.status;
      existing.side = trade.side ?? existing.side;
    }

    acc.set(slug, existing);
    return acc;
  }, new Map<string, PositionGroup>());

  return Array.from(aggregated.values())
    .map((group) => ({
      ...group,
      avg_price: group.total_size > 0 ? group.total_notional / group.total_size : 0
    }))
    .sort((a, b) => b.total_notional - a.total_notional);
}
