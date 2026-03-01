import { NextResponse } from 'next/server';
import { getBotSettings } from '@/lib/botData';

export async function GET() {
  try {
    const settings = await getBotSettings();
    return NextResponse.json({ settings });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}
