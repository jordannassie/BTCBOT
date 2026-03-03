import { NextResponse } from 'next/server';
import { getStrategyPnl24h } from '@/lib/strategyPnl';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const botId = url.searchParams.get('bot_id');

  if (!botId) {
    return NextResponse.json({ ok: false, error: 'bot_id is required' }, { status: 400 });
  }

  try {
    const pnl24h = await getStrategyPnl24h(botId);
    return NextResponse.json({ ok: true, bot_id: botId, pnl_24h: pnl24h });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
