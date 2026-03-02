import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET() {
  const supabaseUrl =
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!supabaseUrl.startsWith('http') || !serviceKey) {
    return NextResponse.json({ trades: [] });
  }

  const client = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false }
  });

  const { data, error } = await client
    .from('bot_trades')
    .select('*')
    .eq('bot_id', 'default')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error('Failed to load trades:', error);
    return NextResponse.json({ trades: [] }, { status: 500 });
  }

  return NextResponse.json({ trades: data ?? [] });
}
