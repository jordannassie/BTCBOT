ALTER TABLE public.bot_settings
ADD COLUMN IF NOT EXISTS copy_target_wallet text;

ALTER TABLE public.bot_settings
ADD COLUMN IF NOT EXISTS scalper_entry_price numeric;

ALTER TABLE public.bot_settings
ADD COLUMN IF NOT EXISTS scalper_take_profit_delta numeric;

ALTER TABLE public.bot_settings
ADD COLUMN IF NOT EXISTS scalper_stop_loss_delta numeric;

ALTER TABLE public.bot_settings
ADD COLUMN IF NOT EXISTS scalper_max_hold_seconds integer;
