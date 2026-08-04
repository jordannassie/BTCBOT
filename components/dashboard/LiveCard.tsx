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
const LIVE_WALLET       = '0x48c04c990182b23fd17c911d18c42605fad3312e';
const LIVE_WALLET_SHORT = `${LIVE_WALLET.slice(0, 6)}…${LIVE_WALLET.slice(-4)}`;
const LIVE_WALLET_PM_URL = `https://polymarket.com/profile/${LIVE_WALLET}`;

// ── Wallet row sub-component ─────────────────────────────────────────────────

function LiveWalletRow() {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(LIVE_WALLET).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '0.65rem', color: 'rgba(248,250,252,0.3)', fontWeight: 600, letterSpacing: '0.04em' }}>
        Live Wallet
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
        <a
          href={LIVE_WALLET_PM_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'rgba(248,250,252,0.55)', fontSize: '0.68rem', fontFamily: 'monospace', textDecoration: 'none' }}
          title="View on Polymarket"
        >
          {LIVE_WALLET_SHORT}
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </a>
        <button
          onClick={handleCopy}
          title={copied ? 'Copied!' : 'Copy full address'}
          aria-label="Copy full wallet address"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.15rem', display: 'flex', alignItems: 'center', color: 'rgba(248,250,252,0.4)' }}
        >
          {copied ? (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value ?? 0);

function pnlColor(v: number | null): string {
  if (v == null) return 'rgba(248,250,252,0.55)';
  if (v > 0) return '#34d399';
  if (v < 0) return '#f87171';
  return 'rgba(248,250,252,0.55)';
}

type ExposureMetrics = {
  count:     number;
  exposure:  number;
  avg:       number;
  cap:       number;
  remaining: number | null;
};

type LivePnl = {
  live_all_time_pnl_usd: number;
  live_today_pnl_usd:    number;
  closed_count:          number;
  today_closed_count:    number;
  capped:                boolean;
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function LiveCard() {
  // ── State (all original, unchanged) ─────────────────────────────────────
  const [settings,      setSettings]      = useState<BotSettings | null>(null);
  const [isEnabled,     setIsEnabled]     = useState(false);
  const [loading,       setLoading]       = useState(true);
  const [refreshing,    setRefreshing]    = useState(false);
  const [saving,        setSaving]        = useState(false);
  const [message,       setMessage]       = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [allowance,     setAllowance]     = useState<number | null>(null);
  const [sparkPoints,   setSparkPoints]   = useState<BankrollPoint[]>([]);
  const [liveExposure,  setLiveExposure]  = useState<ExposureMetrics | null>(null);
  const [exposureLoading, setExposureLoading] = useState(true);
  const [armLiveBots,   setArmLiveBots]   = useState<number | null>(null);
  const [livePnl,       setLivePnl]       = useState<LivePnl | null>(null);
  const [capInput,      setCapInput]      = useState('0');
  const [savingCap,     setSavingCap]     = useState(false);
  const [capEditing,    setCapEditing]    = useState(false);
  const [capSaveMsg,    setCapSaveMsg]    = useState<{ ok: boolean; text: string } | null>(null);
  const capSynced = useRef(false);
  const capPrev   = useRef('0'); // stores last confirmed value for cancel/rollback

  // ── NEW: collapsible risk panel ──────────────────────────────────────────
  const [riskExpanded, setRiskExpanded] = useState(false);

  // ── Data loading (all original, unchanged) ───────────────────────────────

  const loadSettings = useCallback(async () => {
    try {
      const [settingsRes, exposureRes, summaryRes, pnlRes] = await Promise.all([
        fetch('/api/bot-settings?bot_id=live', { cache: 'no-store' }),
        fetch('/api/copy/exposure',             { cache: 'no-store' }),
        fetch('/api/copy/summary',              { cache: 'no-store' }),
        fetch('/api/copy/live-pnl',             { cache: 'no-store' }),
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
          if (!capSynced.current) {
            setLiveExposure(live);
            const initialCap = String(live.cap);
            setCapInput(initialCap);
            capPrev.current = initialCap;
            capSynced.current = true;
          } else {
            setLiveExposure((prev) => {
              const cap       = prev?.cap ?? live.cap;
              const remaining = cap > 0 ? Math.max(0, cap - live.exposure) : null;
              return { ...live, cap, remaining };
            });
          }
        } else {
          setLiveExposure(zeroExposure);
        }
      } else {
        setLiveExposure(zeroExposure);
      }
      setExposureLoading(false);

      if (summaryRes.ok) {
        try {
          const sumPayload = await summaryRes.json();
          if (sumPayload.ok) setArmLiveBots(sumPayload.armLiveBotsCount ?? 0);
        } catch { /* non-critical */ }
      }

      if (pnlRes.ok) {
        try {
          const pnlPayload = await pnlRes.json();
          if (pnlPayload.ok) {
            setLivePnl({
              live_all_time_pnl_usd: pnlPayload.live_all_time_pnl_usd ?? 0,
              live_today_pnl_usd:    pnlPayload.live_today_pnl_usd    ?? 0,
              closed_count:          pnlPayload.closed_count           ?? 0,
              today_closed_count:    pnlPayload.today_closed_count     ?? 0,
              capped:                pnlPayload.capped                 ?? false,
            });
          }
        } catch { /* non-critical */ }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  const loadExposure = useCallback(async () => {
    try {
      const res = await fetch('/api/copy/exposure', { cache: 'no-store' });
      if (!res.ok) return;
      const p = await res.json();
      if (p.ok) {
        const live = p.live as ExposureMetrics;
        setLiveExposure((prev) => {
          const cap       = prev?.cap ?? live.cap;
          const remaining = cap > 0 ? Math.max(0, cap - live.exposure) : null;
          return { ...live, cap, remaining };
        });
      }
    } catch { /* leave previous state */ }
  }, []);
  // keep loadExposure in scope (used by handleSaveLiveCap implicitly via re-render)
  void loadExposure;

  const handleSaveLiveCap = async () => {
    const parsed = Number(capInput);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setCapSaveMsg({ ok: false, text: 'Enter a number greater than $0' });
      return;
    }
    setSavingCap(true);
    setCapSaveMsg(null);
    try {
      const res = await fetch('/api/copy/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ live_max_exposure_usd: parsed }),
        cache: 'no-store',
      });
      const payload = await res.json();
      if (payload.ok) {
        const savedCap: number =
          (payload.settings as { live_max_exposure_usd?: number } | null)
            ?.live_max_exposure_usd ?? parsed;
        const confirmedStr = String(savedCap);
        setCapInput(confirmedStr);
        capPrev.current = confirmedStr;
        setLiveExposure((prev) => {
          if (!prev) return prev;
          const remaining = savedCap > 0 ? Math.max(0, savedCap - prev.exposure) : null;
          return { ...prev, cap: savedCap, remaining };
        });
        setCapEditing(false);
        setCapSaveMsg({ ok: true, text: 'Saved' });
        setTimeout(() => setCapSaveMsg(null), 2000);
      } else {
        // Rollback input to last confirmed value on API error
        setCapInput(capPrev.current);
        setCapSaveMsg({ ok: false, text: payload.error ?? 'Save failed' });
      }
    } catch {
      setCapInput(capPrev.current);
      setCapSaveMsg({ ok: false, text: 'Network error — value restored' });
    } finally {
      setSavingCap(false);
    }
  };

  const handleQuickAdjust = async (delta: number) => {
    const current = Number(capPrev.current);
    const next = Number.isFinite(current) ? Math.max(1, current + delta) : Math.abs(delta);
    const nextStr = String(next);
    setCapInput(nextStr);
    // Immediately save the adjusted value
    setSavingCap(true);
    setCapSaveMsg(null);
    try {
      const res = await fetch('/api/copy/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ live_max_exposure_usd: next }),
        cache: 'no-store',
      });
      const payload = await res.json();
      if (payload.ok) {
        const savedCap: number =
          (payload.settings as { live_max_exposure_usd?: number } | null)
            ?.live_max_exposure_usd ?? next;
        const confirmedStr = String(savedCap);
        setCapInput(confirmedStr);
        capPrev.current = confirmedStr;
        setLiveExposure((prev) => {
          if (!prev) return prev;
          const remaining = savedCap > 0 ? Math.max(0, savedCap - prev.exposure) : null;
          return { ...prev, cap: savedCap, remaining };
        });
        setCapSaveMsg({ ok: true, text: `Saved ${delta > 0 ? '+' : ''}${formatUSD(delta)}` });
        setTimeout(() => setCapSaveMsg(null), 1500);
      } else {
        setCapInput(capPrev.current);
        setCapSaveMsg({ ok: false, text: payload.error ?? 'Save failed' });
      }
    } catch {
      setCapInput(capPrev.current);
      setCapSaveMsg({ ok: false, text: 'Network error' });
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
        body: JSON.stringify({ bot_id: 'live', is_enabled: enabled }),
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

  // ── Loading skeleton ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{
        flex: 1, minWidth: 0,
        background: 'rgba(15,17,26,0.7)', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '1rem', padding: '1.5rem',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '200px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
      }}>
        <span style={{ color: 'rgba(248,250,252,0.3)', fontSize: '0.8rem' }}>Loading…</span>
      </div>
    );
  }

  // ── Derived display values ────────────────────────────────────────────────
  const cash          = settings?.live_balance_usd ?? null;
  const openExposure  = liveExposure?.exposure ?? 0;
  const openCount     = liveExposure?.count    ?? 0;
  const allTimePnl    = livePnl?.live_all_time_pnl_usd ?? null;
  const armCount      = armLiveBots ?? null;
  const liveNow       = armCount !== null && isEnabled ? armCount : 0;

  const cap           = liveExposure?.cap       ?? 0;
  const remaining     = liveExposure?.remaining ?? null;
  const exposure      = liveExposure?.exposure  ?? 0;
  const pct           = cap > 0 ? Math.min(100, (exposure / cap) * 100) : 0;
  const remColor      = remaining === null ? 'rgba(248,250,252,0.55)'
                      : remaining <= 0 ? '#f87171' : remaining < cap * 0.2 ? '#fbbf24' : '#34d399';

  const allTimePnlDisplay = allTimePnl != null
    ? `${allTimePnl >= 0 ? '+' : ''}${formatUSD(allTimePnl)}`
    : '—';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{
      flex:          1,
      minWidth:      0,
      background:    'rgba(15,17,26,0.7)',
      border:        isEnabled
        ? '1px solid rgba(52,211,153,0.2)'
        : '1px solid rgba(255,255,255,0.08)',
      borderRadius:  '1rem',
      padding:       '1.5rem',
      display:       'flex',
      flexDirection: 'column',
      gap:           '1rem',
      boxShadow:     isEnabled
        ? '0 8px 32px rgba(52,211,153,0.05), 0 8px 32px rgba(0,0,0,0.3)'
        : '0 8px 32px rgba(0,0,0,0.3)',
      position:      'relative',
      overflow:      'hidden',
    }}>
      {/* Background accent */}
      <div style={{
        position:   'absolute', top: 0, right: 0,
        width:      280, height: 280, pointerEvents: 'none',
        background: 'radial-gradient(circle at top right, rgba(52,211,153,0.05), transparent 70%)',
      }} />

      {/* ── Header: title + status badge | large avatar ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#f8fafc', letterSpacing: '0.04em', marginBottom: '0.15rem' }}>
            LIVE BANKROLL
          </div>
          <div style={{ fontSize: '0.68rem', color: 'rgba(248,250,252,0.35)', marginBottom: '0.4rem' }}>
            Real-money trading account
          </div>
          {/* LIVE status badge */}
          <div style={{
            display:     'inline-flex', alignItems: 'center', gap: '0.3rem',
            padding:     '0.2rem 0.55rem', borderRadius: '0.3rem',
            background:  isEnabled ? 'rgba(52,211,153,0.1)'  : 'rgba(255,255,255,0.04)',
            border:      isEnabled ? '1px solid rgba(52,211,153,0.3)' : '1px solid rgba(255,255,255,0.1)',
            fontSize:    '0.62rem', fontWeight: 700, letterSpacing: '0.07em',
            color:       isEnabled ? '#34d399' : 'rgba(248,250,252,0.35)',
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
              background: isEnabled ? '#34d399' : 'rgba(255,255,255,0.2)',
              boxShadow:  isEnabled ? '0 0 5px #34d399' : 'none',
            }} />
            {isEnabled ? 'LIVE ON' : 'LIVE STANDBY'}
          </div>
        </div>

        {/* Avatar — upper right, prominent but not layout-breaking */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="https://jyhfffqximlbhlaarozs.supabase.co/storage/v1/render/image/public/Storage/image/HOLD.png?width=320&height=320&quality=100&resize=cover"
          alt="Profile"
          style={{
            width:           160, height: 160,
            borderRadius:    '50%', objectFit: 'cover', flexShrink: 0,
            border:          '2px solid rgba(52,211,153,0.25)',
            boxShadow:       '0 0 0 4px rgba(52,211,153,0.06), 0 3px 14px rgba(0,0,0,0.5)',
            imageRendering:  'auto',
          }}
        />
      </div>

      {/* ── Hero balance (matches paper card typography) ── */}
      <div>
        <div style={{ fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(248,250,252,0.3)', marginBottom: '0.2rem' }}>
          Live Bankroll Equity
        </div>
        <div style={{
          fontSize: '2.6rem', fontWeight: 800, fontFamily: 'monospace',
          color: '#f8fafc', letterSpacing: '-0.02em', lineHeight: 1,
        }}>
          {cash != null ? formatUSD(cash) : '—'}
        </div>
        <div style={{ fontSize: '0.72rem', color: 'rgba(248,250,252,0.4)', marginTop: '0.35rem', display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          <span>USDC · Polygon</span>
          {settings?.live_updated_at && (
            <span style={{ color: 'rgba(248,250,252,0.25)' }}>
              {new Date(settings.live_updated_at).toLocaleString()}
            </span>
          )}
        </div>
      </div>

      {/* ── Four-metric grid (matches paper card stat grid style) ── */}
      <div style={{
        display:           'grid',
        gridTemplateColumns:'repeat(2, 1fr)',
        gap:               '0.6rem',
        borderTop:         '1px solid rgba(255,255,255,0.06)',
        paddingTop:        '0.75rem',
      }}>
        {([
          { label: 'CASH',           val: cash != null ? formatUSD(cash) : '—',    color: undefined },
          { label: 'OPEN EXPOSURE',  val: exposureLoading ? '—' : formatUSD(openExposure), color: undefined },
          { label: 'OPEN POSITIONS', val: exposureLoading ? '—' : String(openCount), color: openCount > 0 ? '#fbbf24' : undefined },
          { label: 'ALL-TIME P/L',   val: allTimePnlDisplay, color: pnlColor(allTimePnl) },
        ] as { label: string; val: string; color?: string }[]).map(({ label, val, color }) => (
          <div key={label} style={{
            background:   'rgba(255,255,255,0.03)', borderRadius: '0.5rem',
            padding:      '0.5rem 0.65rem',
            border:       '1px solid rgba(255,255,255,0.06)',
          }}>
            <div style={{ fontSize: '0.6rem', color: 'rgba(248,250,252,0.3)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.25rem' }}>
              {label}
            </div>
            <div style={{ fontSize: '0.85rem', fontWeight: 700, fontFamily: 'monospace', color: color ?? '#f8fafc' }}>
              {val}
            </div>
          </div>
        ))}
      </div>

      {/* ── Live bankroll equity sparkline ── */}
      <div style={{ marginTop: '-0.25rem' }}>
        <div style={{ fontSize: '0.6rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(248,250,252,0.25)', marginBottom: '0.3rem' }}>
          Live Bankroll Equity
        </div>
        <div style={{
          background:   'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)',
          borderRadius: '0.5rem', padding: '0.65rem 0.5rem',
          overflow:     'hidden',
          minHeight:    '80px',
          display:      'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {sparkPoints.length > 0 ? (
            <MiniSparkline
              points={sparkPoints}
              id="live-bankroll"
              width={320}
              height={64}
              label={bankrollSpanLabel(sparkPoints) || undefined}
            />
          ) : (
            <span style={{ fontSize: '0.65rem', color: 'rgba(248,250,252,0.2)', fontStyle: 'italic' }}>
              No equity history yet
            </span>
          )}
        </div>
      </div>

      {/* ── Compact wallet row ── */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.65rem' }}>
        <LiveWalletRow />
        <div style={{ fontSize: '0.62rem', color: 'rgba(248,250,252,0.25)', marginTop: '0.3rem' }}>
          Available Cash: <span style={{ color: 'rgba(248,250,252,0.55)', fontFamily: 'monospace' }}>{cash != null ? formatUSD(cash) : '—'}</span>
        </div>
      </div>

      {/* ── LIVE Master toggle (footer — always visible) ── */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.65rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#f8fafc', letterSpacing: '0.01em' }}>
              LIVE ON (Master)
            </div>
            <div style={{ fontSize: '0.62rem', color: 'rgba(248,250,252,0.35)', marginTop: '0.1rem', lineHeight: 1.4 }}>
              Authorizes enabled bots to submit real orders
            </div>
          </div>
          <div className="toggle-switch" style={{ flexShrink: 0 }}>
            <input
              type="checkbox"
              checked={isEnabled}
              onChange={(e) => handleToggle(e.target.checked)}
              disabled={saving}
              id="live-enabled"
            />
            <label className="toggle-slider" htmlFor="live-enabled" />
          </div>
        </div>

        {/* Inline save message */}
        {message && (
          <div style={{ marginTop: '0.35rem', fontSize: '0.68rem', color: message.type === 'success' ? '#10b981' : '#ef4444' }}>
            {message.text}
          </div>
        )}

        {/* Allowance warning */}
        {allowance != null && cash != null && allowance < cash && (
          <div style={{ marginTop: '0.3rem', fontSize: '0.62rem', color: '#fbbf24' }}>
            ⚠ Allowance low
          </div>
        )}
      </div>

      {/* ── Collapsible: Live Risk & Controls ── */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.55rem' }}>

        {/* Collapse toggle header */}
        <button
          onClick={() => setRiskExpanded((e) => !e)}
          style={{
            display:        'flex', alignItems: 'center', justifyContent: 'space-between',
            width:          '100%', background: 'none', border: 'none', cursor: 'pointer',
            padding:        '0.1rem 0', gap: '0.5rem',
          }}
        >
          <span style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.05em', color: 'rgba(248,250,252,0.5)' }}>
            Live Risk &amp; Controls
          </span>
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none"
            stroke="rgba(248,250,252,0.35)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: riskExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s', flexShrink: 0 }}
          >
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>

        {/* Collapsed summary */}
        {!riskExpanded && (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.4rem', fontSize: '0.62rem', color: 'rgba(248,250,252,0.35)' }}>
            <span>Max: <span style={{ color: 'rgba(248,250,252,0.6)', fontFamily: 'monospace', fontWeight: 700 }}>{cap > 0 ? formatUSD(cap) : 'Unlimited'}</span></span>
            <span style={{ color: 'rgba(248,250,252,0.2)' }}>·</span>
            <span>Current: <span style={{ color: 'rgba(248,250,252,0.55)', fontFamily: 'monospace' }}>{exposureLoading ? '—' : formatUSD(openExposure)}</span></span>
            <span style={{ color: 'rgba(248,250,252,0.2)' }}>·</span>
            <span>Remaining: <span style={{ color: remColor, fontFamily: 'monospace' }}>{remaining === null ? 'Unlimited' : formatUSD(remaining)}</span></span>
          </div>
        )}

        {/* Expanded controls */}
        {riskExpanded && (
          <div style={{ marginTop: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>

            {/* ── Max Live Exposure control ── */}
            <div style={{
              padding: '0.75rem 0.85rem',
              background: 'rgba(52,211,153,0.04)', border: '1px solid rgba(52,211,153,0.15)',
              borderRadius: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.5rem',
            }}>
              {/* Label */}
              <div style={{ fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(248,250,252,0.3)' }}>
                Max Live Exposure
              </div>

              {/* View mode */}
              {!capEditing ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {/* Quick -$10 */}
                  <button
                    onClick={() => handleQuickAdjust(-10)}
                    title="Decrease by $10"
                    style={{
                      padding: '0.15rem 0.4rem', borderRadius: '0.3rem',
                      background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)',
                      color: '#f87171', fontSize: '0.62rem', fontWeight: 700, cursor: 'pointer',
                      lineHeight: 1, whiteSpace: 'nowrap',
                    }}
                  >
                    −$10
                  </button>

                  {/* Current value */}
                  <span style={{
                    fontSize: '1.15rem', fontWeight: 800, fontFamily: 'monospace',
                    color: '#f8fafc', letterSpacing: '-0.01em', flex: 1,
                  }}>
                    {cap > 0 ? formatUSD(cap) : 'Unlimited'}
                  </span>

                  {/* Quick +$10 */}
                  <button
                    onClick={() => handleQuickAdjust(10)}
                    title="Increase by $10"
                    style={{
                      padding: '0.15rem 0.4rem', borderRadius: '0.3rem',
                      background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.2)',
                      color: '#34d399', fontSize: '0.62rem', fontWeight: 700, cursor: 'pointer',
                      lineHeight: 1, whiteSpace: 'nowrap',
                    }}
                  >
                    +$10
                  </button>

                  {/* Edit button */}
                  <button
                    onClick={() => { setCapEditing(true); setCapSaveMsg(null); }}
                    style={{
                      padding: '0.18rem 0.55rem', borderRadius: '0.3rem',
                      background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
                      color: 'rgba(248,250,252,0.6)', fontSize: '0.65rem', fontWeight: 700,
                      cursor: 'pointer', lineHeight: 1,
                    }}
                  >
                    Edit
                  </button>
                </div>
              ) : (
                /* Edit mode */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <span style={{ color: 'rgba(248,250,252,0.35)', fontFamily: 'monospace', fontSize: '0.85rem', flexShrink: 0 }}>$</span>
                    <input
                      type="number"
                      min="0.01"
                      step="1"
                      value={capInput}
                      onChange={(e) => { setCapInput(e.target.value); setCapSaveMsg(null); }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveLiveCap();
                        if (e.key === 'Escape') { setCapEditing(false); setCapInput(capPrev.current); setCapSaveMsg(null); }
                      }}
                      disabled={savingCap}
                      autoFocus
                      style={{
                        flex: 1, minWidth: 0,
                        background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(52,211,153,0.3)',
                        borderRadius: '0.35rem', color: '#f8fafc', fontSize: '0.9rem',
                        padding: '0.3rem 0.55rem', fontFamily: 'monospace', outline: 'none',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    />
                    <button
                      onClick={handleSaveLiveCap}
                      disabled={savingCap}
                      style={{
                        padding: '0.28rem 0.65rem', borderRadius: '0.35rem',
                        border: '1px solid rgba(52,211,153,0.4)', background: 'rgba(52,211,153,0.12)',
                        color: '#34d399', fontSize: '0.7rem', fontWeight: 700,
                        cursor: savingCap ? 'not-allowed' : 'pointer',
                        opacity: savingCap ? 0.55 : 1, lineHeight: 1, whiteSpace: 'nowrap',
                      }}
                    >
                      {savingCap ? '…' : 'Save'}
                    </button>
                    <button
                      onClick={() => { setCapEditing(false); setCapInput(capPrev.current); setCapSaveMsg(null); }}
                      disabled={savingCap}
                      style={{
                        padding: '0.28rem 0.55rem', borderRadius: '0.35rem',
                        border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)',
                        color: 'rgba(248,250,252,0.45)', fontSize: '0.7rem', fontWeight: 600,
                        cursor: 'pointer', lineHeight: 1,
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                  <div style={{ fontSize: '0.58rem', color: 'rgba(248,250,252,0.2)' }}>
                    Enter &amp; save · Esc to cancel
                  </div>
                </div>
              )}

              {/* Save feedback message */}
              {capSaveMsg && (
                <div style={{ fontSize: '0.65rem', fontWeight: 600, color: capSaveMsg.ok ? '#34d399' : '#f87171' }}>
                  {capSaveMsg.ok ? '✓ ' : '✗ '}{capSaveMsg.text}
                </div>
              )}

              {/* ── Three read-only rows below ── */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', paddingTop: '0.45rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                {([
                  { label: 'Current Exposure', val: exposureLoading ? '—' : formatUSD(openExposure), color: '#f8fafc' },
                  { label: 'Remaining Capacity', val: remaining === null ? 'Unlimited' : formatUSD(remaining), color: remColor },
                  { label: 'Open Positions',    val: exposureLoading ? '—' : `${openCount} position${openCount !== 1 ? 's' : ''}`, color: openCount > 0 ? '#fbbf24' : '#f8fafc' },
                ] as { label: string; val: string; color: string }[]).map(({ label, val, color }) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.7rem' }}>
                    <span style={{ color: 'rgba(248,250,252,0.35)' }}>{label}</span>
                    <span style={{ fontWeight: 700, color, fontVariantNumeric: 'tabular-nums', fontFamily: 'monospace' }}>{val}</span>
                  </div>
                ))}
              </div>

              {/* Utilisation bar */}
              {cap > 0 && !exposureLoading && (
                <div style={{ height: 3, borderRadius: 99, background: 'rgba(255,255,255,0.07)' }}>
                  <div style={{
                    height: '100%', borderRadius: 99, width: `${pct}%`,
                    background: pct >= 100 ? '#f87171' : pct >= 80 ? '#fbbf24' : '#34d399',
                    transition: 'width 0.3s ease',
                  }} />
                </div>
              )}
            </div>

            {/* ARM LIVE bots + Live Active */}
            <div style={{
              padding: '0.55rem 0.75rem', background: 'rgba(248,250,252,0.02)',
              border: '1px solid rgba(248,250,252,0.06)', borderRadius: '0.5rem',
              display: 'flex', flexDirection: 'column', gap: '0.25rem',
            }}>
              {([
                { label: 'ARM LIVE Bots',   val: armCount !== null ? String(armCount) : '—', color: armCount !== null && armCount > 0 ? '#f8fafc' : 'rgba(248,250,252,0.35)' },
                { label: 'Live Active Now', val: armCount !== null ? String(liveNow) : '—', color: liveNow > 0 ? '#34d399' : 'rgba(248,250,252,0.35)' },
              ] as { label: string; val: string; color: string }[]).map(({ label, val, color }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.72rem' }}>
                  <span style={{ color: 'rgba(248,250,252,0.38)' }}>{label}</span>
                  <span style={{ fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{val}</span>
                </div>
              ))}
            </div>

            {/* Live status diagnostic */}
            <div style={{ fontSize: '0.62rem', color: settings?.live_balance_usd ? 'rgba(52,211,153,0.6)' : '#f87171', padding: '0.15rem 0' }}>
              {settings?.live_balance_usd
                ? '✓ LIVE bankroll OK'
                : '⚠ LIVE bankroll not updating (check worker)'}
            </div>

            {/* Refresh Balance — compact secondary button */}
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              style={{
                padding: '0.35rem 0.75rem', borderRadius: '0.4rem',
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                color: 'rgba(248,250,252,0.5)', fontSize: '0.7rem', fontWeight: 600,
                cursor: refreshing ? 'wait' : 'pointer',
                letterSpacing: '0.03em', alignSelf: 'flex-start',
              }}
            >
              {refreshing ? 'Refreshing…' : 'Refresh Balance'}
            </button>

          </div>
        )}
      </div>
    </div>
  );
}
