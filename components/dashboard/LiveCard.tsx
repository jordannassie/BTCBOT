'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BotSettings } from '@/lib/botData';
import MiniSparkline from '@/components/copy/MiniSparkline';
import {
  appendBankrollPoint,
  getBankrollHistory,
  bankrollSpanLabel,
  type BankrollPoint,
} from '@/lib/copy/bankrollHistory';

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

type ExposureMetrics = {
  count: number;
  exposure: number;
  avg: number;
  cap: number;          // 0 = unlimited
  remaining: number | null; // null when unlimited
};

export default function LiveCard() {
  const [settings, setSettings] = useState<BotSettings | null>(null);
  const [isEnabled, setIsEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [allowance, setAllowance] = useState<number | null>(null);
  // Sparkline — client-only, read from localStorage after mount
  const [sparkPoints, setSparkPoints] = useState<BankrollPoint[]>([]);
  // Open exposure for LIVE bots — fetched from /api/copy/exposure.
  // Starts as null (loading); becomes an object after first fetch attempt
  // so the block always renders regardless of API success.
  const [liveExposure, setLiveExposure] = useState<ExposureMetrics | null>(null);
  const [exposureLoading, setExposureLoading] = useState(true);
  // Inline live-cap editor
  const [capInput, setCapInput] = useState('0');
  const [savingCap, setSavingCap] = useState(false);
  // Tracks whether capInput has been seeded from the server; prevents the
  // 60-second periodic refresh from overwriting a value the operator is typing.
  const capSynced = useRef(false);

  const loadSettings = useCallback(async () => {
    try {
      const [settingsRes, exposureRes] = await Promise.all([
        fetch('/api/bot-settings?bot_id=live', { cache: 'no-store' }),
        fetch('/api/copy/exposure', { cache: 'no-store' }),
      ]);

      if (settingsRes.ok) {
        const payload = await settingsRes.json();
        if (payload.ok && payload.settings) {
          const nextSettings: BotSettings = payload.settings;
          setSettings(nextSettings);
          setIsEnabled(nextSettings.is_enabled ?? false);
          const strategySettings = (nextSettings.strategy_settings ?? {}) as Record<string, unknown>;
          const strategyAllowance = strategySettings.live_allowance_usd as number | undefined;
          setAllowance(typeof strategyAllowance === 'number' ? strategyAllowance : null);
          if (typeof nextSettings.live_balance_usd === 'number') {
            appendBankrollPoint('live', nextSettings.live_balance_usd);
            setSparkPoints(getBankrollHistory('live'));
          }
        }
      }

      const zeroExposure: ExposureMetrics = { count: 0, exposure: 0, avg: 0, cap: 0, remaining: null };
      if (exposureRes.ok) {
        const expPayload = await exposureRes.json();
        if (expPayload.ok) {
          const live = expPayload.live as ExposureMetrics;
          setLiveExposure(live);
          // Seed the cap input only once — periodic refreshes must not clobber
          // a value the operator is currently typing.
          if (!capSynced.current) {
            setCapInput(String(live.cap));
            capSynced.current = true;
          }
        } else {
          setLiveExposure(zeroExposure);
        }
      } else {
        setLiveExposure(zeroExposure);
      }
      setExposureLoading(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Lightweight exposure-only refresh — no loading spinner, no cap heuristics.
  // Route returns { ok: false } if settings SELECT fails, so on !p.ok we return
  // early and the previous state stays intact. capInput is not updated here;
  // explicit save handlers own that responsibility.
  const loadExposure = useCallback(async () => {
    try {
      const res = await fetch('/api/copy/exposure', { cache: 'no-store' });
      if (!res.ok) return;
      const p = await res.json();
      if (p.ok) {
        setLiveExposure(p.live as ExposureMetrics);
      }
      // !p.ok → settings read failed server-side; leave previous state as-is.
    } catch { /* network error — leave previous state as-is */ }
  }, []);

  const handleSaveLiveCap = async () => {
    const parsed = Number(capInput);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setMessage({ text: 'Enter a valid amount (0 = unlimited)', type: 'error' });
      return;
    }
    setSavingCap(true);
    setMessage(null);
    try {
      const res = await fetch('/api/copy/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ live_max_exposure_usd: parsed }),
        cache: 'no-store',
      });
      const payload = await res.json();
      if (payload.ok) {
        // Use the server-confirmed value straight from the PATCH response.
        // loadExposure() treats settings-fetch errors as non-fatal and may
        // return cap:0, which would snap the input and display back to 0.
        const savedCap: number =
          (payload.settings as { live_max_exposure_usd?: number } | null)
            ?.live_max_exposure_usd ?? parsed;
        setCapInput(String(savedCap));
        setLiveExposure((prev) => {
          if (!prev) return prev;
          const remaining = savedCap > 0 ? Math.max(0, savedCap - prev.exposure) : null;
          return { ...prev, cap: savedCap, remaining };
        });
        const label = savedCap > 0
          ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(savedCap)
          : 'Unlimited';
        setMessage({ text: `Live max exposure set to ${label}`, type: 'success' });
      } else {
        setMessage({ text: payload.error ?? 'Save failed', type: 'error' });
      }
    } catch {
      setMessage({ text: 'Network error saving cap', type: 'error' });
    } finally {
      setSavingCap(false);
    }
  };

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
    <div className={`profile-card live-card live-card-featured${isEnabled ? ' live-card--live-on' : ''}`}>
      <div className="live-card-header">
        <span className="live-card-label">LIVE BANKROLL</span>
        <div className="pnl-indicator">
          <span className={`live-dot ${isEnabled ? 'active' : ''}`} />
          <span>LIVE</span>
        </div>
      </div>

      {/* ── LIVE ON banner — rendered only when the master toggle is enabled ── */}
      {isEnabled && (
        <div className="live-active-banner" role="status" aria-label="Live trading is active">
          <span className="live-active-dot" aria-hidden="true" />
          <div className="live-active-text">
            <span className="live-active-label">LIVE ON</span>
            <span className="live-active-sub">Real-money trading active</span>
          </div>
        </div>
      )}

      <div className="live-balance">
        <div className="pnl-amount">
          {settings?.live_balance_usd != null ? formatUSD(settings.live_balance_usd) : '--'}
        </div>
        {/* Trend sparkline — powered by localStorage ring buffer */}
        <div className="live-sparkline-row">
          <MiniSparkline
            points={sparkPoints}
            id="live-bankroll"
            width={120}
            height={30}
            label={bankrollSpanLabel(sparkPoints) || undefined}
          />
        </div>
        <p className="pnl-subtext">Live Bankroll (USDC Polygon)</p>
        <p className="pnl-subtext">
          Last Updated:{' '}
          {settings?.live_updated_at ? new Date(settings.live_updated_at).toLocaleString() : '--'}
        </p>
      </div>

      <LiveWalletRow />

      {/* ── Live Open Exposure — always rendered, shows skeleton while loading ── */}
      <div style={{
        marginTop: '1rem',
        padding: '0.75rem 1rem',
        background: 'rgba(59, 130, 246, 0.06)',
        border: '1px solid rgba(59, 130, 246, 0.2)',
        borderRadius: '0.65rem',
        opacity: exposureLoading ? 0.5 : 1,
        transition: 'opacity 0.2s',
      }}>
        {/* Label row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.45rem' }}>
          <span style={{
            fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.09em',
            textTransform: 'uppercase', color: 'rgba(248,250,252,0.45)',
          }}>
            Open Exposure
          </span>
          <span style={{
            fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.05em',
            textTransform: 'uppercase', padding: '0.1em 0.45em',
            background: 'rgba(16,185,129,0.15)', color: '#34d399',
            border: '1px solid rgba(16,185,129,0.25)', borderRadius: '0.3rem',
          }}>
            LIVE · OPEN
          </span>
        </div>

        {/* Exposure amount */}
        <div style={{ fontSize: '1.4rem', fontWeight: 700, letterSpacing: '-0.01em', color: '#f8fafc', lineHeight: 1.1, marginBottom: '0.35rem' }}>
          {exposureLoading ? '—' : formatUSD(liveExposure?.exposure ?? 0)}
        </div>

        {/* Count + avg */}
        <div style={{ fontSize: '0.72rem', color: 'rgba(248,250,252,0.45)', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          {exposureLoading ? (
            <span>Loading…</span>
          ) : (
            <>
              <span>{liveExposure?.count ?? 0} open position{(liveExposure?.count ?? 0) !== 1 ? 's' : ''}</span>
              {(liveExposure?.count ?? 0) > 0 && (
                <span>Avg {formatUSD(liveExposure?.avg)}</span>
              )}
            </>
          )}
        </div>

        {/* Cap + remaining rows */}
        {!exposureLoading && (() => {
          const cap       = liveExposure?.cap ?? 0;
          const remaining = liveExposure?.remaining ?? null;
          const exposure  = liveExposure?.exposure ?? 0;
          const pct       = cap > 0 ? Math.min(100, (exposure / cap) * 100) : 0;
          const remColor  = remaining === null
            ? 'rgba(248,250,252,0.55)'
            : remaining <= 0 ? '#f87171' : remaining < cap * 0.2 ? '#fbbf24' : '#34d399';

          return (
            <div style={{ marginTop: '0.55rem', paddingTop: '0.45rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              {/* Max Exposure — READ-ONLY display of the DB-confirmed cap. */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.72rem', marginBottom: '0.2rem' }}>
                <span style={{ color: 'rgba(248,250,252,0.35)' }}>Max Exposure</span>
                <span style={{
                  fontWeight: 700,
                  color: cap > 0 ? '#f8fafc' : 'rgba(248,250,252,0.38)',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {cap > 0 ? formatUSD(cap) : 'Unlimited'}
                </span>
              </div>

              {/* Remaining row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.72rem', marginBottom: cap > 0 ? '0.1rem' : 0 }}>
                <span style={{ color: 'rgba(248,250,252,0.35)' }}>Remaining</span>
                <span style={{ fontWeight: 700, color: remColor, fontVariantNumeric: 'tabular-nums' }}>
                  {remaining === null ? 'Unlimited' : formatUSD(remaining)}
                </span>
              </div>

              {/* Utilisation bar */}
              {cap > 0 && (
                <div style={{ marginBottom: '0.5rem', height: '3px', borderRadius: '99px', background: 'rgba(255,255,255,0.07)' }}>
                  <div style={{
                    height: '100%', borderRadius: '99px',
                    width: `${pct}%`,
                    background: pct >= 100 ? '#f87171' : pct >= 80 ? '#fbbf24' : '#34d399',
                    transition: 'width 0.3s ease',
                  }} />
                </div>
              )}

              {/* Change-cap edit control — separate from the read-only display. */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: '0.3rem',
                paddingTop: '0.4rem', borderTop: '1px solid rgba(255,255,255,0.05)',
              }}>
                <span style={{ color: 'rgba(248,250,252,0.22)', fontSize: '0.63rem', flexShrink: 0 }}>Change cap:</span>
                <span style={{ color: 'rgba(248,250,252,0.18)', fontSize: '0.63rem' }}>$</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={capInput}
                  onChange={(e) => setCapInput(e.target.value)}
                  disabled={savingCap}
                  title="Live max exposure (0 = unlimited)"
                  style={{
                    flex: 1, minWidth: 0, maxWidth: '68px',
                    background: 'rgba(248,250,252,0.05)',
                    border: '1px solid rgba(248,250,252,0.08)',
                    borderRadius: '4px',
                    color: '#f8fafc',
                    fontSize: '0.72rem',
                    padding: '0.15rem 0.3rem',
                    fontVariantNumeric: 'tabular-nums',
                    outline: 'none',
                  }}
                />
                <button
                  onClick={handleSaveLiveCap}
                  disabled={savingCap}
                  style={{
                    padding: '0.15rem 0.45rem',
                    borderRadius: '4px',
                    border: '1px solid rgba(52,211,153,0.3)',
                    background: 'rgba(52,211,153,0.08)',
                    color: '#34d399',
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    cursor: savingCap ? 'not-allowed' : 'pointer',
                    opacity: savingCap ? 0.5 : 1,
                    lineHeight: 1,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {savingCap ? '…' : 'Save'}
                </button>
              </div>
              <div style={{ fontSize: '0.56rem', color: 'rgba(248,250,252,0.15)', textAlign: 'right', marginTop: '0.12rem' }}>
                0 = unlimited
              </div>
            </div>
          );
        })()}
      </div>

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
