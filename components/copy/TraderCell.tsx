'use client';

// TraderCell — Shared two-line trader identity cell used across all copy-trading tables.
//
// Primary line:  Trader display name  ↗ (profile link)
// Secondary line: 0x2005d1…7875ea

import { getPolymarketProfileUrl } from '@/lib/polymarketProfile';
import { resolveTraderName, shortenWallet } from '@/lib/copy/traderIdentity';

type Props = {
  displayName?:  string | null;
  walletAddress?: string | null;
  username?:     string | null;
  /** If true, skip showing the shortened wallet on the secondary line */
  nameOnly?:     boolean;
};

export default function TraderCell({ displayName, walletAddress, username, nameOnly }: Props) {
  const name        = resolveTraderName(displayName, walletAddress);
  const profileUrl  = getPolymarketProfileUrl(username ?? null, walletAddress ?? null);
  const shortAddr   = walletAddress ? shortenWallet(walletAddress) : null;

  return (
    <div style={{ lineHeight: 1.3 }}>
      {/* Primary: name + profile link */}
      {profileUrl ? (
        <a
          href={profileUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="View on Polymarket"
          style={{
            textDecoration: 'none',
            color: 'inherit',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.2rem',
          }}
        >
          <span>{name}</span>
          <span style={{ fontSize: '0.6rem', opacity: 0.4 }}>↗</span>
        </a>
      ) : (
        <span>{name}</span>
      )}

      {/* Secondary: shortened wallet address */}
      {!nameOnly && shortAddr && (
        <div
          className="copy-td-sub copy-mono"
          style={{ fontSize: '0.68rem', color: 'rgba(248,250,252,0.35)', marginTop: '0.1rem' }}
        >
          {shortAddr}
        </div>
      )}
    </div>
  );
}
