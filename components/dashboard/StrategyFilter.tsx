'use client';

export type StrategyOption = 'ALL' | 'FASTLOOP' | 'SNIPER' | 'CANDLE_BIAS';

type StrategyFilterProps = {
  value: StrategyOption;
  onChange: (value: StrategyOption) => void;
};

const OPTIONS: StrategyOption[] = ['ALL', 'FASTLOOP', 'SNIPER', 'CANDLE_BIAS'];

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
