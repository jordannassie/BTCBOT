'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const formatUSD = (value?: number | null) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value ?? 0);

const parseNumberInput = (value: string): number | null => {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
};

const parseDirectionMode = (value: unknown): 'normal' | 'reverse' => {
  const normalized = typeof value === 'string' ? value.toLowerCase() : '';
  return normalized === 'reverse' ? 'reverse' : 'normal';
};

export default function PaperCandleBiasCard() {
  const router = useRouter();
  const botId = 'paper_candle_bias';
  const [settings, setSettings] = useState<any>(null);
  const [isEnabled, setIsEnabled] = useState(false);
  const [armLive, setArmLive] = useState(false);
  const [directionMode, setDirectionMode] = useState<'normal' | 'reverse'>('normal');
  const [tradeSize, setTradeSize] = useState('');
  const [maxTradesPerHour, setMaxTradesPerHour] = useState('');
  const [paperBalance, setPaperBalance] = useState<number | null>(null);
  const [paperBalanceInput, setPaperBalanceInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const commitPaperBalance = () => {
    const rounded = parseNumberInput(paperBalanceInput);
    setPaperBalance(rounded);
    setPaperBalanceInput(rounded != null ? rounded.toFixed(2) : '');
    return rounded;
  };

  const applySettings = (next?: any) => {
    if (!next) return;
    setSettings(next);
    setIsEnabled(Boolean(next.is_enabled));
    setArmLive(Boolean(next.arm_live));
    setTradeSize(next.trade_size_usd != null ? String(next.trade_size_usd) : '');
    setMaxTradesPerHour(next.max_trades_per_hour != null ? String(next.max_trades_per_hour) : '');
    const balance = typeof next.paper_balance_usd === 'number' ? next.paper_balance_usd : null;
    setPaperBalance(balance);
    setPaperBalanceInput(balance != null ? balance.toFixed(2) : '');
    const strategySettings = (next.strategy_settings ?? {}) as Record<string, unknown>;
    setDirectionMode(parseDirectionMode(strategySettings.direction_mode));
  };

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/bot-settings?bot_id=${botId}`, { cache: 'no-store' });
      if (!res.ok) return;
      const payload = await res.json();
      if (payload.ok) {
        applySettings(payload.settings);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    const roundedBalance = commitPaperBalance() ?? 0;
    try {
      const payloadBody: Record<string, unknown> = {
        bot_id: botId,
        is_enabled: isEnabled,
        arm_live: armLive,
        trade_size: parseFloat(tradeSize) || 0,
        max_trades_per_hour: parseInt(maxTradesPerHour, 10) || 0,
        paper_balance_usd: roundedBalance,
        strategy_settings: {
          direction_mode: directionMode
        }
      };
      const res = await fetch('/api/bot-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify(payloadBody)
      });
      const payload = await res.json();
      if (payload.ok) {
        setMessage({ text: 'Saved', type: 'success' });
        applySettings(payload.settings);
        router.refresh();
      } else {
        setMessage({ text: payload.error ?? 'Save failed', type: 'error' });
      }
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : 'Unexpected error', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="pnl-card paper-card">
        <p className="operator-subtitle">Loading…</p>
      </div>
    );
  }

  return (
    <div className="pnl-card paper-card">
      <div className="strategy-card-header">
        <div className="strategy-card-pl">
          <div className="strategy-card-title">
            <span className="strategy-card-label">PAPER — CANDLE_BIAS</span>
          </div>
          <div className="strategy-card-pl-subtext">
            <span>Balance: {formatUSD(paperBalance)}</span>
          </div>
        </div>
        <div className="strategy-card-controls">
          <label className="operator-row">
            <span>Enabled</span>
            <div className="toggle-switch">
              <input
                type="checkbox"
                checked={isEnabled}
                onChange={(e) => setIsEnabled(e.target.checked)}
                id={`${botId}-enabled`}
              />
              <label className="toggle-slider" htmlFor={`${botId}-enabled`}></label>
            </div>
          </label>
          <label className="operator-row">
            <span>ARM LIVE</span>
            <div className="toggle-switch">
              <input
                type="checkbox"
                checked={armLive}
                onChange={(e) => setArmLive(e.target.checked)}
                id={`${botId}-arm-live`}
              />
              <label className="toggle-slider" htmlFor={`${botId}-arm-live`}></label>
            </div>
          </label>
        </div>
      </div>

      <div className="operator-form">
        <label className="operator-row">
          <span>Direction Mode</span>
          <select value={directionMode} onChange={(event) => setDirectionMode((event.target.value as 'normal' | 'reverse') ?? 'normal')}>
            <option value="normal">Normal</option>
            <option value="reverse">Reverse</option>
          </select>
        </label>
        <label className="operator-row">
          <span>Trade Size</span>
          <input value={tradeSize} type="number" step="0.01" onChange={(e) => setTradeSize(e.target.value)} />
        </label>
        <label className="operator-row">
          <span>Max Trades/Hr</span>
          <input value={maxTradesPerHour} type="number" step="1" onChange={(e) => setMaxTradesPerHour(e.target.value)} />
        </label>
        <label className="operator-row operator-row--paper">
          <span>
            Paper Balance
            <span className="operator-subtitle" style={{ marginLeft: '0.5rem' }}>
              {paperBalance != null ? formatUSD(paperBalance) : '—'}
            </span>
          </span>
          <div className="paper-input">
            <input
              type="text"
              inputMode="decimal"
              value={paperBalanceInput}
              onChange={(e) => setPaperBalanceInput(e.target.value)}
              onBlur={commitPaperBalance}
            />
            <button type="button" className="operator-reset" onClick={() => setPaperBalanceInput('')}>
              Reset
            </button>
          </div>
        </label>
      </div>

      {message && (
        <div style={{ fontSize: '0.8rem', margin: '0.5rem 0', color: message.type === 'success' ? '#10b981' : '#ef4444' }}>
          {message.text}
        </div>
      )}

      <button className="operator-save" onClick={handleSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save Changes'}
      </button>
    </div>
  );
}
