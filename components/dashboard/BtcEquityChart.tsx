'use client';

// BtcEquityChart — pure SVG line chart for btc_5m_late paper equity curve.
// No external chart library required.
// Data source: GET /api/crypto/bots → bots[0].equity_curve (sorted ASC by closed_at)

import { useState } from 'react';

export type EquityPoint = {
  position_id?: string | null;
  market_slug?:  string | null;
  closed_at?:    string | null;
  trade_pnl?:    number | null;
  equity?:       number | null;
  side?:         string | null;
  result?:       string | null;
};

type Props = {
  curve:           EquityPoint[];
  startingBalance: number;
};

const CHART_H = 180;   // SVG height px
const PAD_L   = 56;    // left padding for y-axis labels
const PAD_R   = 12;
const PAD_T   = 16;
const PAD_B   = 28;    // bottom padding for x-axis

export default function BtcEquityChart({ curve, startingBalance }: Props) {
  const [hover, setHover] = useState<{ idx: number; x: number; y: number } | null>(null);

  if (curve.length === 0) {
    return (
      <div style={{
        textAlign: 'center', padding: '2.5rem 1rem',
        color: 'rgba(248,250,252,0.3)', fontSize: '0.8rem',
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: '0.5rem',
      }}>
        No settled BTC trades yet
      </div>
    );
  }

  // Include starting point (balance before any trades)
  const allEquities = [startingBalance, ...curve.map((p) => Number(p.equity ?? startingBalance))];
  const minEq = Math.min(...allEquities);
  const maxEq = Math.max(...allEquities);
  const range = maxEq - minEq || 1;

  // Total points including starting balance
  const totalPts = curve.length + 1;  // +1 for the starting point

  // Map data → SVG coords (uses placeholder width; SVG viewBox scales)
  const W = 600;  // viewBox width
  const innerW = W - PAD_L - PAD_R;
  const innerH = CHART_H - PAD_T - PAD_B;

  const xOf = (i: number) => PAD_L + (i / Math.max(totalPts - 1, 1)) * innerW;
  const yOf = (eq: number) => PAD_T + innerH - ((eq - minEq) / range) * innerH;

  // Build path points: [starting balance, ...equity curve]
  const pts: { x: number; y: number }[] = [
    { x: xOf(0), y: yOf(startingBalance) },
    ...curve.map((p, i) => ({ x: xOf(i + 1), y: yOf(Number(p.equity ?? startingBalance)) })),
  ];

  const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

  // Fill area under the line
  const fillD = `${pathD} L${pts[pts.length - 1].x.toFixed(1)} ${(PAD_T + innerH).toFixed(1)} L${pts[0].x.toFixed(1)} ${(PAD_T + innerH).toFixed(1)} Z`;

  // Y-axis tick labels (3 ticks: min, mid, max)
  const yTicks = [minEq, (minEq + maxEq) / 2, maxEq];

  // Latest equity (last curve point)
  const latestEquity = curve.length > 0 ? Number(curve[curve.length - 1].equity ?? startingBalance) : startingBalance;
  const pnlTotal = latestEquity - startingBalance;
  const chartColor = pnlTotal >= 0 ? '#34d399' : '#f87171';

  // X-axis: show first and last dates
  const fmtDate = (iso: string | null | undefined) => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString([], { month: 'numeric', day: 'numeric' });
  };

  const hoveredData = hover !== null
    ? (hover.idx === 0 ? null : curve[hover.idx - 1])
    : null;

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      {/* Equity summary line */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.4rem' }}>
        <div style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.05em', color: 'rgba(248,250,252,0.4)', textTransform: 'uppercase' }}>
          BTC Paper Equity
        </div>
        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: chartColor }}>
          ${latestEquity.toFixed(2)}
          <span style={{ fontSize: '0.68rem', marginLeft: '0.4rem', opacity: 0.8 }}>
            ({pnlTotal >= 0 ? '+' : ''}${pnlTotal.toFixed(2)})
          </span>
        </div>
      </div>

      {/* SVG chart — preserveAspectRatio scales to container width */}
      <svg
        viewBox={`0 0 ${W} ${CHART_H}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: `${CHART_H}px`, display: 'block', overflow: 'visible' }}
        onMouseLeave={() => setHover(null)}
      >
        {/* Fill area */}
        <defs>
          <linearGradient id="eq-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={chartColor} stopOpacity="0.18" />
            <stop offset="100%" stopColor={chartColor} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={fillD} fill="url(#eq-fill)" />

        {/* Baseline at starting balance */}
        <line
          x1={PAD_L} y1={yOf(startingBalance).toFixed(1)}
          x2={W - PAD_R} y2={yOf(startingBalance).toFixed(1)}
          stroke="rgba(255,255,255,0.08)" strokeWidth="1" strokeDasharray="3 3"
        />

        {/* Y-axis labels */}
        {yTicks.map((v, i) => (
          <text key={i} x={PAD_L - 6} y={yOf(v) + 4} textAnchor="end"
            fill="rgba(248,250,252,0.28)" fontSize="10" fontFamily="monospace">
            ${v.toFixed(1)}
          </text>
        ))}

        {/* X-axis: first and last label */}
        {curve.length > 0 && (<>
          <text x={xOf(1)} y={CHART_H - 4} textAnchor="middle"
            fill="rgba(248,250,252,0.25)" fontSize="9" fontFamily="monospace">
            {fmtDate(curve[0].closed_at)}
          </text>
          {curve.length > 1 && (
            <text x={xOf(totalPts - 1)} y={CHART_H - 4} textAnchor="middle"
              fill="rgba(248,250,252,0.25)" fontSize="9" fontFamily="monospace">
              {fmtDate(curve[curve.length - 1].closed_at)}
            </text>
          )}
        </>)}

        {/* Main equity line */}
        <path d={pathD} fill="none" stroke={chartColor} strokeWidth="2" strokeLinejoin="round" />

        {/* Hover dots — invisible wider hitbox rects */}
        {pts.map((p, i) => (
          <rect
            key={i}
            x={p.x - 8} y={PAD_T - 4}
            width={16} height={innerH + 8}
            fill="transparent"
            onMouseEnter={() => setHover({ idx: i, x: p.x, y: p.y })}
          />
        ))}

        {/* Hover crosshair */}
        {hover !== null && (<>
          <line x1={hover.x} y1={PAD_T} x2={hover.x} y2={PAD_T + innerH}
            stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeDasharray="3 3" />
          <circle cx={hover.x} cy={hover.y} r={4}
            fill={chartColor} stroke="rgba(15,17,26,0.8)" strokeWidth="2" />
        </>)}
      </svg>

      {/* Tooltip */}
      {hover !== null && (() => {
        const pt = hover.idx === 0 ? null : curve[hover.idx - 1];
        const eq = hover.idx === 0
          ? startingBalance
          : Number(curve[hover.idx - 1]?.equity ?? startingBalance);
        const tipRight = hover.idx > totalPts / 2;
        return (
          <div style={{
            position: 'absolute',
            top: 0,
            left: tipRight ? 'auto' : `${(hover.idx / Math.max(totalPts - 1, 1)) * 100}%`,
            right: tipRight ? `${((totalPts - 1 - hover.idx) / Math.max(totalPts - 1, 1)) * 100}%` : 'auto',
            transform: tipRight ? 'translateX(0)' : 'translateX(-50%)',
            background: 'rgba(15,17,26,0.92)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '0.4rem',
            padding: '0.45rem 0.7rem',
            fontSize: '0.67rem',
            pointerEvents: 'none',
            zIndex: 10,
            minWidth: 140,
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          }}>
            {pt ? (<>
              <div style={{ fontWeight: 700, marginBottom: '0.2rem', color: 'rgba(248,250,252,0.8)' }}>
                {(pt.market_slug ?? '').replace(/^btc-updown-5m-/i, '') || pt.market_slug || 'Trade'}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto auto', gap: '0.1rem 0.6rem' }}>
                <span style={{ color: 'rgba(248,250,252,0.4)' }}>Side</span>
                <span style={{ fontWeight: 600, color: pt.side === 'UP' ? '#34d399' : pt.side === 'DOWN' ? '#f87171' : 'inherit' }}>{pt.side}</span>
                <span style={{ color: 'rgba(248,250,252,0.4)' }}>Result</span>
                <span style={{ fontWeight: 600, color: pt.result === 'WIN' ? '#34d399' : pt.result === 'LOSS' ? '#f87171' : '#fbbf24' }}>{pt.result}</span>
                <span style={{ color: 'rgba(248,250,252,0.4)' }}>Trade P/L</span>
                <span style={{ fontWeight: 600, color: (pt.trade_pnl ?? 0) >= 0 ? '#34d399' : '#f87171' }}>
                  {(pt.trade_pnl ?? 0) >= 0 ? '+' : ''}${(pt.trade_pnl ?? 0).toFixed(4)}
                </span>
                <span style={{ color: 'rgba(248,250,252,0.4)' }}>Equity</span>
                <span style={{ fontWeight: 600 }}>${eq.toFixed(2)}</span>
              </div>
            </>) : (
              <div style={{ color: 'rgba(248,250,252,0.6)', fontSize: '0.65rem' }}>
                Starting Balance<br />
                <span style={{ fontWeight: 700, color: '#f8fafc', fontSize: '0.75rem' }}>${startingBalance.toFixed(2)}</span>
              </div>
            )}
          </div>
        );
      })()}

      {/* Point count */}
      <div style={{ textAlign: 'right', fontSize: '0.61rem', color: 'rgba(248,250,252,0.2)', marginTop: '0.2rem' }}>
        {curve.length} settled trade{curve.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}
