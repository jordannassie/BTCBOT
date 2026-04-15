// Lightweight inline SVG sparkline — generalised version of WalletSparkline.
// No external charting libraries. Safe for SSR (renders nothing until mounted).
//
// Colour logic:
//   last point > first point → green (#34d399)
//   last point < first point → red   (#f87171)
//   flat series              → muted grey

type Point = { x: string; y: number };

interface Props {
  points: Point[];
  /** Unique string used to generate the SVG gradient ID — no spaces. */
  id: string;
  width?: number;
  height?: number;
  /** Optional label shown to the right of the chart, e.g. "~4h" */
  label?: string;
}

// PAD must be ≥ dot radius (2.2) + stroke half-width (0.75) ≈ 3; use 4 for safety
// so the end-point dot and stroke never clip the viewBox edge.
const PAD = 4;

export default function MiniSparkline({
  points,
  id,
  width  = 120,
  height = 32,
  label,
}: Props) {
  if (!points || points.length < 2) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minHeight: height }}>
        <span style={{
          fontSize: '0.65rem',
          color: 'rgba(248,250,252,0.18)',
          fontStyle: 'italic',
          letterSpacing: '0.02em',
        }}>
          no trend yet
        </span>
      </div>
    );
  }

  const ys    = points.map((p) => p.y);
  const minY  = Math.min(...ys);
  const maxY  = Math.max(...ys);
  const range = maxY - minY || 1;

  const drawW = width  - PAD * 2;
  const drawH = height - PAD * 2;

  const sx = (i: number) => PAD + (i / (points.length - 1)) * drawW;
  const sy = (y: number) => PAD + drawH - ((y - minY) / range) * drawH;

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(i).toFixed(1)},${sy(p.y).toFixed(1)}`)
    .join(' ');

  const baseY    = sy(Math.min(0, minY));
  const areaPath = `${linePath} L${sx(points.length - 1).toFixed(1)},${baseY.toFixed(1)} L${sx(0).toFixed(1)},${baseY.toFixed(1)} Z`;

  const lastY     = ys[ys.length - 1];
  const firstY    = ys[0];
  const isPositive = lastY >= firstY;
  const isFlat    = Math.abs(lastY - firstY) < 0.01;

  const color = isFlat
    ? 'rgba(248,250,252,0.2)'
    : isPositive ? '#34d399' : '#f87171';

  // Safe gradient ID: strip non-alphanumeric chars
  const gradId = `msg-${id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20)}`;

  const lastX    = sx(points.length - 1);
  const lastDotY = sy(lastY);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', width: '100%', overflow: 'hidden' }}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ display: 'block', overflow: 'hidden', flexShrink: 0, maxWidth: '100%' }}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={color} stopOpacity={isFlat ? 0 : 0.22} />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Area fill */}
        {!isFlat && <path d={areaPath} fill={`url(#${gradId})`} />}

        {/* Trend line */}
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Last-value dot */}
        <circle cx={lastX} cy={lastDotY} r="2.2" fill={color} />
      </svg>

      {label && (
        <span style={{
          fontSize: '0.65rem',
          color: 'rgba(248,250,252,0.25)',
          whiteSpace: 'nowrap',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {label}
        </span>
      )}
    </div>
  );
}
