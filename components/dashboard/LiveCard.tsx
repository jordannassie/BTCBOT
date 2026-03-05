'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BotSettings } from '@/lib/botData';

const formatUSD = (value?: number | null) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value ?? 0);

const EXPECTED_LIVE_WALLET = '0x48c04C990182B23FD17c911D18c42605FaD3312e';

const truncate = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

const copyAddress = async (address: string, label: string, setCopyStatus: (value: string) => void) => {
  try {
    await navigator.clipboard.writeText(address);
    setCopyStatus(`${label} copied!`);
  } catch {
    setCopyStatus(`${label} copy failed`);
  }
  setTimeout(() => setCopyStatus(''), 2000);
};

export default function LiveCard() {
  const [settings, setSettings] = useState<BotSettings | null>(null);
  const [isEnabled, setIsEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [allowance, setAllowance] = useState<number | null>(null);
  const [copyStatus, setCopyStatus] = useState<string>('');
  const walletMatchStatus = useMemo(() => {
    if (!walletAddress) {
      return { text: '⚠️ BOT WALLET UNKNOWN', variant: 'unknown' };
    }
    const normalizedExisting = walletAddress.toLowerCase();
    if (normalizedExisting === EXPECTED_LIVE_WALLET.toLowerCase()) {
      return { text: '✅ WALLET MATCH', variant: 'match' };
    }
    return { text: '❌ WALLET MISMATCH', variant: 'mismatch' };
  }, [walletAddress]);

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/bot-settings?bot_id=live', { cache: 'no-store' });
      if (!res.ok) return;
      const payload = await res.json();
      if (payload.ok && payload.settings) {
        const nextSettings: BotSettings = payload.settings;
        setSettings(nextSettings);
        setIsEnabled(nextSettings.is_enabled ?? false);
        const strategySettings = (nextSettings.strategy_settings ?? {}) as Record<string, unknown>;
        setWalletAddress((strategySettings.live_wallet_address as string) ?? null);
        const strategyAllowance = strategySettings.live_allowance_usd as number | undefined;
        setAllowance(typeof strategyAllowance === 'number' ? strategyAllowance : null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetch('/api/live-balance', { cache: 'no-store' });
      await loadSettings();
    } finally {
      setRefreshing(false);
    }
  }, [loadSettings]);

  useEffect(() => {
    handleRefresh();
    const interval = setInterval(handleRefresh, 60_000);
    return () => clearInterval(interval);
  }, [handleRefresh]);

  const handleToggle = async (enabled: boolean) => {
    setIsEnabled(enabled);
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/bot-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bot_id: 'live', is_enabled: enabled })
      });
      const payload = await res.json();
      if (payload.ok) {
        setSettings(payload.settings);
        setMessage({ text: 'Saved', type: 'success' });
        const strategySettings = (payload.settings?.strategy_settings ?? {}) as Record<string, unknown>;
        setWalletAddress((strategySettings.live_wallet_address as string) ?? null);
        const strategyAllowance = strategySettings.live_allowance_usd as number | undefined;
        setAllowance(typeof strategyAllowance === 'number' ? strategyAllowance : null);
      } else {
        setMessage({ text: payload.error ?? 'Save failed', type: 'error' });
        setIsEnabled(!enabled);
      }
    } catch {
      setMessage({ text: 'Save failed', type: 'error' });
      setIsEnabled(!enabled);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="profile-card live-card">
        <p className="operator-subtitle">Loading…</p>
      </div>
    );
  }

  return (
    <div className="profile-card live-card live-card-featured">
      <div className="live-card-header">
        <span className="live-card-label">LIVE BANKROLL</span>
        <div className="pnl-indicator">
          <span className={`live-dot ${isEnabled ? 'active' : ''}`} />
          <span>LIVE</span>
        </div>
      </div>

      <div className="live-balance">
        <div className="pnl-amount">
          {settings?.live_balance_usd != null ? formatUSD(settings.live_balance_usd) : '--'}
        </div>
        <p className="pnl-subtext">Live Bankroll (USDC Polygon)</p>
        <p className="pnl-subtext">
          Last Updated:{' '}
          {settings?.live_updated_at ? new Date(settings.live_updated_at).toLocaleString() : '--'}
        </p>
      </div>

      <div
        className={`live-status ${walletAddress ? 'ok' : 'warn'}`}
        aria-live="polite"
      >
        {walletAddress
          ? settings?.live_balance_usd
            ? 'LIVE bankroll OK'
            : 'LIVE bankroll not updating (check worker)'
          : 'LIVE wallet unknown'}
        {allowance != null &&
          settings?.live_balance_usd != null &&
          allowance < (settings.live_balance_usd ?? 0) &&
          ' — Allowance low'}
      </div>

      <div className="live-wallet-row">
        <span>Expected Wallet:</span>
        <div className="live-wallet-value">
          <span>{truncate(EXPECTED_LIVE_WALLET)}</span>
          <button
            type="button"
            className="live-wallet-copy"
            onClick={() => copyAddress(EXPECTED_LIVE_WALLET, 'Expected wallet', setCopyStatus)}
          >
            Copy
          </button>
        </div>
      </div>

      <div className="live-wallet-row">
        <span>Bot Wallet:</span>
        {walletAddress ? (
          <div className="live-wallet-value">
            <span>{truncate(walletAddress)}</span>
            <button
              type="button"
              className="live-wallet-copy"
              onClick={() => copyAddress(walletAddress, 'Bot wallet', setCopyStatus)}
            >
              Copy
            </button>
          </div>
        ) : (
          <span className="live-wallet-missing">Unknown (waiting for worker)</span>
        )}
      </div>

      {copyStatus && <div className="copy-feedback live-wallet-copy-feedback">{copyStatus}</div>}

      <div className={`live-wallet-status ${walletMatchStatus.variant}`}>
        {walletMatchStatus.text}
      </div>

      {message && (
        <div
          style={{
            fontSize: '0.8rem',
            margin: '0.5rem 0',
            color: message.type === 'success' ? '#10b981' : '#ef4444'
          }}
        >
          {message.text}
        </div>
      )}

      <div className="operator-form" style={{ marginTop: '1rem' }}>
        <label className="operator-row">
          <span>LIVE ON (Master)</span>
          <div className="toggle-switch">
            <input
              type="checkbox"
              checked={isEnabled}
              onChange={(e) => handleToggle(e.target.checked)}
              disabled={saving}
              id="live-enabled"
            />
            <label className="toggle-slider" htmlFor="live-enabled"></label>
          </div>
        </label>
        <p className="operator-subtitle" style={{ marginTop: '-0.35rem' }}>
          Master toggle that authorizes strategies to go LIVE when ARM LIVE is enabled.
        </p>
      </div>

      <button
        className="operator-save"
        onClick={handleRefresh}
        disabled={refreshing}
        style={{ marginTop: '1rem' }}
      >
        {refreshing ? 'Refreshing…' : 'Refresh Balance'}
      </button>
    </div>
  );
}
