// ─── Frontend Feature Flags ───────────────────────────────────────────────────
//
// Control which product surfaces are visible in the UI.
//
// NEXT_PUBLIC_SHOW_COPY_UI  — default false  → copy trading is hidden from main nav
// NEXT_PUBLIC_SHOW_CRYPTO_UI — default true  → crypto bots are the primary product
//
// Copy trading backend code and API routes are NOT deleted regardless of flags.
// The copy dashboard remains accessible at /dashboard/copy for admin/internal use.
// ─────────────────────────────────────────────────────────────────────────────

/** Show copy trading tabs, wallets, and related UI in the main dashboard */
export const SHOW_COPY_UI =
  (process.env.NEXT_PUBLIC_SHOW_COPY_UI ?? 'false') !== 'false';

/** Show crypto bot section as the primary product */
export const SHOW_CRYPTO_UI =
  (process.env.NEXT_PUBLIC_SHOW_CRYPTO_UI ?? 'true') !== 'false';
