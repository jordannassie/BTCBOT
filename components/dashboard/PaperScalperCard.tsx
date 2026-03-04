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
const tradeSizeHelper = 'If Trade Size ≤ 1, it is treated as a percent (0.02 = 2%). If > 1, it is fixed USD.';

type Props = {
  botId: 'paper_scalper';
  label: string;
};

export default function PaperScalperCard({ botId, label }: Props) {
  const router = useRouter();
  const [settings, setSettings] = useState<BotSettings | null>(null);
  const [isEnabled, setIsEnabled] = useState(false);
  const [armLive, setArmLive] = useState(false);
  const [edgeThreshold, setEdgeThreshold] = useState('');
  const [tradeSize, setTradeSize] = useState('');
  const [maxTradesPerHour, setMaxTradesPerHour] = useState('');
  const [paperBalance, setPaperBalance] = useState<number | null>(null);
  const [paperBalanceInput, setPaperBalanceInput] = useState('');
  const [entryPrice, setEntryPrice] = useState('');
  const [takeProfitDelta, setTakeProfitDelta] = useState('');
  const [stopLossDelta, setStopLossDelta] = useState('');
  const [maxHoldSeconds, setMaxHoldSeconds] = useState('');
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [pnl24h, setPnl24h] = useState<number | null>(null);
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
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return null;
    return Math.round(parsed * 100) / 100;
  };

  const commitPaperBalance = () => {
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
    setArmLive(next.arm_live ?? false);
    setEdgeThreshold(asString(next.scalper_entry_price ?? next.edge_threshold));
    setTradeSize(asString(next.trade_size ?? next.trade_size_usd));
    setMaxTradesPerHour(asString(next.max_trades_per_hour));
    setPaperBalance(next.paper_balance_usd ?? null);
    setPaperBalanceInput(next.paper_balance_usd ? next.paper_balance_usd.toFixed(2) : '');
    const strategySettings = (next.strategy_settings ?? {}) as Record<string, unknown>;
    const entrySetting =
      (strategySettings.scalper_entry_cheap_price as number | undefined) ?? next.scalper_entry_price;
    const takeProfitSetting =
      (strategySettings.scalper_take_profit_delta as number | undefined) ??
      next.scalper_take_profit_delta;
    const stopLossSetting =
      (strategySettings.scalper_stop_loss_delta as number | undefined) ??
      next.scalper_stop_loss_delta;
    const maxHoldSetting =
      (strategySettings.scalper_max_hold_seconds as number | undefined) ?? next.scalper_max_hold_seconds;
    setEntryPrice(asString(entrySetting));
    setTakeProfitDelta(asString(takeProfitSetting));
    setStopLossDelta(asString(stopLossSetting));
    setMaxHoldSeconds(asString(maxHoldSetting));
    setLoadError(null);
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

  useEffect(() => {
    let mounted = true;
    const fetchPnl24h = async () => {
      try {
        const res = await fetch(`/api/strategy-pnl?bot_id=${botId}`, { cache: 'no-store' });
        if (!res.ok) return;
        const payload = await res.json();
        if (mounted && payload?.pnl_24h != null) {
          setPnl24h(Number(payload.pnl_24h));
        }
      } catch {
        //
      }
    };
    fetchPnl24h();
    return () => {
      mounted = false;
    };
  }, [botId]);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    const roundedBalance = commitPaperBalance();
    try {
      const strategySettings = {
        scalper_entry_cheap_price: parseFloat(entryPrice) || null,
        scalper_take_profit_delta: parseFloat(takeProfitDelta) || null,
        scalper_stop_loss_delta: parseFloat(stopLossDelta) || null,
        scalper_max_hold_seconds: parseInt(maxHoldSeconds, 10) || null
      };
      const res = await fetch('/api/bot-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          bot_id: botId,
          is_enabled: isEnabled,
          arm_live: armLive,
          edge_threshold: parseFloat(edgeThreshold) || 0,
          trade_size: parseFloat(tradeSize) || 0,
          max_trades_per_hour: parseInt(maxTradesPerHour, 10) || 0,
          paper_balance_usd: roundedBalance ?? 0,
          scalper_entry_price: parseFloat(entryPrice) || null,
          scalper_take_profit_delta: parseFloat(takeProfitDelta) || null,
          scalper_stop_loss_delta: parseFloat(stopLossDelta) || null,
          scalper_max_hold_seconds: parseInt(maxHoldSeconds, 10) || null,
          strategy_settings: strategySettings
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
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : 'Unexpected error', type: 'error' });
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
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : 'Unexpected error', type: 'error' });
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
        <p className="operator-subtitle" style={{ color: '#ef4444' }}>
          {loadError}
        </p>
      </div>
    );
  }

  const paperPnl = settings?.paper_pnl_usd;
  const pnlValue = paperPnl != null ? formatUSD(paperPnl) : '--';
  const pnlColor = paperPnl == null ? '#f8fafc' : paperPnl > 0 ? '#10b981' : paperPnl < 0 ? '#ef4444' : '#f8fafc';
  const pnl24hValue = pnl24h != null ? formatUSD(pnl24h) : '--';
  const pnl24hColor =
    pnl24h == null ? '#f8fafc' : pnl24h > 0 ? '#10b981' : pnl24h < 0 ? '#ef4444' : '#f8fafc';

  return (
    <div className="pnl-card paper-card">
      <div className="strategy-card-header">
        <div className="strategy-card-pl">
          <div className="strategy-card-title">
            <span className="strategy-card-label">{label}</span>
            <div className="strategy-card-pnl-row">
              <div className="strategy-card-pnl-block">
                <span className="strategy-card-pnl-label">P/L (24h)</span>
                <span className="strategy-card-pnl-value" style={{ color: pnl24hColor }}>
                  {pnl24hValue}
                </span>
              </div>
              <div className="strategy-card-pnl-block">
                <span className="strategy-card-pnl-label">P/L (All)</span>
                <span className="strategy-card-pnl-value" style={{ color: pnlColor }}>
                  {pnlValue}
                </span>
              </div>
            </div>
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
              <span>Entry Cheap Price</span>
              <input
                type="number"
                step="0.01"
                value={entryPrice}
                onChange={(e) => setEntryPrice(e.target.value)}
              />
            </label>
            <label className="operator-row">
              <span>Take Profit Delta</span>
              <input
                type="number"
                step="0.01"
                value={takeProfitDelta}
                onChange={(e) => setTakeProfitDelta(e.target.value)}
              />
            </label>
            <label className="operator-row">
              <span>Stop Loss Delta</span>
              <input
                type="number"
                step="0.01"
                value={stopLossDelta}
                onChange={(e) => setStopLossDelta(e.target.value)}
              />
            </label>
            <label className="operator-row">
              <span>Max Hold Seconds</span>
              <input
                type="number"
                step="1"
                value={maxHoldSeconds}
                onChange={(e) => setMaxHoldSeconds(e.target.value)}
              />
            </label>
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
                step="0.01"
                value={tradeSize}
                onChange={(e) => setTradeSize(e.target.value)}
              />
            </label>
            <p className="operator-subtitle" style={{ marginTop: '-0.35rem', marginBottom: '0.75rem' }}>
              {tradeSizeHelper}
            </p>
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
          <button className="operator-save" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </>
      )}
    </div>
  );
}
