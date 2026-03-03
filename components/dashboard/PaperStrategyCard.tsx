'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { BotSettings } from '@/lib/botData';

const formatUSD = (value?: number | null) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value ?? 0);

const asString = (value?: number | null): string => (value == null ? '' : String(value));

type Props = {
  botId: 'paper_fastloop' | 'paper_sniper';
  label: string;
};

export default function PaperStrategyCard({ botId, label }: Props) {
  const router = useRouter();
  const [settings, setSettings] = useState<BotSettings | null>(null);
  const [isEnabled, setIsEnabled] = useState(false);
  const [edgeThreshold, setEdgeThreshold] = useState('');
  const [tradeSize, setTradeSize] = useState('');
  const [maxTradesPerHour, setMaxTradesPerHour] = useState('');
  const [armLive, setArmLive] = useState(false);
  const [paperBalance, setPaperBalance] = useState<number | null>(null);
  const [paperBalanceInput, setPaperBalanceInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const storageKey = `strategy-card-expanded/${botId}`;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(storageKey);
    setExpanded(stored === 'true');
  }, [storageKey]);

  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(storageKey, next ? 'true' : 'false');
      }
      return next;
    });
  }, [storageKey]);

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
      setLoadError('Unable to load settings.');
      return;
    }
    setSettings(next);
    setIsEnabled(next.is_enabled);
    setEdgeThreshold(asString(next.edge_threshold));
    setTradeSize(asString(next.trade_size ?? next.trade_size_usd));
    setMaxTradesPerHour(asString(next.max_trades_per_hour));
    const balance = next.paper_balance_usd ?? null;
    setPaperBalance(balance);
    setPaperBalanceInput(balance != null ? balance.toFixed(2) : '');
    setArmLive(next.arm_live ?? false);
    setLoadError(null);
    setHydrated(true);
  };

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/bot-settings?bot_id=${botId}`, { cache: 'no-store' });
      if (!res.ok) {
        setLoadError('Unable to load settings.');
        return;
      }
      const payload = await res.json();
      applySettings(payload.settings ?? null);
    } catch {
      setLoadError('Unable to load settings.');
    } finally {
      setLoading(false);
    }
  }, [botId]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    const roundedBalance = commitPaperBalance();
    const thresholdValue = parseFloat(edgeThreshold) || 0;
    if (thresholdValue < 0) {
      const confirmed = window.confirm(
        'Negative edge thresholds are discouraged. Confirm that this is a debugging scenario before continuing.'
      );
      if (!confirmed) {
        setMessage({ text: 'Negative threshold was cancelled', type: 'error' });
        setSaving(false);
        return;
      }
    }
    try {
      const res = await fetch('/api/bot-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          bot_id: botId,
          is_enabled: isEnabled,
          edge_threshold: thresholdValue,
          trade_size: parseFloat(tradeSize) || 0,
          max_trades_per_hour: parseInt(maxTradesPerHour, 10) || 0,
          paper_balance_usd: roundedBalance ?? 0,
          arm_live: armLive
        })
      });
      const payload = await res.json();
      if (payload.ok) {
        setMessage({ text: 'Saved', type: 'success' });
        applySettings(payload.settings ?? null);
        router.refresh();
      } else {
        setMessage({ text: payload.error ?? 'Save failed', type: 'error' });
      }
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : 'Unexpected error', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setResetting(true);
    setMessage(null);
    const roundedBalance = commitPaperBalance() ?? 0;
    try {
      const res = await fetch('/api/paper-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ bot_id: botId, paper_balance_usd: roundedBalance })
      });
      const payload = await res.json();
      if (payload.ok) {
        await loadSettings();
        router.refresh();
        setMessage({ text: 'Reset', type: 'success' });
      } else {
        setMessage({ text: payload.error ?? 'Reset failed', type: 'error' });
      }
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : 'Unexpected error', type: 'error' });
    } finally {
      setResetting(false);
    }
  };

  if (loading) {
    return (
      <div className="pnl-card paper-card">
        <p className="operator-subtitle">Loading…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="pnl-card paper-card">
        <p className="operator-subtitle" style={{ color: '#ef4444' }}>{loadError}</p>
      </div>
    );
  }

  const paperPnl = settings?.paper_pnl_usd;
  const tradeSizeValue = Number(tradeSize) || 0;
  const sizingHint =
    botId === 'paper_sniper'
      ? tradeSizeValue <= 1
        ? 'Percent of balance (0.02 = 2%)'
        : 'Fixed USD'
      : null;

  return (
    <div className="pnl-card paper-card">
      <div className="strategy-card-header">
        <div>
          <div className="strategy-card-title">
            <span>{label}</span>
            <span className="pnl-subtext">Paper P/L: {paperPnl != null ? formatUSD(paperPnl) : '--'}</span>
          </div>
          <div className="strategy-card-subtext">Balance: {formatUSD(paperBalance)}</div>
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
        <button
          type="button"
          className={`card-toggle-btn ${expanded ? 'expanded' : ''}`}
          onClick={toggleExpanded}
          aria-expanded={expanded}
        >
          <span>▾</span>
        </button>
      </div>

      {expanded && (
        <>
          {message && (
            <div
              style={{
                fontSize: '0.8rem',
                marginBottom: '0.5rem',
                color: message.type === 'success' ? '#10b981' : '#ef4444'
              }}
            >
              {message.text}
            </div>
          )}
          <div className="operator-form">
            <p className="operator-subtitle" style={{ marginTop: '-0.35rem', marginBottom: '0.75rem' }}>
              Strategy goes LIVE only when ARM LIVE + LIVE ON are enabled.
            </p>
            <label className="operator-row">
              <span>Edge Threshold</span>
              <input
                type="number"
                step="0.01"
                value={edgeThreshold}
                onChange={(e) => setEdgeThreshold(e.target.value)}
              />
            </label>
            <p className="operator-subtitle" style={{ marginTop: '-0.35rem', marginBottom: '0.75rem' }}>
              Trades only happen when YES_ask + NO_ask &lt; 1 - threshold.
            </p>
            <label className="operator-row">
              <span>Trade Size</span>
              <input
                type="number"
                step="1"
                value={tradeSize}
                onChange={(e) => setTradeSize(e.target.value)}
              />
            </label>
            {sizingHint && (
              <p className="operator-subtitle" style={{ marginTop: '-0.35rem', marginBottom: '0.75rem' }}>
                {sizingHint}
              </p>
            )}
            <label className="operator-row">
              <span>Max Trades/Hr</span>
              <input
                type="number"
                step="1"
                value={maxTradesPerHour}
                onChange={(e) => setMaxTradesPerHour(e.target.value)}
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
                />
                <button type="button" className="operator-reset" onClick={handleReset} disabled={resetting}>
                  {resetting ? '…' : 'Reset'}
                </button>
              </div>
            </label>
          </div>
          <button className="operator-save" onClick={handleSave} disabled={saving || !hydrated}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </>
      )}
    </div>
  );
}
