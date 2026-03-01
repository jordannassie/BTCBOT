import { NextResponse } from 'next/server';
import { supabase, supabaseInitError } from '@/lib/supabaseClient';

export async function GET() {
  if (supabaseInitError) {
    return NextResponse.json(
      {
        status: 'error',
        message: `Supabase client could not be created: ${supabaseInitError.message}`,
        session: null
      },
      { status: 500 }
    );
  }

  if (!supabase) {
    return NextResponse.json(
      {
        status: 'error',
        message: 'Supabase client is unavailable.',
        session: null
      },
      { status: 500 }
    );
  }

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
