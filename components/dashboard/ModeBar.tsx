'use client';

import { useEffect, useState } from 'react';

type TradeMode = 'ONE' | 'ALL';

const MODE_KEY = 'trade_mode';

const helperText: Record<TradeMode, string> = {
  ONE: 'ONE = only one strategy may open per market window.',
  ALL: 'ALL = strategies can trade independently.'
};

export default function ModeBar() {
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
          window.localStorage.setItem(MODE_KEY, tradeMode);
        }
      } catch {
        const stored = window.localStorage.getItem(MODE_KEY);
        if (stored === 'ALL' || stored === 'ONE') {
          setMode(stored);
        }
      }
    };
    loadMode();
    return () => {
      active = false;
    };
  }, []);

  const handleChange = async (nextMode: TradeMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    setStatus('saving');
    window.localStorage.setItem(MODE_KEY, nextMode);
    try {
      const res = await fetch('/api/bot-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bot_id: 'default',
          strategy_settings: {
            trade_mode: nextMode
          }
        })
      });
      const payload = await res.json();
      if (!payload.ok) throw new Error(payload.error || 'save failed');
      const res2 = await fetch('/api/bot-settings?bot_id=default', { cache: 'no-store' });
      if (!res2.ok) throw new Error('refresh failed');
      const updated = await res2.json();
      const srvMode = updated?.settings?.strategy_settings?.trade_mode;
      if (srvMode === 'ONE' || srvMode === 'ALL') {
        setMode(srvMode);
        window.localStorage.setItem(MODE_KEY, srvMode);
      }
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 1500);
    } catch (error) {
      console.error('ModeBar save error', error);
      setStatus('error');
    }
  };

  return (
    <div className="mode-bar">
      <div className="mode-bar-content">
        <div className="mode-bar-left">
          <div className="mode-bar-label">
            <span>Trade Mode</span>
          </div>
          <div className="mode-bar-buttons">
            {(['ONE', 'ALL'] as TradeMode[]).map((option) => (
              <button
                key={option}
                className={`mode-bar-btn ${mode === option ? 'active' : ''}`}
                onClick={() => handleChange(option)}
                disabled={status === 'saving'}
              >
                {option === 'ONE' ? 'ONE TRADE' : 'ALL'}
              </button>
            ))}
          </div>
          <p className="mode-bar-helper">
            <span>{helperText[mode]}</span>
          </p>
        </div>
        <div className={`mode-bar-status ${status}`}>
          {status === 'saving' && 'Saving…'}
          {status === 'saved' && 'Saved'}
          {status === 'error' && 'Save failed'}
        </div>
      </div>
    </div>
  );
}
