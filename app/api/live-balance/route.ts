'use server';

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const BOT_ID = 'default';

const ensureEnv = () => {
  const host = process.env.POLY_CLOB_HOST?.trim() || 'https://api.polymarket.com';
  const apiKey = process.env.POLY_CLOB_API_KEY?.trim();
  const apiSecret = process.env.POLY_CLOB_API_SECRET?.trim();
  const passphrase = process.env.POLY_CLOB_API_PASSPHRASE?.trim();
  if (!apiKey || !apiSecret || !passphrase) {
    throw new Error('Polymarket CLOB credentials are missing.');
  }
  return {
    host,
    apiKey,
    apiSecret,
    passphrase
  };
};

async function fetchLiveBalance(host: string, apiKey: string, apiSecret: string, passphrase: string) {
  // Placeholder: the actual Polymarket CLOB signature is not specified.
  const response = await fetch(`${host}/v1/account/balance?currency=USDC`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': apiKey,
      'X-API-SECRET': apiSecret,
      'X-API-PASSPHRASE': passphrase
    }
  });

  if (!response.ok) {
    throw new Error(`Polymarket CLOB error: ${response.status}`);
  }

  const payload = await response.json();
  const balance = Number(payload?.balance_usd ?? 0);
  const updatedAt = payload?.updated_at ?? new Date().toISOString();
  return {
    balance: Math.round(balance * 100) / 100,
    updatedAt
  };
}

export async function GET() {
  const supabaseUrl =
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!supabaseUrl.startsWith('http') || !serviceKey) {
    return NextResponse.json({ ok: false, error: 'Supabase credentials missing' }, { status: 500 });
  }

  try {
    const { host, apiKey, apiSecret, passphrase } = ensureEnv();
    const { balance, updatedAt } = await fetchLiveBalance(host, apiKey, apiSecret, passphrase);

    const client = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    await client
      .from('bot_settings')
      .update({
        live_balance_usd: balance,
        live_updated_at: updatedAt
      })
      .eq('bot_id', BOT_ID);

    const response = NextResponse.json({
      ok: true,
      live_balance_usd: balance,
      live_updated_at: updatedAt
    });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
