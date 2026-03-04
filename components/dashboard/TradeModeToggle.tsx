'use client';

import { useState } from 'react';

type TradeMode = 'ONE' | 'ALL';

type Props = {
  initialMode: TradeMode;
};

const helperText: Record<TradeMode, string> = {
  ONE: 'Only one strategy may open per market window.',
  ALL: 'All strategies may trade the same window (used for comparison).'
};

export default function TradeModeToggle({ initialMode }: Props) {
  const [mode, setMode] = useState<TradeMode>(initialMode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = async (nextMode: TradeMode) => {
    if (nextMode === mode) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/bot-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bot_id: 'default',
          strategy_settings: {
            trade_mode: nextMode
          }
        })
      });
      const payload = await response.json();
      if (payload.ok) {
        setMode(nextMode);
      } else {
        setError(payload.error ?? 'Failed to save');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="trade-mode-toggle">
      <div className="trade-mode-label">
        <span>Trade Mode</span>
      </div>
      <div className="trade-mode-buttons">
        {(['ONE', 'ALL'] as TradeMode[]).map((option) => (
          <button
            key={option}
            className={`range-btn ${mode === option ? 'active' : ''}`}
            onClick={() => handleChange(option)}
            disabled={saving}
          >
            {option === 'ONE' ? 'ONE TRADE' : 'ALL'}
          </button>
        ))}
      </div>
      <div className="trade-mode-helper">{helperText[mode]}</div>
      {error && <div className="trade-mode-error">{error}</div>}
    </div>
  );
}
