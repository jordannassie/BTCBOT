'use client';

import { STRATEGY_FILTER_OPTIONS, type StrategyFilterOption } from '@/lib/config';

// Re-exported for backward compatibility — other components import this type here.
export type StrategyOption = StrategyFilterOption;

type StrategyFilterProps = {
  value: StrategyOption;
  onChange: (value: StrategyOption) => void;
};

export default function StrategyFilter({ value, onChange }: StrategyFilterProps) {
  return (
    <label className="strategy-filter">
      <span>Strategy</span>
      <select value={value} onChange={(event) => onChange(event.target.value as StrategyOption)}>
        {STRATEGY_FILTER_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {option === 'ALL' ? 'All' : option}
          </option>
        ))}
      </select>
    </label>
  );
}
