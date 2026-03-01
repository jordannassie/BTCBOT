import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

const ensureValidSupabaseUrl = (value: string | undefined): string => {
  if (!value) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is missing. Define it in Netlify or your local .env.');
  }

  try {
    const parsed = new URL(value);
    if (!['https:', 'http:'].includes(parsed.protocol)) {
      throw new Error();
    }
    return parsed.toString().replace(/\/$/, '');
  } catch (error) {
    throw new Error(
      `NEXT_PUBLIC_SUPABASE_URL is invalid ("${value ?? 'undefined'}"). Use the full https:// Supabase project URL.`
    );
  }
};

const ensureAnonKey = (value: string | undefined): string => {
  if (!value) {
    throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is missing. Define it in Netlify or your local .env.');
  }

  return value;
};

type SupabaseSetup = {
  client: SupabaseClient | null;
  error: Error | null;
};

const createSupabaseClient = (): SupabaseSetup => {
  try {
    const validatedUrl = ensureValidSupabaseUrl(supabaseUrl);
    const validatedAnonKey = ensureAnonKey(supabaseAnonKey);

    return {
      client: createClient(validatedUrl, validatedAnonKey, {
        auth: {
          detectSessionInUrl: false,
          persistSession: true
        }
      }),
      error: null
    };
  } catch (error) {
    return {
      client: null,
      error: error instanceof Error ? error : new Error('Unknown Supabase error.')
    };
  }
};

const { client, error } = createSupabaseClient();

export const supabase = client;
export const supabaseInitError = error;
