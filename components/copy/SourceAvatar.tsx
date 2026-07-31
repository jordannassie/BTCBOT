'use client';

// SourceAvatar — reusable circular avatar for trader-copy vs crypto-bot source identity.
//
// sourceType: 'COPY_TRADER' — Guy avatar  (amber border tint)
//             'BTC_CRYPTO'  — BTC avatar  (orange border tint)
//
// Priority: imageUrl (real Polymarket profile) → source-type default → initials fallback
// onError:  automatic fallback to source default, prevents broken-image icons.
//
// This is UI / asset-mapping only. No trading logic, accounting, or DB calls.

import { CSSProperties } from 'react';

// ── Confirmed Supabase Storage public URLs ────────────────────────────────────
export const TRADER_AVATAR_URL =
  'https://jyhfffqximlbhlaarozs.supabase.co/storage/v1/object/public/Storage/image/Guy.png';

export const BTC_AVATAR_URL =
  'https://jyhfffqximlbhlaarozs.supabase.co/storage/v1/object/public/Storage/image/Crypto/BTCfullsize.webp';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SourceType = 'COPY_TRADER' | 'BTC_CRYPTO';

export type SourceIdentity = {
  sourceType: SourceType;
  avatar:     string;
  label:      string;
  fallback:   string;
};

// ── Helper ────────────────────────────────────────────────────────────────────

export function getSourceIdentity(sourceType: SourceType): SourceIdentity {
  return sourceType === 'BTC_CRYPTO'
    ? { sourceType, avatar: BTC_AVATAR_URL,   label: 'BTC 5-Min',   fallback: 'BTC' }
    : { sourceType, avatar: TRADER_AVATAR_URL, label: 'Copy Trader', fallback: 'CT'  };
}

// ── SourceAvatar component ────────────────────────────────────────────────────

type Props = {
  /** Distinguishes copy-trader rows from BTC crypto-bot rows */
  sourceType:  SourceType;
  /** Real Polymarket profile image URL — takes priority over type default */
  imageUrl?:   string | null;
  /** Used for alt text and title tooltip */
  name?:       string | null;
  /** Diameter in px. Recommended: 24 (bankroll), 28 (tables), 32 (cards), 40 (main card) */
  size?:       number;
  className?:  string;
  style?:      CSSProperties;
};

export default function SourceAvatar({
  sourceType,
  imageUrl,
  name,
  size = 32,
  className,
  style,
}: Props) {
  const identity = getSourceIdentity(sourceType);
  const primary  = imageUrl && imageUrl.startsWith('http') ? imageUrl : identity.avatar;

  const borderColor =
    sourceType === 'BTC_CRYPTO'
      ? 'rgba(251,146,60,0.45)'   // orange tint — BTC
      : 'rgba(251,191,36,0.35)';  // amber tint  — copy trader

  return (
    <img
      src={primary}
      alt={name ?? identity.label}
      title={name ?? identity.label}
      className={className}
      onError={(e) => {
        const img = e.currentTarget;
        // Prevent infinite loop: only switch once to the type default
        if (img.src !== identity.avatar) {
          img.src     = identity.avatar;
          img.onerror = null;
        } else {
          img.style.visibility = 'hidden'; // last resort: hide broken icon
        }
      }}
      style={{
        width:        size,
        height:       size,
        minWidth:     size,
        borderRadius: '50%',
        objectFit:    'cover',
        border:       `1.5px solid ${borderColor}`,
        flexShrink:   0,
        display:      'block',
        ...style,
      }}
    />
  );
}
