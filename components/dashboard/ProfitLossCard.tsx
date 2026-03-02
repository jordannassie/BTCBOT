'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchPaperEquity } from '@/lib/botData';

type Range = '1D' | '1W' | '1M' | 'ALL';

const RANGE_LABELS: Record<Range, string> = {
  '1D': 'Past Day',
  '1W': 'Past Week',
  '1M': 'Past Month',
  ALL: 'All-time'
};

const RANGES: Range[] = ['1D', '1W', '1M', 'ALL'];

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);

type EquityPoint = {
  t: number;
  equity: number;
};

type EquityData = {
  range: Range;
  start_equity: number;
  end_equity: number;
  pnl: number;
  points: EquityPoint[];
};

type ProfitLossCardProps = {
  paperBalance: number;
};

export default function ProfitLossCard({ paperBalance }: ProfitLossCardProps) {
  const [range, setRange] = useState<Range>('1D');
  const [data, setData] = useState<EquityData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoverPoint, setHoverPoint] = useState<EquityPoint | null>(null);
  const [animatedValue, setAnimatedValue] = useState(0);
  const displayRef = useRef(0);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchPaperEquity(range);
        if (!result) {
          setError('Unable to load equity data.');
          return;
        }
        setData(result);
      } catch (err) {
        console.error(err);
        setError('Unable to load equity data.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [range]);

  const targetValue = hoverPoint
    ? hoverPoint.equity - (data?.start_equity ?? 0)
    : data?.pnl ?? 0;

  useEffect(() => {
    const start = displayRef.current;
    const end = targetValue;
    const duration = 400;
    const startTime = performance.now();
    let animation: number;

    const animate = (time: number) => {
      const progress = Math.min((time - startTime) / duration, 1);
      const value = start + (end - start) * progress;
      displayRef.current = value;
      setAnimatedValue(value);
      if (progress < 1) animation = requestAnimationFrame(animate);
    };

    animation = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animation);
  }, [targetValue]);

  const points = useMemo(() => {
    if (!data || data.points.length === 0) {
      return [];
    }
    return data.points;
  }, [data]);

  const timeline = useMemo(() => {
    if (points.length === 0) {
      return { minTime: 0, maxTime: 1 };
    }
    const minTime = points[0].t;
    const maxTime = points[points.length - 1].t || points[0].t + 1;
    return { minTime, maxTime };
  }, [points]);

  const equityRange = useMemo(() => {
    const values = points.map((point) => point.equity);
    values.push(data?.start_equity ?? 0);
    const min = Math.min(...values);
    const max = Math.max(...values);
    return { min, max: max === min ? max + 1 : max };
  }, [points, data]);

  const xScale = useCallback(
    (value: number) => {
      const { minTime, maxTime } = timeline;
      if (maxTime === minTime) return 0;
      return ((value - minTime) / (maxTime - minTime)) * 100;
    },
    [timeline]
  );

  const yScale = useCallback(
    (value: number) => {
      const { min, max } = equityRange;
      if (max === min) return 0;
      return 100 - ((value - min) / (max - min)) * 100;
    },
    [equityRange]
  );

  const path = useMemo(() => {
    if (points.length === 0) return '';
    const coords = points.map((point) => `${xScale(point.t)},${yScale(point.equity)}`);
    return `M${coords.join(' L')}`;
  }, [points, xScale, yScale]);

  const handleMouseMove = (event: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || points.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const width = rect.width;
    const ratio = Math.min(Math.max(x / width, 0), 1);
    const index = Math.round(ratio * (points.length - 1));
    setHoverPoint(points[index]);
  };

  const handleMouseLeave = () => {
    setHoverPoint(null);
  };

  const tooltip = hoverPoint
    ? `${new Date(hoverPoint.t).toLocaleString()} – ${formatCurrency(hoverPoint.equity - (data?.start_equity ?? 0))}`
    : null;

  return (
    <div className="pnl-card profit-card">
      <div className="pnl-header">
        <div className="pnl-indicator">
          <span className="profit-dot"></span>
          <span>Profit/Loss</span>
        </div>
        <div className="profit-tabs">
          {RANGES.map((item) => (
            <button
              key={item}
              className={`profit-tab ${range === item ? 'active' : ''}`}
              onClick={() => setRange(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <div className="pnl-amount">{formatCurrency(animatedValue)}</div>
      <div className="pnl-period">{RANGE_LABELS[range]}</div>
      {tooltip && (
        <div className="profit-tooltip">
          <span>{tooltip}</span>
        </div>
      )}
      <div className="pnl-chart">
        <svg
          ref={svgRef}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          <defs>
            <linearGradient id="profitGradient" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#6366f1" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={path} fill="none" stroke="#6366f1" strokeWidth="1.5" />
          {hoverPoint && (
            <>
              <line
                x1={xScale(hoverPoint.t)}
                x2={xScale(hoverPoint.t)}
                y1="0"
                y2="100"
                stroke="rgba(255,255,255,0.3)"
                strokeWidth="0.5"
              />
              <circle
                cx={xScale(hoverPoint.t)}
                cy={yScale(hoverPoint.equity)}
                r="1.5"
                fill="#10b981"
                stroke="#fff"
                strokeWidth="0.5"
              />
            </>
          )}
        </svg>
      </div>
      <div className="profit-balance">
        <span>Paper Balance</span>
        <strong>{formatCurrency(paperBalance)}</strong>
      </div>
    </div>
  );
}
