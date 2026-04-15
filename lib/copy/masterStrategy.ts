// Master Strategy — shared type and Supabase helper used by all bot-creation routes.
//
// Storage: bot_settings row, bot_id = 'copy_master_strategy'
//   strategy_settings JSONB → { master: MasterStrategy, use_for_new_bots: boolean }
//
// All server-side routes import from here to keep the type and read logic in one place.

export const MASTER_STRATEGY_BOT_ID = 'copy_master_strategy';

// localStorage key used by CopyBotsSection to share the current selection
// with MasterStrategySection ("Apply to Selected Bots").
export const SELECTED_BOTS_LS_KEY = 'btcbot-selected-bot-ids';

export type MasterStrategy = {
  mode: 'PAPER' | 'LIVE';
  copy_mode: 'exact' | 'scaled' | 'percent';
  sizing_value: number;
  max_trade_size: number;
  max_open_positions: number;   // 0 = unlimited
  max_trades_per_hour: number;  // 0 = unlimited
  max_slippage: number;
  delay_seconds: number;
  opens_only: boolean;
  copy_closes: boolean;
  is_enabled: boolean;
  arm_live: boolean;
  notes: string | null;
};

export const MASTER_STRATEGY_DEFAULTS: MasterStrategy = {
  mode: 'PAPER',
  copy_mode: 'scaled',
  sizing_value: 1,
  max_trade_size: 25,
  max_open_positions: 0,
  max_trades_per_hour: 0,
  max_slippage: 0.03,
  delay_seconds: 0,
  opens_only: false,
  copy_closes: true,
  is_enabled: true,
  arm_live: false,
  notes: null,
};

// Preset templates. Loading a preset fills the form but does not save.
export const MASTER_STRATEGY_PRESETS: Record<string, Partial<MasterStrategy>> = {
  'Paper Test': {
    mode: 'PAPER', copy_mode: 'exact', sizing_value: 5, max_trade_size: 10,
    max_open_positions: 5, max_trades_per_hour: 10,
    max_slippage: 0.03, delay_seconds: 0,
    opens_only: false, copy_closes: true, is_enabled: true, arm_live: false,
  },
  'Live Small': {
    mode: 'LIVE', copy_mode: 'exact', sizing_value: 15, max_trade_size: 25,
    max_open_positions: 3, max_trades_per_hour: 5,
    max_slippage: 0.02, delay_seconds: 2,
    opens_only: true, copy_closes: false, is_enabled: true, arm_live: false,
  },
  'Conservative': {
    mode: 'PAPER', copy_mode: 'scaled', sizing_value: 0.5, max_trade_size: 20,
    max_open_positions: 5, max_trades_per_hour: 5,
    max_slippage: 0.02, delay_seconds: 5,
    opens_only: false, copy_closes: true, is_enabled: true, arm_live: false,
  },
  'Aggressive': {
    mode: 'PAPER', copy_mode: 'scaled', sizing_value: 2, max_trade_size: 100,
    max_open_positions: 0, max_trades_per_hour: 0,
    max_slippage: 0.05, delay_seconds: 0,
    opens_only: false, copy_closes: true, is_enabled: true, arm_live: false,
  },
  '% Compounding': {
    mode: 'PAPER', copy_mode: 'percent', sizing_value: 5, max_trade_size: 50,
    max_open_positions: 0, max_trades_per_hour: 0,
    max_slippage: 0.03, delay_seconds: 0,
    opens_only: false, copy_closes: true, is_enabled: true, arm_live: false,
  },
};

// Duck-typed client: the helper works with any Supabase client variant.
// Using a loose signature avoids type-parameter mismatch between routes.
// eslint-disable-next-line
type Client = { from: (table: string) => ReturnType<any> };

type StoredSettings = {
  master?: MasterStrategy;
  use_for_new_bots?: boolean;
};

/**
 * Read master strategy + use_for_new_bots from bot_settings.
 * Safe to call from any API route. Returns nulls/false on error.
 */
export async function getMasterStrategyRow(client: Client): Promise<{
  strategy: MasterStrategy | null;
  use_for_new_bots: boolean;
}> {
  try {
    const { data } = await client
      .from('bot_settings')
      .select('strategy_settings')
      .eq('bot_id', MASTER_STRATEGY_BOT_ID)
      .maybeSingle();

    const s = (data?.strategy_settings ?? {}) as StoredSettings;
    return {
      strategy: s.master ?? null,
      use_for_new_bots: s.use_for_new_bots ?? false,
    };
  } catch {
    return { strategy: null, use_for_new_bots: false };
  }
}

/**
 * Returns the effective bot defaults for new bot creation.
 * When use_for_new_bots is ON and a strategy is saved, overlays those fields
 * on top of the provided fallback. Otherwise returns the fallback unchanged.
 */
export async function getEffectiveBotDefaults(
  client: Client,
  fallback: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const { strategy, use_for_new_bots } = await getMasterStrategyRow(client);
  if (use_for_new_bots && strategy) {
    // Spread master strategy fields over the fallback defaults.
    // name and wallet_address are always caller-supplied; never overwrite them here.
    const { notes, ...rest } = strategy;
    return {
      ...fallback,
      ...rest,
      ...(notes !== null ? { notes } : {}),
    };
  }
  return fallback;
}
