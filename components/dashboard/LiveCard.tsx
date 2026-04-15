'use client';

import { useCallback, useEffect, useState } from 'react';
import type { BotSettings } from '@/lib/botData';

// ── Live wallet constants ────────────────────────────────────────────────────
const LIVE_WALLET = '0x48c04c990182b23fd17c911d18c42605fad3312e';
const LIVE_WALLET_SHORT = `${LIVE_WALLET.slice(0, 6)}…${LIVE_WALLET.slice(-4)}`;
const LIVE_WALLET_PM_URL = `https://polymarket.com/profile/${LIVE_WALLET}`;

// ── Wallet row sub-components ────────────────────────────────────────────────

function LiveWalletRow() {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(LIVE_WALLET).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  return (
    <div className="live-wallet-row">
      <span className="live-wallet-label">Live Wallet</span>
      <div className="live-wallet-value">
        <a
          href={LIVE_WALLET_PM_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="live-wallet-link"
          title="View on Polymarket"
        >
          <span className="live-wallet-addr">{LIVE_WALLET_SHORT}</span>
          {/* external-link icon */}
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="live-wallet-ext-icon" aria-hidden="true">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </a>
        {/* copy button */}
        <button
          className="live-wallet-copy-btn"
          onClick={handleCopy}
          title={copied ? 'Copied!' : 'Copy full address'}
          aria-label="Copy full wallet address"
        >
          {copied ? (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const formatUSD = (value?: number | null) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value ?? 0);

export default function LiveCard() {
  const [settings, setSettings] = useState<BotSettings | null>(null);
  const [isEnabled, setIsEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [allowance, setAllowance] = useState<number | null>(null);

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

      <LiveWalletRow />

      <div className="live-status" aria-live="polite">
        {settings?.live_balance_usd
          ? 'LIVE bankroll OK'
          : 'LIVE bankroll not updating (check worker)'}
        {allowance != null &&
          settings?.live_balance_usd != null &&
          allowance < (settings.live_balance_usd ?? 0) &&
          ' — Allowance low'}
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
