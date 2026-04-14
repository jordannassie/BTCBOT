// Lightweight inline SVG sparkline for wallet cumulative P&L trend.
// No external charting libraries — pure SVG path rendering.

type Point = { x: string; y: number };

interface Props {
  points: Point[];
  walletAddress: string;
  width?: number;
  height?: number;
}

const PAD = 2; // px padding inside the SVG so strokes don't clip at edges

export default function WalletSparkline({
  points,
  walletAddress,
  width = 88,
  height = 28,
}: Props) {
  // Need at least 2 points to draw a meaningful line
  if (!points || points.length < 2) {
    return (
      <span style={{
        fontSize: '0.65rem',
        color: 'rgba(248,250,252,0.2)',
        fontStyle: 'italic',
        letterSpacing: '0.02em',
      }}>
        no data
      </span>
    );
  }

  const ys = points.map((p) => p.y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rangeY = maxY - minY || 1; // avoid division by zero on flat series

  const drawW = width - PAD * 2;
  const drawH = height - PAD * 2;

  const sx = (i: number) => PAD + (i / (points.length - 1)) * drawW;
  const sy = (y: number) => PAD + drawH - ((y - minY) / rangeY) * drawH;

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(i).toFixed(1)},${sy(p.y).toFixed(1)}`)
    .join(' ');

  // Area path: follow the line then close down to baseline
  const baseY = sy(Math.min(0, minY)); // baseline at y=0 if visible, else min
  const areaPath = `${linePath} L${sx(points.length - 1).toFixed(1)},${baseY.toFixed(1)} L${sx(0).toFixed(1)},${baseY.toFixed(1)} Z`;

  const lastY = ys[ys.length - 1];
  const firstY = ys[0];
  const isPositive = lastY >= firstY;
  const isFlat = Math.abs(lastY - firstY) < 0.01;

  const color = isFlat
    ? 'rgba(248,250,252,0.2)'
    : isPositive
      ? '#34d399'
      : '#f87171';

  // Unique gradient ID per wallet to avoid SVG defs collisions
  const gradId = `wsg-${walletAddress.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16)}`;

  const lastX = sx(points.length - 1);
  const lastDotY = sy(lastY);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: 'block', overflow: 'visible' }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={isFlat ? 0 : 0.22} />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Area fill */}
      {!isFlat && (
        <path d={areaPath} fill={`url(#${gradId})`} />
      )}

      {/* Trend line */}
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Last value dot */}
      <circle cx={lastX} cy={lastDotY} r="2.2" fill={color} />
    </svg>
  );
}
