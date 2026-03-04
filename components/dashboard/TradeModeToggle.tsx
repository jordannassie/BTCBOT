'use client';

'use client';

import { useEffect, useState } from 'react';

type TradeMode = 'ONE' | 'ALL';

const helperText: Record<TradeMode, string> = {
  ONE: 'Only one strategy may open per market window.',
  ALL: 'All strategies may trade the same window (used for comparison).'
};

export default function TradeModeToggle() {
  const [mode, setMode] = useState<TradeMode>('ONE');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    let active = true;
    const loadMode = async () => {
      try {
        const res = await fetch('/api/bot-settings?bot_id=default', { cache: 'no-store' });
        if (!res.ok) return;
        const payload = await res.json();
        const settings = payload?.settings?.strategy_settings;
        const tradeMode = settings?.trade_mode;
        if (active && (tradeMode === 'ONE' || tradeMode === 'ALL')) {
          setMode(tradeMode);
        }
      } catch {
        //
      }
    };
    loadMode();
    return () => {
      active = false;
    };
  }, []);

  const handleChange = async (nextMode: TradeMode) => {
    if (nextMode === mode) return;
    setStatus('saving');
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
        setStatus('saved');
        setTimeout(() => setStatus('idle'), 1500);
      } else {
        setStatus('error');
      }
    } catch {
      setStatus('error');
    }
  };

  return (
    <div className="trade-mode-toggle">
      <div className="trade-mode-top">
        <div className="trade-mode-label">
          <span>Trade Mode</span>
        </div>
        <div className="trade-mode-bubble" />
      </div>
      <div className="trade-mode-buttons">
        {(['ONE', 'ALL'] as TradeMode[]).map((option) => (
          <button
            key={option}
            className={`trade-mode-btn ${mode === option ? 'active' : ''}`}
            onClick={() => handleChange(option)}
            disabled={status === 'saving'}
          >
            {option === 'ONE' ? 'ONE TRADE' : 'ALL'}
          </button>
        ))}
      </div>
      <div className="trade-mode-helper">{helperText[mode]}</div>
      {status === 'saving' && <div className="trade-mode-status">Saving…</div>}
      {status === 'saved' && <div className="trade-mode-status saved">Saved</div>}
      {status === 'error' && <div className="trade-mode-error">Save failed</div>}
    </div>
  );
}
