'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { BotSettings } from '@/lib/botData';

type OperatorControlsCardProps = {
  settings?: BotSettings | null;
};

export default function OperatorControlsCard({ settings }: OperatorControlsCardProps) {
  const router = useRouter();
  const [isEnabled, setIsEnabled] = useState(settings?.is_enabled ?? false);
  const [mode, setMode] = useState<'PAPER' | 'LIVE'>(settings?.mode ?? 'PAPER');
  const [edgeThreshold, setEdgeThreshold] = useState(String(settings?.edge_threshold ?? 0.02));
  const [tradeSize, setTradeSize] = useState(String(settings?.trade_size ?? 10));
  const [maxTradesPerHour, setMaxTradesPerHour] = useState(String(settings?.max_trades_per_hour ?? 5));
  const [paperBalance, setPaperBalance] = useState(String(settings?.paper_balance_usd ?? 50));
  const [liveConfirmed, setLiveConfirmed] = useState(mode === 'LIVE');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const applySettings = (next?: BotSettings | null) => {
    setIsEnabled(next?.is_enabled ?? false);
    setMode(next?.mode ?? 'PAPER');
    setEdgeThreshold(String(next?.edge_threshold ?? 0.02));
    setTradeSize(String(next?.trade_size ?? 10));
    setMaxTradesPerHour(String(next?.max_trades_per_hour ?? 5));
    setPaperBalance(String(next?.paper_balance_usd ?? 50));
    setLiveConfirmed(next?.mode === 'LIVE');
  };

  useEffect(() => {
    applySettings(settings ?? null);
  }, [settings]);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const response = await fetch('/api/bot-settings');

        if (!response.ok) {
          return;
        }

        const payload = await response.json();
        applySettings(payload.settings ?? null);
      } catch (error) {
        console.error('Unable to load settings', error);
      }
    };

    loadSettings();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch('/api/bot-settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          bot_id: 'default',
          is_enabled: isEnabled,
          mode,
          edge_threshold: parseFloat(edgeThreshold) || 0,
          trade_size: parseFloat(tradeSize) || 0,
          max_trades_per_hour: parseInt(maxTradesPerHour, 10) || 0,
          paper_balance_usd: parseFloat(paperBalance) || 0
        })
      });

      const payload = await response.json();

      if (payload.ok) {
        setMessage({ text: 'Saved', type: 'success' });
        applySettings(payload.settings ?? null);
        router.refresh();
      } else {
        setMessage({ text: payload.error ?? 'Unable to save settings', type: 'error' });
      }
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : 'Unexpected error', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const requiresLiveConfirmation = mode === 'LIVE' && !liveConfirmed;

  return (
    <div className="profile-card operator-card">
      <div className="operator-header">
        <h3>Operator Controls</h3>
        {mode === 'LIVE' && <p className="operator-warning">LIVE requires Railway KILL_SWITCH=false.</p>}
      </div>

      <div className="operator-form">
        <label className="operator-row">
          <span>Bot Enabled</span>
          <div className="toggle-switch">
            <input
              type="checkbox"
              checked={isEnabled}
              onChange={(e) => setIsEnabled(e.target.checked)}
              id="operator-enabled"
            />
            <label className="toggle-slider" htmlFor="operator-enabled"></label>
          </div>
        </label>

        <label className="operator-row">
          <span>Mode</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as 'PAPER' | 'LIVE')}>
            <option value="PAPER">PAPER</option>
            <option value="LIVE">LIVE</option>
          </select>
        </label>

        {mode === 'LIVE' && (
          <label className="operator-row operator-checkbox">
            <input
              type="checkbox"
              checked={liveConfirmed}
              onChange={(e) => setLiveConfirmed(e.target.checked)}
            />
            <span>I understand LIVE requires Railway KILL_SWITCH=false.</span>
          </label>
        )}

        <label className="operator-row">
          <span>Edge Threshold</span>
          <input
            type="number"
            step="0.01"
            value={edgeThreshold}
            onChange={(e) => setEdgeThreshold(e.target.value)}
          />
        </label>

        <label className="operator-row">
          <span>Trade Size</span>
          <input
            type="number"
            step="1"
            value={tradeSize}
            onChange={(e) => setTradeSize(e.target.value)}
          />
        </label>

        <label className="operator-row operator-row--paper">
          <span>Paper Balance</span>
          <div className="paper-input">
            <input
              type="number"
              step="1"
              value={paperBalance}
              onChange={(e) => setPaperBalance(e.target.value)}
              disabled={mode === 'LIVE'}
            />
            <button
              type="button"
              className="operator-reset"
              onClick={() => setPaperBalance('50')}
              disabled={mode === 'LIVE'}
            >
              Reset
            </button>
          </div>
        </label>

        <label className="operator-row">
          <span>Max Trades / Hour</span>
          <input
            type="number"
            step="1"
            value={maxTradesPerHour}
            onChange={(e) => setMaxTradesPerHour(e.target.value)}
          />
        </label>
      </div>

      {message && (
        <div className={`message ${message.type}`}>
          {message.text}
        </div>
      )}

      <button
        className="operator-save"
        onClick={handleSave}
        disabled={saving || requiresLiveConfirmation}
      >
        {saving ? 'Saving...' : 'Save Changes'}
      </button>
    </div>
  );
}
