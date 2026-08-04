'use client';

// CryptoEquityChart — shared pure-SVG equity chart for any crypto asset.
//
// Replaces the BTC-only BtcEquityChart with a generic component usable by
// BTC, ETH, SOL and XRP cards.
//
// Data source: equity_curve from GET /api/crypto/bots (sorted ASC by market_slug).
// No API calls inside this component — receives data as props.
//
// Props:
//   asset           — 'BTC' | 'ETH' | 'SOL' | 'XRP'
//   curve           — equity curve points from API (sorted ASC)
//   startingBalance — starting balance used as origin
//   accentColor     — per-asset line/fill color (optional, defaults to asset color)
//   compact         — true for mini in-card chart, false for full expanded chart

import { useState } from 'react';

export type EquityPoint = {
  position_id?: string | null;
  market_slug?: string | null;
  closed_at?:   string | null;
  trade_pnl?:   number | null;
  equity?:      number | null;
  side?:        string | null;
  result?:      string | null;
};

// ── Per-asset defaults ─────────────────────────────────────────────────────────

const ASSET_COLORS: Record<string, string> = {
  BTC: '#f97316',
  ETH: '#818cf8',
  SOL: '#a78bfa',
  XRP: '#38bdf8',
};

// ── Chart constants ────────────────────────────────────────────────────────────

const FULL_H    = 180;
const COMPACT_H = 80;
const PAD_L     = 52;
const PAD_L_C   = 6;   // compact: minimal left pad (no y-axis labels)
const PAD_R     = 12;
const PAD_T     = 14;
const PAD_B     = 26;
const PAD_B_C   = 4;   // compact: no x-axis labels
const VBOX_W    = 600;

type Props = {
  asset:           string;
  curve:           EquityPoint[];
  startingBalance: number;
  accentColor?:    string;
  compact?:        boolean;
};

