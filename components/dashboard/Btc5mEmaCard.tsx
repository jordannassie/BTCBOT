'use client';

import { useCallback, useEffect, useState } from 'react';
import type { BotSettings } from '@/lib/botData';

const BOT_ID = 'btc_5m_ema';

type EmaSignal = 'YES' | 'NO' | 'NONE';

type EmaStratSettings = {
  ema9:                   number | null;
  ema200:                 number | null;
  last_close:             number | null;
  signal:                 EmaSignal | null;
  paper_max_exposure_usd: number | null;
  live_max_exposure_usd:  number | null;
};

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtPrice(v: number | null): string {
  if (v == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
}

function fmtEma(v: number | null): string {
  if (v == null) return '—';
  return v.toFixed(2);
}

// ── Status badge ──────────────────────────────────────────────────────────────

function getStatus(
  isEnabled: boolean,
  armLive: boolean,
  mode: 'PAPER' | 'LIVE'
): { label: string; color: string } {
  if (isEnabled && armLive && mode === 'LIVE') {
    return { label: 'LIVE ON',      color: '#34d399' };
  }
  if (mode === 'LIVE' && armLive) {
    return { label: 'LIVE READY',   color: '#fbbf24' };
  }
  if (mode === 'LIVE') {
    return { label: 'LIVE BLOCKED', color: '#f87171' };
  }
  return { label: 'PAPER ONLY', color: '#60a5fa' };
}

// ── Parse strategy_settings JSONB ────────────────────────────────────────────

function parseStratSettings(settings: BotSettings | null): EmaStratSettings {
  const s = settings?.strategy_settings ?? {};
  return {
    ema9:                   typeof s.ema9                   === 'number' ? s.ema9                   : null,
    ema200:                 typeof s.ema200                 === 'number' ? s.ema200                 : null,
    last_close:             typeof s.last_close             === 'number' ? s.last_close             : null,
    paper_max_exposure_usd: typeof s.paper_max_exposure_usd === 'number' ? s.paper_max_exposure_usd : null,
    live_max_exposure_usd:  typeof s.live_max_exposure_usd  === 'number' ? s.live_max_exposure_usd  : null,
    signal:
      s.signal === 'YES' || s.signal === 'NO' || s.signal === 'NONE'
        ? (s.signal as EmaSignal)
        : null,
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Btc5mEmaCard() {
  const [settings, setSettings] = useState<BotSettings | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [msg,      setMsg]      = useState<{ text: string; ok: boolean } | null>(null);

  // Editable fields — synced from server on load, then locally controlled
  const [isEnabled,      setIsEnabled]      = useState(false);
  const [armLive,        setArmLive]        = useState(false);
  const [mode,           setMode]           = useState<'PAPER' | 'LIVE'>('PAPER');
  const [tradeSize,      setTradeSize]      = useState('10');
  const [maxTrades,      setMaxTrades]      = useState('5');
  // Bankroll fields
  const [paperBalance,   setPaperBalance]   = useState('');
  const [paperMaxExp,    setPaperMaxExp]    = useState('');
  const [liveMaxExp,     setLiveMaxExp]     = useState('');

  const syncFromSettings = (s: BotSettings) => {
    setIsEnabled(s.is_enabled ?? false);
    setArmLive(s.arm_live ?? false);
    setMode(s.mode ?? 'PAPER');
    setTradeSize(String(s.trade_size_usd ?? s.trade_size ?? 10));
    setMaxTrades(String(s.max_trades_per_hour ?? 5));
    // Bankroll
    const ss = s.strategy_settings ?? {};
    setPaperBalance(s.paper_balance_usd != null ? String(s.paper_balance_usd) : '');
    setPaperMaxExp(typeof ss.paper_max_exposure_usd === 'number' ? String(ss.paper_max_exposure_usd) : '');
    setLiveMaxExp(typeof ss.live_max_exposure_usd  === 'number' ? String(ss.live_max_exposure_usd)  : '');
  };

  const load = useCallback(async () => {
    try {
      const res     = await fetch(`/api/bot-settings?bot_id=${BOT_ID}`, { cache: 'no-store' });
      const payload = await res.json();
      if (payload.ok && payload.settings) {
        setSettings(payload.settings);
        // Only sync form fields on first load — don't overwrite while user is editing
        if (loading) syncFromSettings(payload.settings);
      }
    } catch {
      // silently fail — placeholders remain visible
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
    // Poll every 30 s so signal / EMA values refresh when the Worker writes them
    const interval = setInterval(async () => {
      try {
        const res     = await fetch(`/api/bot-settings?bot_id=${BOT_ID}`, { cache: 'no-store' });
        const payload = await res.json();
        if (payload.ok && payload.settings) {
          // Only refresh the signal read-only data — never overwrite form inputs mid-edit
          setSettings(payload.settings);
        }
      } catch { /* ignore */ }
    }, 30_000);
    return () => clearInterval(interval);
  }, [load]);

  const handleSave = async () => {
    setSaving(true);
    setMsg(null);
    try {
      // Build strategy_settings patch — only include fields the user has set.
      // The API merges these into the existing JSONB (preserving Worker-written fields).
      const stratPatch: Record<string, number> = {};
      const parsedPaperMax = parseFloat(paperMaxExp);
      const parsedLiveMax  = parseFloat(liveMaxExp);
      if (!isNaN(parsedPaperMax) && parsedPaperMax >= 0) stratPatch.paper_max_exposure_usd = parsedPaperMax;
      if (!isNaN(parsedLiveMax)  && parsedLiveMax  >= 0) stratPatch.live_max_exposure_usd  = parsedLiveMax;

      const parsedPaperBal = parseFloat(paperBalance);

      const res = await fetch('/api/bot-settings', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bot_id:              BOT_ID,
          is_enabled:          isEnabled,
          arm_live:            armLive,
          mode,
          trade_size:          parseFloat(tradeSize) || 10,
          max_trades_per_hour: parseInt(maxTrades, 10) || 5,
          ...(Number.isFinite(parsedPaperBal) && parsedPaperBal >= 0
            ? { paper_balance_usd: parsedPaperBal }
            : {}),
          ...(Object.keys(stratPatch).length > 0
            ? { strategy_settings: stratPatch }
            : {}),
        }),
        cache: 'no-store',
      });
      const payload = await res.json();
      if (payload.ok) {
        setSettings(payload.settings);
        // Re-sync bankroll inputs from confirmed server values
        const saved = payload.settings as BotSettings;
        const ss = saved?.strategy_settings ?? {};
        if (saved?.paper_balance_usd != null) setPaperBalance(String(saved.paper_balance_usd));
        if (typeof ss.paper_max_exposure_usd === 'number') setPaperMaxExp(String(ss.paper_max_exposure_usd));
        if (typeof ss.live_max_exposure_usd  === 'number') setLiveMaxExp(String(ss.live_max_exposure_usd));
        setMsg({ text: 'Saved', ok: true });
      } else {
        setMsg({ text: payload.error ?? 'Save failed', ok: false });
      }
    } catch {
      setMsg({ text: 'Network error', ok: false });
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(null), 3_000);
    }
  };

  const { label: statusLabel, color: statusColor } = getStatus(isEnabled, armLive, mode);
  const ema = parseStratSettings(settings);

  const signalColor =
    ema.signal === 'YES'  ? '#34d399' :
    ema.signal === 'NO'   ? '#f87171' :
                            'rgba(248,250,252,0.4)';

  // ── Shared inline styles ────────────────────────────────────────────────────

  const inputStyle: React.CSSProperties = {
    width: '5rem',
    background: 'rgba(248,250,252,0.05)',
    border: '1px solid rgba(248,250,252,0.1)',
    borderRadius: '4px',
    color: '#f8fafc',
    fontSize: '0.8rem',
    padding: '0.2rem 0.4rem',
    textAlign: 'right',
    outline: 'none',
  };

  // ── Loading skeleton ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="profile-card ema-card">
        <p style={{ color: 'rgba(248,250,252,0.35)', fontSize: '0.8rem' }}>Loading…</p>
      </div>
    );
  }

  // ── Full card ───────────────────────────────────────────────────────────────

  return (
    <div className="profile-card ema-card">

      {/* ── Header: name + status badge ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: '0.9rem',
      }}>
        <span style={{
          fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.1em',
          textTransform: 'uppercase', color: 'rgba(248,250,252,0.5)',
        }}>
          BTC 5M EMA
        </span>
        <span style={{
          fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.07em',
          textTransform: 'uppercase', padding: '0.2em 0.6em',
          borderRadius: '0.3rem',
          border: `1px solid ${statusColor}44`,
          background: `${statusColor}18`,
          color: statusColor,
        }}>
          {statusLabel}
        </span>
      </div>

      {/* ── Current Signal block ── */}
      <div style={{
        marginBottom: '1rem', padding: '0.75rem 0.9rem',
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: '0.6rem',
      }}>
        <div style={{
          fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.09em',
          textTransform: 'uppercase', color: 'rgba(248,250,252,0.32)',
          marginBottom: '0.35rem',
        }}>
          Current Signal
        </div>

        <div style={{
          fontSize: '1.7rem', fontWeight: 800, letterSpacing: '-0.01em',
          color: signalColor, lineHeight: 1,
        }}>
          {ema.signal ?? '—'}
        </div>

        <div style={{ fontSize: '0.62rem', color: 'rgba(248,250,252,0.28)', marginTop: '0.45rem' }}>
          {ema.signal === 'YES'  && 'Above both EMAs = YES'}
          {ema.signal === 'NO'   && 'Below both EMAs = NO'}
          {ema.signal === 'NONE' && 'No clear signal'}
          {ema.signal === null   && 'Waiting for Worker…'}
        </div>
      </div>

      {/* ── Market data rows: EMA 9 / EMA 200 / Last Close ── */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: '0.4rem',
        marginBottom: '1.1rem',
        padding: '0.65rem 0.9rem',
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.05)',
        borderRadius: '0.55rem',
      }}>
        {([
          { label: 'EMA 9',         value: fmtEma(ema.ema9) },
          { label: 'EMA 200',       value: fmtEma(ema.ema200) },
          { label: 'Last 5m Close', value: fmtPrice(ema.last_close) },
        ] as const).map(({ label, value }) => (
          <div
            key={label}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              fontSize: '0.73rem',
            }}
          >
            <span style={{ color: 'rgba(248,250,252,0.35)' }}>{label}</span>
            <span style={{
              fontWeight: 600, color: '#f8fafc',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {value}
            </span>
          </div>
        ))}
      </div>

      {/* ── Bankroll ── */}
      <div style={{
        marginBottom: '1.1rem',
        borderRadius: '0.6rem',
        overflow: 'hidden',
        border: '1px solid rgba(255,255,255,0.07)',
      }}>
        {/* Paper sub-section */}
        <div style={{
          padding: '0.65rem 0.9rem',
          background: 'rgba(96,165,250,0.05)',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
        }}>
          <div style={{
            fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.09em',
            textTransform: 'uppercase', color: '#60a5fa', marginBottom: '0.55rem',
          }}>
            Paper
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
            {/* Paper Balance */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.73rem' }}>
              <span style={{ color: 'rgba(248,250,252,0.38)' }}>Balance (USD)</span>
              <input
                type="number"
                min="0"
                step="1"
                placeholder="—"
                value={paperBalance}
                onChange={(e) => setPaperBalance(e.target.value)}
                style={{ ...inputStyle, width: '6rem' }}
              />
            </div>
            {/* Paper Max Exposure */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.73rem' }}>
              <span style={{ color: 'rgba(248,250,252,0.38)' }}>Max Exposure (USD)</span>
              <input
                type="number"
                min="0"
                step="1"
                placeholder="—"
                value={paperMaxExp}
                onChange={(e) => setPaperMaxExp(e.target.value)}
                style={{ ...inputStyle, width: '6rem' }}
              />
            </div>
          </div>
        </div>

        {/* Live sub-section */}
        <div style={{
          padding: '0.65rem 0.9rem',
          background: 'rgba(52,211,153,0.04)',
        }}>
          <div style={{
            fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.09em',
            textTransform: 'uppercase', color: '#34d399', marginBottom: '0.55rem',
          }}>
            Live
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
            {/* Live Balance — read-only, updated by the Worker */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.73rem' }}>
              <span style={{ color: 'rgba(248,250,252,0.38)' }}>Balance (USD)</span>
              <span style={{
                fontWeight: 600, color: '#f8fafc',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {settings?.live_balance_usd != null
                  ? fmtPrice(settings.live_balance_usd)
                  : '—'}
              </span>
            </div>
            {/* Live Max Exposure */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.73rem' }}>
              <span style={{ color: 'rgba(248,250,252,0.38)' }}>Max Exposure (USD)</span>
              <input
                type="number"
                min="0"
                step="1"
                placeholder="—"
                value={liveMaxExp}
                onChange={(e) => setLiveMaxExp(e.target.value)}
                style={{ ...inputStyle, width: '6rem' }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Controls ── */}
      <div className="operator-form">

        {/* Mode — PAPER / LIVE pill toggle */}
        <label className="operator-row">
          <span>Mode</span>
          <div style={{ display: 'flex', gap: '0.3rem' }}>
            {(['PAPER', 'LIVE'] as const).map((m) => {
              const active  = mode === m;
              const accent  = m === 'LIVE' ? '#f87171' : '#60a5fa';
              return (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  style={{
                    fontSize: '0.63rem', fontWeight: 700,
                    padding: '0.22em 0.65em', borderRadius: '0.3rem',
                    border: `1px solid ${active ? accent : 'rgba(255,255,255,0.1)'}`,
                    background: active ? `${accent}22` : 'transparent',
                    color: active ? accent : 'rgba(248,250,252,0.32)',
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}
                >
                  {m}
                </button>
              );
            })}
          </div>
        </label>

        {/* Enabled */}
        <label className="operator-row">
          <span>Enabled</span>
          <div className="toggle-switch">
            <input
              type="checkbox"
              id={`${BOT_ID}-enabled`}
              checked={isEnabled}
              onChange={(e) => setIsEnabled(e.target.checked)}
            />
            <label className="toggle-slider" htmlFor={`${BOT_ID}-enabled`} />
          </div>
        </label>

        {/* ARM LIVE */}
        <label className="operator-row">
          <span>ARM LIVE</span>
          <div className="toggle-switch">
            <input
              type="checkbox"
              id={`${BOT_ID}-arm`}
              checked={armLive}
              onChange={(e) => setArmLive(e.target.checked)}
            />
            <label className="toggle-slider" htmlFor={`${BOT_ID}-arm`} />
          </div>
        </label>

        {/* Trade size */}
        <label className="operator-row">
          <span>Trade Size (USD)</span>
          <input
            type="number"
            min="1"
            step="1"
            value={tradeSize}
            onChange={(e) => setTradeSize(e.target.value)}
            style={inputStyle}
          />
        </label>

        {/* Max trades/hr */}
        <label className="operator-row">
          <span>Max Trades / Hr</span>
          <input
            type="number"
            min="1"
            step="1"
            value={maxTrades}
            onChange={(e) => setMaxTrades(e.target.value)}
            style={{ ...inputStyle, width: '4rem' }}
          />
        </label>
      </div>

      {/* ── Feedback + Save ── */}
      {msg && (
        <div style={{
          fontSize: '0.75rem', margin: '0.35rem 0',
          color: msg.ok ? '#10b981' : '#ef4444',
        }}>
          {msg.text}
        </div>
      )}

      <button
        className="operator-save"
        onClick={handleSave}
        disabled={saving}
        style={{ marginTop: '0.75rem', width: '100%' }}
      >
        {saving ? 'Saving…' : 'Save Settings'}
      </button>
    </div>
  );
}
