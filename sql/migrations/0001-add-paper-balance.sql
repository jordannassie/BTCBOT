ALTER TABLE public.bot_settings
ADD COLUMN IF NOT EXISTS paper_balance_usd numeric NOT NULL DEFAULT 50;
