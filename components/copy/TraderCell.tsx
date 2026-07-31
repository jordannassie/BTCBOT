'use client';

// TraderCell — Shared two-line trader identity cell used across all copy-trading tables.
//
// Layout:  [Guy avatar]  Trader display name  ↗
//                        0x2005d1…7875ea
//
// showAvatar (default true) shows the Guy circular avatar — set to false only in
// contexts where the containing row already shows an avatar.
//
// profileImage: real Polymarket profile URL (takes priority over the Guy default).

import SourceAvatar from './SourceAvatar';
import { getPolymarketProfileUrl } from '@/lib/polymarketProfile';
import { resolveTraderName, shortenWallet } from '@/lib/copy/traderIdentity';

type Props = {
  displayName?:   string | null;
  walletAddress?: string | null;
  username?:      string | null;
  /** If true, skip showing the shortened wallet on the secondary line */
  nameOnly?:      boolean;
  /** Show the circular Guy avatar (default: true) */
  showAvatar?:    boolean;
  /** Real Polymarket profile image URL — shown instead of Guy default when available */
  profileImage?:  string | null;
  /** Avatar diameter in px (default 28 — table row size) */
  avatarSize?:    number;
};

export default function TraderCell({
  displayName,
  walletAddress,
  username,
  nameOnly,
  showAvatar = true,
  profileImage,
  avatarSize = 28,
}: Props) {
  const name       = resolveTraderName(displayName, walletAddress);
  const profileUrl = getPolymarketProfileUrl(username ?? null, walletAddress ?? null);
  const shortAddr  = walletAddress ? shortenWallet(walletAddress) : null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
      {showAvatar && (
        <SourceAvatar
          sourceType="COPY_TRADER"
          imageUrl={profileImage}
          name={name}
          size={avatarSize}
        />
      )}

      <div style={{ lineHeight: 1.3, minWidth: 0 }}>
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
    </div>
  );
}
