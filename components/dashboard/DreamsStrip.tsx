'use client';

// DreamsStrip — personal goals/dreams scrolling image strip.
//
// Appears above the "Crypto Trading" heading on the dashboard.
// Hidden by default; user preference saved in localStorage.
//
// No trading logic. No API calls. Pure UI only.

import { useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'btcbot_dreams_visible';

const IMAGES = [
  {
    url: 'https://jyhfffqximlbhlaarozs.supabase.co/storage/v1/object/public/Storage/image/Jordan/78ec2201-350f-4a90-bbdd-be2ec36fd3cd.png',
    alt: 'Dream 1',
  },
  {
    url: 'https://jyhfffqximlbhlaarozs.supabase.co/storage/v1/object/public/Storage/image/Jordan/41d5e29b-7c8a-4afa-803d-78bed8b6e9af.png',
    alt: 'Dream 2',
  },
  {
    url: 'https://jyhfffqximlbhlaarozs.supabase.co/storage/v1/object/public/Storage/image/Jordan/b8775fb3-99a1-4736-b777-34d2c73aafcf.png',
    alt: 'Dream 3',
  },
  {
    url: 'https://jyhfffqximlbhlaarozs.supabase.co/storage/v1/object/public/Storage/image/Jordan/18a89e84-d878-42ed-bcbe-2d8a6b36b404.png',
    alt: 'Dream 4',
  },
  {
    url: 'https://jyhfffqximlbhlaarozs.supabase.co/storage/v1/object/public/Storage/image/Jordan/156dc48a-bff4-484b-b247-894c25a5efdd.png',
    alt: 'Dream 5',
  },
] as const;

// Duplicate images so the strip loops seamlessly.
// The animation translates from 0 → -50%, which aligns exactly
// one copy's width, then snaps back invisibly.
const LOOP_IMAGES = [...IMAGES, ...IMAGES];

export default function DreamsStrip() {
  const [visible,    setVisible]    = useState<boolean | null>(null); // null = not hydrated yet
  const [paused,     setPaused]     = useState(false);
  const stripRef                    = useRef<HTMLDivElement>(null);

  // Hydrate from localStorage after mount (avoids SSR mismatch)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      setVisible(stored === 'true'); // default false (hidden)
    } catch {
      setVisible(false);
    }
  }, []);

  const toggle = (show: boolean) => {
    setVisible(show);
    try { localStorage.setItem(STORAGE_KEY, String(show)); } catch { /* noop */ }
  };

  // Nothing to render until hydrated (avoids layout shift)
  if (visible === null) return null;

  // ── Collapsed: show only a subtle "Show Dreams" pill ──────────────────────
  if (!visible) {
    return (
      <div style={{
        display:        'flex',
        justifyContent: 'flex-start',
        marginBottom:   '0.5rem',
      }}>
        <button
          onClick={() => toggle(true)}
          style={{
            background:    'rgba(255,255,255,0.04)',
            border:        '1px solid rgba(255,255,255,0.09)',
            borderRadius:  '0.45rem',
            padding:       '0.2rem 0.65rem',
            fontSize:      '0.6rem',
            fontWeight:    600,
            letterSpacing: '0.05em',
            color:         'rgba(248,250,252,0.3)',
            cursor:        'pointer',
            transition:    'color 0.15s, border-color 0.15s',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = 'rgba(248,250,252,0.6)';
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.18)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = 'rgba(248,250,252,0.3)';
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.09)';
          }}
        >
          ✦ Show Dreams
        </button>
      </div>
    );
  }

  // ── Expanded: title + scrolling strip ─────────────────────────────────────
  return (
    <>
      {/* Inject keyframe animation into the document once */}
      <style>{`
        @keyframes dreams-scroll {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .dreams-track {
          display:   flex;
          gap:       0.75rem;
          width:     max-content;
          animation: dreams-scroll 28s linear infinite;
        }
        .dreams-track.paused {
          animation-play-state: paused;
        }
      `}</style>

      <div style={{ marginBottom: '0.85rem' }}>
        {/* ── Header row ── */}
        <div style={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',
          marginBottom:   '0.55rem',
        }}>
          <span style={{
            fontSize:      '0.6rem',
            fontWeight:    800,
            letterSpacing: '0.1em',
            color:         'rgba(248,250,252,0.35)',
          }}>
            ✦ MY DREAMS
          </span>
          <button
            onClick={() => toggle(false)}
            style={{
              background:    'none',
              border:        '1px solid rgba(255,255,255,0.09)',
              borderRadius:  '0.4rem',
              padding:       '0.15rem 0.55rem',
              fontSize:      '0.58rem',
              fontWeight:    600,
              letterSpacing: '0.04em',
              color:         'rgba(248,250,252,0.28)',
              cursor:        'pointer',
              transition:    'color 0.15s, border-color 0.15s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = 'rgba(248,250,252,0.55)';
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.18)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = 'rgba(248,250,252,0.28)';
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.09)';
            }}
          >
            Hide Dreams
          </button>
        </div>

        {/* ── Tagline ── */}
        <p style={{
          margin:      '0 0 0.55rem 0',
          fontSize:    '0.95rem',
          fontWeight:  400,
          color:       'rgba(248,250,252,0.75)',
          lineHeight:  1.4,
        }}>
          I&apos;m Going to Be a Billionaire
        </p>

        {/* ── Scrolling strip ── */}
        <div
          ref={stripRef}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          style={{
            overflow:                 'hidden',
            borderRadius:             '0.65rem',
            border:                   '1px solid rgba(255,255,255,0.07)',
            background:               'rgba(255,255,255,0.02)',
            /* Allow manual swipe / drag on touch/desktop */
            overflowX:                'auto',
            /* Hide scrollbar but keep functionality */
            scrollbarWidth:           'none',
            msOverflowStyle:          'none' as React.CSSProperties['msOverflowStyle'],
            WebkitOverflowScrolling:  'touch' as React.CSSProperties['WebkitOverflowScrolling'],
            cursor:                   'grab',
            padding:                  '0.5rem',
          } as React.CSSProperties}
        >
          <div className={`dreams-track${paused ? ' paused' : ''}`}>
            {LOOP_IMAGES.map((img, i) => (
              <div
                key={i}
                style={{
                  flexShrink:   0,
                  width:        'clamp(160px, 28vw, 300px)',
                  height:       'clamp(110px, 16vw, 200px)',
                  borderRadius: '0.55rem',
                  overflow:     'hidden',
                  border:       '1px solid rgba(255,255,255,0.08)',
                  background:   'rgba(255,255,255,0.03)',
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt={img.alt}
                  draggable={false}
                  style={{
                    width:      '100%',
                    height:     '100%',
                    objectFit:  'cover',
                    display:    'block',
                    userSelect: 'none',
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
