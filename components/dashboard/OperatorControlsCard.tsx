'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { BotSettings } from '@/lib/botData';

const formatUSD = (value?: number | null): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value ?? 0);

const asString = (value?: number | null): string => (value == null ? '' : String(value));

export default function OperatorControlsCard() {
  const router = useRouter();
  const [isEnabled, setIsEnabled] = useState<boolean>(false);
  const [mode, setMode] = useState<'PAPER' | 'LIVE'>('PAPER');
  const [edgeThreshold, setEdgeThreshold] = useState('');
  const [tradeSize, setTradeSize] = useState('');
  const [maxTradesPerHour, setMaxTradesPerHour] = useState('');
  const [paperBalance, setPaperBalance] = useState<number | null>(null);
  const [paperBalanceInput, setPaperBalanceInput] = useState('');
  const [liveConfirmed, setLiveConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const parsePaperBalance = (value: string) => {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return null;
    return Math.round(parsed * 100) / 100;
  };

  const commitPaperBalance = (): number | null => {
    const rounded = parsePaperBalance(paperBalanceInput);
    setPaperBalance(rounded);
    setPaperBalanceInput(rounded != null ? rounded.toFixed(2) : '');
    return rounded;
  };

  const applySettings = (next?: BotSettings | null) => {
    if (!next) {
      setError('Unable to load bot settings from Supabase.');
      return;
    }

    setError(null);
    setIsEnabled(next.is_enabled);
    setMode(next.mode);
    setEdgeThreshold(asString(next.edge_threshold));
    setTradeSize(asString(next.trade_size ?? next.trade_size_usd));
    setMaxTradesPerHour(asString(next.max_trades_per_hour));
    const balance = next.paper_balance_usd ?? null;
    setPaperBalance(balance);
    setPaperBalanceInput(balance != null ? balance.toFixed(2) : '');
    setLiveConfirmed(next.mode === 'LIVE');
    setHydrated(true);

    if (process.env.NODE_ENV === 'development') {
      console.log('hydrated settings', next);
      console.log(
        'balances',
        next.paper_balance_usd ?? '—',
        next.paper_pnl_usd ?? '—'
      );
    }
  };

  useEffect(() => {
    const loadSettings = async () => {
      setLoading(true);

      try {
        const response = await fetch('/api/bot-settings', { cache: 'no-store' });

        if (!response.ok) {
          setError('Unable to load bot settings.');
          return;
        }

        const payload = await response.json();
        applySettings(payload.settings ?? null);
      } catch (error) {
        console.error('Unable to load settings', error);
        setError('Unable to load bot settings.');
      } finally {
        setLoading(false);
      }
    };

    loadSettings();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);

    const roundedBalance = commitPaperBalance();

    try {
      const response = await fetch('/api/bot-settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        cache: 'no-store',
        body: JSON.stringify({
          bot_id: 'default',
          is_enabled: isEnabled,
          mode,
          edge_threshold: parseFloat(edgeThreshold) || 0,
          trade_size: parseFloat(tradeSize) || 0,
          max_trades_per_hour: parseInt(maxTradesPerHour, 10) || 0,
          paper_balance_usd: roundedBalance ?? 0
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

  if (loading) {
    return (
      <div className="profile-card operator-card">
        <div className="operator-header">
          <h3>Operator Controls</h3>
          <p className="operator-subtitle">Loading…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="profile-card operator-card">
        <div className="operator-header">
          <h3>Operator Controls</h3>
          <p className="operator-subtitle error">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="profile-card operator-card">
      <div className="operator-header">
        <h3>Operator Controls</h3>
        {mode === 'LIVE' && <p className="operator-warning">LIVE requires Railway KILL_SWITCH=false.</p>}
      </div>

      {message && (
        <div className={`message ${message.type}`}>
          {message.text}
        </div>
      )}

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
              disabled={mode === 'LIVE'}
            />
            <button
              type="button"
              className="operator-reset"
              onClick={() => {
                setPaperBalance(50);
                setPaperBalanceInput('50.00');
              }}
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

      <button
        className="operator-save"
        onClick={handleSave}
        disabled={saving || requiresLiveConfirmation || !hydrated}
      >
        {saving ? 'Saving...' : 'Save Changes'}
      </button>
    </div>
  );
}
