import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabaseClient';

export async function GET() {
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    return NextResponse.json(
      {
        status: 'error',
        message: 'Supabase returned an error: ' + error.message,
        session: null
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    status: 'ok',
    message: 'Supabase connection looks healthy.',
    session: data.session
  });
}
