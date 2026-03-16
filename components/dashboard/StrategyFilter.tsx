'use client';

export type StrategyOption =
  | 'ALL'
  | 'FASTLOOP'
  | 'SNIPER'
  | 'CANDLE_BIAS'
  | 'SWEEP_RECLAIM'
  | 'BREAKOUT_CLOSE'
  | 'ENGULFING_LEVEL'
  | 'REJECTION_WICK'
  | 'FOLLOW_THROUGH';

type StrategyFilterProps = {
  value: StrategyOption;
  onChange: (value: StrategyOption) => void;
};

const OPTIONS: StrategyOption[] = [
  'ALL',
  'FASTLOOP',
  'SNIPER',
  'CANDLE_BIAS',
  'SWEEP_RECLAIM',
  'BREAKOUT_CLOSE',
  'ENGULFING_LEVEL',
  'REJECTION_WICK',
  'FOLLOW_THROUGH'
];

export default function StrategyFilter({ value, onChange }: StrategyFilterProps) {
  return (
    <label className="strategy-filter">
      <span>Strategy</span>
      <select value={value} onChange={(event) => onChange(event.target.value as StrategyOption)}>
        {OPTIONS.map((option) => (
          <option key={option} value={option}>
            {option === 'ALL' ? 'All' : option}
          </option>
        ))}
      </select>
    </label>
  );
}
