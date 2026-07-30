// lib/polymarketProfile.ts
//
// Lightweight, read-only helper for generating Polymarket trader profile URLs.
// No side effects. No secrets exposed.

/**
 * Returns a Polymarket trader profile URL.
 *
 * Priority:
 *   1. username (e.g. from leaderboard xUsername) → https://polymarket.com/@<username>
 *   2. walletAddress                              → https://polymarket.com/@<walletAddress>
 *   3. null when neither is available
 *
 * Safely strips any leading '@' from usernames before encoding.
 */
export function getPolymarketProfileUrl(
  username?: string | null,
  walletAddress?: string | null,
): string | null {
  if (username) {
    const clean = username.replace(/^@/, '').trim();
    if (clean) return `https://polymarket.com/@${encodeURIComponent(clean)}`;
  }
  if (walletAddress) {
    return `https://polymarket.com/@${encodeURIComponent(walletAddress)}`;
  }
  return null;
}
