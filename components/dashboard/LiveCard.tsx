'use client';

import { useCallback, useEffect, useState } from 'react';
import type { BotSettings } from '@/lib/botData';

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

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/bot-settings?bot_id=live', { cache: 'no-store' });
      if (!res.ok) return;
      const payload = await res.json();
      if (payload.ok && payload.settings) {
        setSettings(payload.settings);
        setIsEnabled(payload.settings.is_enabled ?? false);
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
    <div className="profile-card live-card">
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

      <div className={`live-status ${settings?.live_balance_usd ? 'ok' : 'warn'}`}>
        {settings?.live_balance_usd
          ? 'LIVE bankroll OK'
          : 'LIVE bankroll not updating (check worker)'}
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