export default function CryptoEquityChart({ asset, curve, startingBalance, accentColor, compact = false }: Props) {
  const [hover, setHover] = useState<{ idx: number; x: number; y: number } | null>(null);

  const color  = accentColor ?? ASSET_COLORS[asset] ?? '#818cf8';
  const CHART_H = compact ? COMPACT_H : FULL_H;
  const padL    = compact ? PAD_L_C   : PAD_L;
  const padB    = compact ? PAD_B_C   : PAD_B;

  // ── Empty state ───────────────────────────────────────────────────────────
  if (curve.length === 0) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: '0.35rem',
        height:     compact ? COMPACT_H : 140,
        background: 'rgba(255,255,255,0.02)',
        border:     '1px solid rgba(255,255,255,0.06)',
        borderRadius: '0.5rem',
        color: 'rgba(248,250,252,0.25)',
        fontSize: compact ? '0.62rem' : '0.75rem',
      }}>
        <span>No settled {asset} trades yet</span>
        {!compact && (
          <span style={{ fontSize: '0.6rem', opacity: 0.6 }}>
            Starting: ${startingBalance.toFixed(2)} · P/L: $0.00 · Trades: 0
          </span>
        )}
      </div>
    );
  }

  // ── Chart math ────────────────────────────────────────────────────────────
  const allEquities = [startingBalance, ...curve.map((p) => Number(p.equity ?? startingBalance))];
  const minEq   = Math.min(...allEquities);
  const maxEq   = Math.max(...allEquities);
  const range   = maxEq - minEq || 1;
  const totalPts = curve.length + 1;

  const innerW = VBOX_W - padL - PAD_R;
  const innerH = CHART_H - PAD_T - padB;

  const xOf = (i: number) => padL + (i / Math.max(totalPts - 1, 1)) * innerW;
  const yOf = (eq: number) => PAD_T + innerH - ((eq - minEq) / range) * innerH;

  const pts: { x: number; y: number }[] = [
    { x: xOf(0), y: yOf(startingBalance) },
    ...curve.map((p, i) => ({ x: xOf(i + 1), y: yOf(Number(p.equity ?? startingBalance)) })),
  ];

  const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const fillD = `${pathD} L${pts[pts.length - 1].x.toFixed(1)} ${(PAD_T + innerH).toFixed(1)} L${pts[0].x.toFixed(1)} ${(PAD_T + innerH).toFixed(1)} Z`;

  const yTicks     = compact ? [] : [minEq, (minEq + maxEq) / 2, maxEq];
  const latestEq   = curve.length > 0 ? Number(curve[curve.length - 1].equity ?? startingBalance) : startingBalance;
  const pnlTotal   = latestEq - startingBalance;
  const chartColor = pnlTotal >= 0 ? color : '#f87171';
  const gradId     = `eq-fill-${asset.toLowerCase()}-${compact ? 'c' : 'f'}`;

  const fmtDate = (iso: string | null | undefined) => {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString([], { month: 'numeric', day: 'numeric' });
  };

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      {/* ── Summary header (full mode only) ── */}
      {!compact && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          marginBottom: '0.4rem',
        }}>
          <div style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'rgba(248,250,252,0.35)' }}>
            {asset} Paper Equity
          </div>
          <div style={{ fontSize: '0.82rem', fontWeight: 700, color: chartColor, fontFamily: 'monospace' }}>
            ${latestEq.toFixed(2)}
            <span style={{ fontSize: '0.65rem', marginLeft: '0.35rem', opacity: 0.8 }}>
              ({pnlTotal >= 0 ? '+' : ''}${pnlTotal.toFixed(2)})
            </span>
          </div>
        </div>
      )}

      {/* ── SVG chart ── */}
      <svg
        viewBox={`0 0 ${VBOX_W} ${CHART_H}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: `${CHART_H}px`, display: 'block', overflow: 'visible' }}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={chartColor} stopOpacity="0.20" />
            <stop offset="100%" stopColor={chartColor} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Fill area */}
        <path d={fillD} fill={`url(#${gradId})`} />

        {/* Baseline */}
        <line
          x1={padL} y1={yOf(startingBalance).toFixed(1)}
          x2={VBOX_W - PAD_R} y2={yOf(startingBalance).toFixed(1)}
          stroke="rgba(255,255,255,0.08)" strokeWidth="1" strokeDasharray="3 3"
        />

        {/* Y-axis labels (full mode only) */}
        {yTicks.map((v, i) => (
          <text key={i} x={padL - 6} y={yOf(v) + 4} textAnchor="end"
            fill="rgba(248,250,252,0.25)" fontSize="10" fontFamily="monospace">
            ${v.toFixed(1)}
          </text>
        ))}

        {/* X-axis labels (full mode only) */}
        {!compact && curve.length > 0 && (
          <>
            <text x={xOf(1)} y={CHART_H - 4} textAnchor="middle"
              fill="rgba(248,250,252,0.22)" fontSize="9" fontFamily="monospace">
              {fmtDate(curve[0].closed_at)}
            </text>
            {curve.length > 1 && (
              <text x={xOf(totalPts - 1)} y={CHART_H - 4} textAnchor="middle"
                fill="rgba(248,250,252,0.22)" fontSize="9" fontFamily="monospace">
                {fmtDate(curve[curve.length - 1].closed_at)}
              </text>
            )}
          </>
        )}

        {/* Main line */}
        <path d={pathD} fill="none" stroke={chartColor} strokeWidth={compact ? 1.5 : 2} strokeLinejoin="round" />

        {/* Hover hit areas (full mode only) */}
        {!compact && pts.map((p, i) => (
          <rect key={i}
            x={p.x - 8} y={PAD_T - 4}
            width={16}  height={innerH + 8}
            fill="transparent"
            onMouseEnter={() => setHover({ idx: i, x: p.x, y: p.y })}
          />
        ))}

        {/* Crosshair */}
        {hover !== null && (
          <>
            <line x1={hover.x} y1={PAD_T} x2={hover.x} y2={PAD_T + innerH}
              stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeDasharray="3 3" />
            <circle cx={hover.x} cy={hover.y} r={4}
              fill={chartColor} stroke="rgba(15,17,26,0.8)" strokeWidth="2" />
          </>
        )}
      </svg>

      {/* ── Hover tooltip (full mode only) ── */}
      {!compact && hover !== null && (() => {
        const pt = hover.idx === 0 ? null : curve[hover.idx - 1];
        const eq = hover.idx === 0
          ? startingBalance
          : Number(curve[hover.idx - 1]?.equity ?? startingBalance);
        const tipRight = hover.idx > totalPts / 2;
        return (
          <div style={{
            position: 'absolute', top: 0,
            left:  tipRight ? 'auto' : `${(hover.idx / Math.max(totalPts - 1, 1)) * 100}%`,
            right: tipRight ? `${((totalPts - 1 - hover.idx) / Math.max(totalPts - 1, 1)) * 100}%` : 'auto',
            transform: tipRight ? 'translateX(0)' : 'translateX(-50%)',
            background: 'rgba(15,17,26,0.92)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '0.4rem', padding: '0.45rem 0.7rem',
            fontSize: '0.67rem', pointerEvents: 'none', zIndex: 10,
            minWidth: 140, boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          }}>
            {pt ? (
              <>
                <div style={{ fontWeight: 700, marginBottom: '0.2rem', color: 'rgba(248,250,252,0.8)' }}>
                  {(pt.market_slug ?? '').replace(new RegExp(`^${asset.toLowerCase()}-updown-5m-`), '') || pt.market_slug || 'Trade'}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'auto auto', gap: '0.1rem 0.6rem' }}>
                  <span style={{ color: 'rgba(248,250,252,0.4)' }}>Side</span>
                  <span style={{ fontWeight: 600, color: pt.side === 'UP' ? '#34d399' : pt.side === 'DOWN' ? '#f87171' : 'inherit' }}>{pt.side ?? '—'}</span>
                  <span style={{ color: 'rgba(248,250,252,0.4)' }}>Result</span>
                  <span style={{ fontWeight: 600, color: pt.result === 'WIN' ? '#34d399' : pt.result === 'LOSS' ? '#f87171' : '#fbbf24' }}>{pt.result ?? '—'}</span>
                  <span style={{ color: 'rgba(248,250,252,0.4)' }}>Trade P/L</span>
                  <span style={{ fontWeight: 600, color: (pt.trade_pnl ?? 0) >= 0 ? '#34d399' : '#f87171' }}>
                    {(pt.trade_pnl ?? 0) >= 0 ? '+' : ''}${(pt.trade_pnl ?? 0).toFixed(4)}
                  </span>
                  <span style={{ color: 'rgba(248,250,252,0.4)' }}>Equity</span>
                  <span style={{ fontWeight: 600 }}>${eq.toFixed(2)}</span>
                </div>
              </>
            ) : (
              <div style={{ color: 'rgba(248,250,252,0.6)', fontSize: '0.65rem' }}>
                Starting Balance<br />
                <span style={{ fontWeight: 700, color: '#f8fafc', fontSize: '0.75rem' }}>${startingBalance.toFixed(2)}</span>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Trade count footer (full mode) ── */}
      {!compact && (
        <div style={{ textAlign: 'right', fontSize: '0.6rem', color: 'rgba(248,250,252,0.2)', marginTop: '0.2rem' }}>
          {curve.length} settled trade{curve.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}
