'use client';

import { useCallback, useEffect, useState } from 'react';
import MiniSparkline from './MiniSparkline';
import SourceAvatar from './SourceAvatar';
import {
  appendBankrollPoint,
  getBankrollHistory,
  clearBankrollHistory,
  bankrollSpanLabel,
  type BankrollPoint,
} from '@/lib/copy/bankrollHistory';

// ─── Types ────────────────────────────────────────────────────────────────────

type CardState = {
  balance: number;
  pnl: number;
  default_amount: number;
  // ── Extended combined accounting (from extended GET) ──
  starting_balance?:      number;
  copy_open_exposure?:    number;
  copy_open_positions?:   number;
  copy_realized_pnl?:     number;
  btc_open_exposure?:     number;
  btc_open_positions?:    number;
  btc_realized_pnl?:      number;
  btc_total_trades?:      number;
  total_open_exposure?:   number;
  combined_realized_pnl?: number;
  account_equity?:        number;
  available_balance?:     number;
  active_copy_bots?:      number;
  active_crypto_bots?:    number;
};

type ExposureMetrics = {
  count: number;
  exposure: number;
  avg: number;
  cap: number;          // 0 = unlimited
  remaining: number | null; // null when unlimited
};

const FALLBACK_DEFAULT = 1000;

// ─── Formatters ───────────────────────────────────────────────────────────────

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const fmt = (v: number) => usd.format(v);

// ─── Component ────────────────────────────────────────────────────────────────

export default function CopyPaperBankrollCard() {
  const [state, setState] = useState<CardState | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  // Sparkline — client-only, read from localStorage after mount
  const [sparkPoints, setSparkPoints] = useState<BankrollPoint[]>([]);
  // Open exposure for PAPER bots — fetched from /api/copy/exposure.
  // Starts as null (loading); always becomes an object after first fetch attempt.
  const [paperExposure, setPaperExposure] = useState<ExposureMetrics | null>(null);
  const [exposureLoading, setExposureLoading] = useState(true);
  // Count of enabled bots in PAPER mode — from /api/copy/summary (same poll).
  const [paperBotsEnabled, setPaperBotsEnabled] = useState<number | null>(null);
  // Count of enabled copy-trader bots (all modes) — activeBotCount from summary
  const [activeTradingBots, setActiveTradingBots] = useState<number | null>(null);
  // Count of enabled crypto strategy bots — activeCryptoBotCount from summary
  const [activeCryptoBots, setActiveCryptoBots] = useState<number | null>(null);
  // Trade counts today — from /api/copy/summary
  const [copyTradesToday, setCopyTradesToday]   = useState<number | null>(null);
  const [cryptoTradesToday, setCryptoTradesToday] = useState<number | null>(null);

  // Input for new default amount
  const [inputValue, setInputValue] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);

  // Inline paper-cap editor
  const [capInput, setCapInput] = useState('0');
  const [savingCap, setSavingCap] = useState(false);

  // Action feedback
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [freshStartConfirm, setFreshStartConfirm] = useState(false);
  const [freshStarting, setFreshStarting] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Exposure + combined accounting refresh.
  // Fetches /api/copy/paper-bankroll (extended GET) for BTC + combined data,
  // and /api/copy/summary for exposure cap, bot counts, and trade counts.
  // Poll interval: 5 seconds so BTC trade settlements appear quickly.
  const loadExposure = useCallback(async () => {
    try {
      const [bankrollRes, summaryRes] = await Promise.all([
        fetch('/api/copy/paper-bankroll', { cache: 'no-store' }),
        fetch('/api/copy/summary', { cache: 'no-store' }),
      ]);

      // Update combined accounting from extended bankroll GET
      if (bankrollRes.ok) {
        const b = await bankrollRes.json();
        if (b.ok) {
          setState((prev) => prev ? {
            ...prev,
            starting_balance:      b.starting_balance,
            copy_open_exposure:    b.copy_open_exposure,
            copy_open_positions:   b.copy_open_positions,
            copy_realized_pnl:     b.copy_realized_pnl,
            btc_open_exposure:     b.btc_open_exposure,
            btc_open_positions:    b.btc_open_positions,
            btc_realized_pnl:      b.btc_realized_pnl,
            btc_total_trades:      b.btc_total_trades,
            total_open_exposure:   b.total_open_exposure,
            combined_realized_pnl: b.combined_realized_pnl,
            account_equity:        b.account_equity,
            available_balance:     b.available_balance,
            active_copy_bots:      b.active_copy_bots,
            active_crypto_bots:    b.active_crypto_bots,
          } : prev);
        }
      }

      // Update exposure cap + bot counts from summary
      if (summaryRes.ok) {
        const p = await summaryRes.json();
        if (p.ok) {
          // Use summary's paper exposure for the cap/remaining display (uses RPC aggregate)
          const count    = Number(p.paperPositionCount ?? 0);
          const exposure = Number(p.paperExposure      ?? 0);
          const avg      = Number(p.paperAvgSize        ?? 0);
          setPaperExposure((prev) => {
            const cap = prev?.cap ?? 0;
            const remaining = cap > 0 ? Math.max(0, cap - exposure) : null;
            return { count, exposure, avg, cap, remaining };
          });
          setPaperBotsEnabled(Number(p.paperBotsEnabled      ?? 0));
          setActiveTradingBots(Number(p.activeBotCount        ?? 0));
          setActiveCryptoBots(Number(p.activeCryptoBotCount   ?? 0));
          setCopyTradesToday(Number(p.copyTradesToday          ?? 0));
          setCryptoTradesToday(Number(p.cryptoTradesToday      ?? 0));
        }
      }
    } catch { /* network error — leave previous state as-is */ }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const [bankrollRes, exposureRes] = await Promise.all([
        fetch('/api/copy/paper-bankroll', { cache: 'no-store' }),
        fetch('/api/copy/exposure', { cache: 'no-store' }),
      ]);

      const payload = await bankrollRes.json();
      if (payload.ok) {
        setState(payload);
        setInputValue(String(payload.default_amount));
        if (typeof payload.balance === 'number') {
          appendBankrollPoint('paper', payload.balance);
          setSparkPoints(getBankrollHistory('paper'));
        }
      } else {
        setFetchError(payload.error ?? 'Failed to load paper bankroll');
      }

      const zeroExposure: ExposureMetrics = { count: 0, exposure: 0, avg: 0, cap: 0, remaining: null };
      if (exposureRes.ok) {
        const expPayload = await exposureRes.json();
        if (expPayload.ok) {
          const paper = expPayload.paper as ExposureMetrics;
          setPaperExposure(paper);
          // Seed capInput once from the initial load so the input reflects the
          // DB-stored cap on first render. Subsequent changes come only from
          // explicit save responses, not from background refreshes.
          setCapInput(String(paper.cap));
        } else {
          setPaperExposure(zeroExposure);
        }
      } else {
        setPaperExposure(zeroExposure);
      }
      setExposureLoading(false);
    } catch {
      setFetchError('Network error');
      setPaperExposure({ count: 0, exposure: 0, avg: 0, cap: 0, remaining: null });
      setExposureLoading(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Also kick off loadExposure immediately so bot counts (paperBotsEnabled)
    // and exposure metrics from the summary endpoint are available right away,
    // without waiting for the first 15-second poll tick.
    void loadExposure();
  }, [load, loadExposure]);

  // Keep exposure + BTC accounting fresh every 5 seconds.
  // Visibility wake-up ensures stale data doesn't linger after tab switch.
  useEffect(() => {
    const interval = setInterval(() => { void loadExposure(); }, 5_000);
    const onVisible = () => { if (!document.hidden) void loadExposure(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loadExposure]);

  const showFeedback = (text: string, type: 'success' | 'error') => {
    setFeedback({ text, type });
    setTimeout(() => setFeedback(null), 3500);
  };

  const handleSaveDefault = async () => {
    setInputError(null);
    const parsed = parseFloat(inputValue.replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setInputError('Enter a valid positive amount');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/copy/paper-bankroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_default', amount: parsed }),
        cache: 'no-store',
      });
      const payload = await res.json();
      if (payload.ok) {
        setState((prev) => prev ? { ...prev, default_amount: payload.default_amount } : prev);
        setInputValue(String(payload.default_amount));
        showFeedback(`Default saved: ${fmt(payload.default_amount)}`, 'success');
      } else {
        showFeedback(payload.error ?? 'Save failed', 'error');
      }
    } catch {
      showFeedback('Network error saving default', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setResetting(true);
    try {
      const res = await fetch('/api/copy/paper-bankroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset' }),
        cache: 'no-store',
      });
      const payload = await res.json();
      if (payload.ok) {
        setState((prev) =>
          prev ? { ...prev, balance: payload.balance, pnl: 0 } : prev
        );
        // Clear history so sparkline starts fresh from the new baseline
        clearBankrollHistory('paper');
        appendBankrollPoint('paper', payload.balance);
        setSparkPoints(getBankrollHistory('paper'));
        showFeedback(`Paper bankroll reset to ${fmt(payload.balance)}`, 'success');
      } else {
        showFeedback(payload.error ?? 'Reset failed', 'error');
      }
    } catch {
      showFeedback('Network error resetting bankroll', 'error');
    } finally {
      setResetting(false);
    }
  };

  const handleSavePaperCap = async () => {
    const parsed = Number(capInput);
    if (!Number.isFinite(parsed) || parsed < 0) {
      showFeedback('Enter a valid amount (0 = unlimited)', 'error');
      return;
    }
    setSavingCap(true);
    try {
      const res = await fetch('/api/copy/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paper_max_exposure_usd: parsed }),
        cache: 'no-store',
      });
      const payload = await res.json();
      if (payload.ok) {
        // Use the server-confirmed value straight from the PATCH response.
        // Do NOT rely on loadExposure() for the cap: the exposure API treats
        // settings-fetch errors as non-fatal and may return cap:0 even after a
        // successful save, causing the input and display to snap back to 0.
        const savedCap: number =
          (payload.settings as { paper_max_exposure_usd?: number } | null)
            ?.paper_max_exposure_usd ?? parsed;
        setCapInput(String(savedCap));
        setPaperExposure((prev) => {
          if (!prev) return prev;
          const remaining = savedCap > 0 ? Math.max(0, savedCap - prev.exposure) : null;
          return { ...prev, cap: savedCap, remaining };
        });
        showFeedback(
          `Paper max exposure set to ${savedCap > 0 ? fmt(savedCap) : 'Unlimited'}`,
          'success'
        );
      } else {
        showFeedback(payload.error ?? 'Save failed', 'error');
      }
    } catch {
      showFeedback('Network error saving cap', 'error');
    } finally {
      setSavingCap(false);
    }
  };

  const handleFreshStart = async () => {
    setFreshStarting(true);
    setFreshStartConfirm(false);
    try {
      const res = await fetch('/api/copy/paper-bankroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'fresh_start' }),
        cache: 'no-store',
      });
      const payload = await res.json();
      if (payload.ok) {
        const newBalance = payload.balance as number;
        const newCap = payload.default_amount as number;
        const archived = payload.positions_archived as number;

        // 1. Update balance / PnL in-place — no loading flash
        setState((prev) => prev ? { ...prev, balance: newBalance, pnl: 0 } : prev);

        // 2. Apply the API-confirmed post-reset state directly.
        //    The server returned positions_archived = N, meaning those rows are
        //    committed as CANCELLED.  Open exposure is therefore 0 by definition.
        //
        //    We deliberately do NOT call loadExposure() here.  A fresh
        //    /api/copy/exposure call immediately after the archive races against:
        //      a) the worker re-opening paper positions in the same window
        //      b) any transient lag between the archive UPDATE and the RPC read
        //    Either race can return a non-zero count and overwrite the zeros,
        //    which is exactly the "old values survive restart" bug.
        //
        //    The 15-second periodic poll (shared with CopyOverviewCards) will
        //    reconcile both components to DB truth in one cadence without racing.
        setCapInput(String(newCap));
        setPaperExposure({
          count: 0,
          exposure: 0,
          avg: 0,
          cap: newCap,
          remaining: newCap,
        });

        // 3. Reset sparkline to a fresh season baseline
        clearBankrollHistory('paper');
        appendBankrollPoint('paper', newBalance);
        setSparkPoints(getBankrollHistory('paper'));

        // 4. Signal peer components immediately — dispatch BEFORE feedback so the
        //    Overview and Positions table trigger their own re-fetch at the same
        //    moment the Paper card is already showing zeros.  Both components poll
        //    at 15 s and will sync to actual DB state on the next cycle.
        window.dispatchEvent(new CustomEvent('copy:paper-reset'));

        showFeedback(
          `Restarted! ${archived} position${archived !== 1 ? 's' : ''} archived. Balance reset to ${fmt(newBalance)}.`,
          'success'
        );
      } else {
        showFeedback(payload.error ?? 'Restart failed', 'error');
      }
    } catch {
      showFeedback('Network error during restart', 'error');
    } finally {
      setFreshStarting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="copy-paper-card copy-paper-card--loading">
        <div className="copy-paper-card-label">PAPER BANKROLL</div>
        <div className="copy-loading" style={{ padding: '1rem 0' }}>Loading…</div>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="copy-paper-card">
        <div className="copy-paper-card-label">PAPER BANKROLL</div>
        <p style={{ color: '#f87171', fontSize: '0.8rem', marginTop: '0.5rem' }}>{fetchError}</p>
      </div>
    );
  }

  const pnlColor = !state || state.pnl === 0
    ? 'rgba(248,250,252,0.45)'
    : state.pnl > 0 ? '#34d399' : '#f87171';

  return (
    <div className="copy-paper-card">
      {/* Header */}
      <div className="copy-paper-card-header">
        <div>
          <div className="copy-paper-card-label">PAPER BANKROLL</div>
          <div className="copy-paper-card-sublabel">Safe testing capital for trading and crypto bots</div>
        </div>
        <span className="copy-badge copy-badge-paper" style={{ alignSelf: 'flex-start' }}>PAPER</span>
      </div>

      {/* Starting Paper Bankroll */}
      <div style={{ fontSize: '0.65rem', color: 'rgba(248,250,252,0.35)', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '0.1rem' }}>
        Starting Paper Bankroll
      </div>
      <div className="copy-paper-balance">{fmt(state?.starting_balance ?? state?.default_amount ?? 0)}</div>

      {/* Current Paper Equity — prominent, updates as trades settle */}
      {state?.account_equity != null && (
        <div style={{ marginBottom: '0.6rem' }}>
          <div style={{ fontSize: '0.62rem', color: 'rgba(248,250,252,0.35)', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: '0.15rem' }}>
            Current Paper Equity
          </div>
          <div style={{
            fontSize: '1.6rem', fontWeight: 800, letterSpacing: '-0.01em', lineHeight: 1.1,
            color: state.account_equity >= (state.starting_balance ?? state.default_amount ?? 0)
              ? '#34d399' : '#f87171',
          }}>
            {fmt(state.account_equity)}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'rgba(248,250,252,0.45)', marginTop: '0.15rem' }}>
            {(state.combined_realized_pnl ?? 0) >= 0 ? '+' : ''}
            {fmt(state.combined_realized_pnl ?? 0)} combined realized P/L
          </div>
        </div>
      )}

      {/* Trend sparkline — powered by localStorage ring buffer */}
      <div className="copy-paper-sparkline-row">
        <MiniSparkline
          points={sparkPoints}
          id="paper-bankroll"
          width={120}
          height={30}
          label={bankrollSpanLabel(sparkPoints) || undefined}
        />
      </div>

      {/* ── Paper Open Exposure ─────────────────────────────────────────────────
           Source: /api/copy/exposure → copy_open_exposure_by_mode() RPC, PAPER row.
           Identical source + scope to CopyOverviewCards "Paper Open Exposure" card.
           count, exposure, avg, cap, remaining all come from this single endpoint.
           Polls every 15 s (matching Overview cadence) + refreshes on tab focus and
           on copy:paper-reset events to stay in sync after a Restart Paper.      ── */}
      <div style={{
        marginBottom: '0.85rem',
        padding: '0.75rem 1rem',
        background: 'rgba(248,250,252,0.03)',
        border: '1px solid rgba(248,250,252,0.08)',
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
            background: 'rgba(16,185,129,0.12)', color: '#34d399',
            border: '1px solid rgba(16,185,129,0.22)', borderRadius: '0.3rem',
          }}>
            PAPER · OPEN
          </span>
        </div>

        {/* Exposure amount */}
        <div style={{ fontSize: '1.35rem', fontWeight: 700, letterSpacing: '-0.01em', color: '#f8fafc', lineHeight: 1.1, marginBottom: '0.35rem' }}>
          {exposureLoading ? '—' : fmt(paperExposure?.exposure ?? 0)}
        </div>

        {/* Count + avg */}
        <div style={{ fontSize: '0.72rem', color: 'rgba(248,250,252,0.45)', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          {exposureLoading ? (
            <span>Loading…</span>
          ) : (
            <>
              <span>{paperExposure?.count ?? 0} open position{(paperExposure?.count ?? 0) !== 1 ? 's' : ''}</span>
              {(paperExposure?.count ?? 0) > 0 && (
                <span>Avg {fmt(paperExposure?.avg ?? 0)}</span>
              )}
            </>
          )}
        </div>

        {/* ── Structured accounting breakdown ─────────────────────────────────── */}
        <div style={{
          marginTop: '0.55rem', paddingTop: '0.45rem',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          fontSize: '0.71rem', display: 'flex', flexDirection: 'column', gap: '0',
        }}>
          {/* COPY TRADING section */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.4rem',
            marginBottom: '0.2rem', marginTop: '0.05rem',
          }}>
            <SourceAvatar sourceType="COPY_TRADER" size={20} style={{ flexShrink: 0 }} />
            <span style={{ fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'rgba(248,250,252,0.28)' }}>COPY TRADING</span>
          </div>
          {[
            ['Active Trading Bots', state?.active_copy_bots ?? activeTradingBots, (state?.active_copy_bots ?? activeTradingBots ?? 0) > 0 ? '#34d399' : undefined],
            ['Open Positions',      state?.copy_open_positions, undefined],
            ['Open Exposure',       state?.copy_open_exposure != null ? fmt(state.copy_open_exposure) : (exposureLoading ? '—' : fmt(paperExposure?.exposure ?? 0)), undefined],
            ['Realized P/L',       state?.copy_realized_pnl != null ? ((state.copy_realized_pnl >= 0 ? '+' : '') + fmt(state.copy_realized_pnl)) : '—',
              state?.copy_realized_pnl != null && state.copy_realized_pnl !== 0 ? (state.copy_realized_pnl > 0 ? '#34d399' : '#f87171') : undefined],
          ].map(([label, val, color]) => (
            <div key={String(label)} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.1rem 0', alignItems: 'center' }}>
              <span style={{ color: 'rgba(248,250,252,0.35)' }}>{label}</span>
              <span style={{ fontWeight: 600, color: (color as string | undefined) ?? 'rgba(248,250,252,0.7)', fontVariantNumeric: 'tabular-nums' }}>
                {val != null ? String(val) : '—'}
              </span>
            </div>
          ))}

          {/* BTC 5-MIN section */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.4rem',
            marginBottom: '0.2rem', marginTop: '0.5rem',
          }}>
            <SourceAvatar sourceType="BTC_CRYPTO" size={20} style={{ flexShrink: 0 }} />
            <span style={{ fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'rgba(248,250,252,0.28)' }}>BTC 5-MIN</span>
          </div>
          {[
            ['Active Crypto Bots', state?.active_crypto_bots ?? activeCryptoBots, (state?.active_crypto_bots ?? activeCryptoBots ?? 0) > 0 ? '#60a5fa' : undefined],
            ['Total Trades',       state?.btc_total_trades, undefined],
            ['Open Positions',     state?.btc_open_positions, undefined],
            ['Open Exposure',      state?.btc_open_exposure != null ? fmt(state.btc_open_exposure) : '—', undefined],
            ['Realized P/L',      state?.btc_realized_pnl != null ? ((state.btc_realized_pnl >= 0 ? '+' : '') + fmt(state.btc_realized_pnl)) : '—',
              state?.btc_realized_pnl != null && state.btc_realized_pnl !== 0 ? (state.btc_realized_pnl > 0 ? '#34d399' : '#f87171') : undefined],
          ].map(([label, val, color]) => (
            <div key={String(label) + '-btc'} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.1rem 0', alignItems: 'center' }}>
              <span style={{ color: 'rgba(248,250,252,0.35)' }}>{label}</span>
              <span style={{ fontWeight: 600, color: (color as string | undefined) ?? 'rgba(248,250,252,0.7)', fontVariantNumeric: 'tabular-nums' }}>
                {val != null ? String(val) : '—'}
              </span>
            </div>
          ))}

          {/* TOTAL PAPER ACCOUNT section */}
          <div style={{
            fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase',
            color: 'rgba(248,250,252,0.28)', marginBottom: '0.2rem', marginTop: '0.5rem',
          }}>TOTAL PAPER ACCOUNT</div>
          {[
            ['Total Open Exposure',     state?.total_open_exposure != null   ? fmt(state.total_open_exposure)   : '—', undefined],
            ['Combined Realized P/L',  state?.combined_realized_pnl != null ? ((state.combined_realized_pnl >= 0 ? '+' : '') + fmt(state.combined_realized_pnl)) : '—',
              state?.combined_realized_pnl != null && state.combined_realized_pnl !== 0 ? (state.combined_realized_pnl > 0 ? '#34d399' : '#f87171') : undefined],
            ['Available Balance',       state?.available_balance    != null   ? fmt(state.available_balance)    : '—', undefined],
            ['Account Equity',          state?.account_equity       != null   ? fmt(state.account_equity)       : '—',
              state?.account_equity != null && state.account_equity !== (state.starting_balance ?? state.default_amount) ? (state.account_equity > (state.starting_balance ?? state.default_amount ?? 0) ? '#34d399' : '#f87171') : undefined],
          ].map(([label, val, color]) => (
            <div key={String(label) + '-tot'} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.12rem 0', alignItems: 'center', borderTop: label === 'Account Equity' ? '1px solid rgba(255,255,255,0.07)' : 'none', marginTop: label === 'Account Equity' ? '0.2rem' : 0 }}>
              <span style={{ color: 'rgba(248,250,252,0.4)', fontWeight: label === 'Account Equity' ? 600 : 400 }}>{label}</span>
              <span style={{ fontWeight: 700, color: (color as string | undefined) ?? 'rgba(248,250,252,0.8)', fontVariantNumeric: 'tabular-nums' }}>
                {String(val)}
              </span>
            </div>
          ))}
        </div>

        {/* Cap + remaining rows */}
        {!exposureLoading && (() => {
          const cap       = paperExposure?.cap ?? 0;
          const remaining = paperExposure?.remaining ?? null;
          const exposure  = paperExposure?.exposure ?? 0;
          const pct       = cap > 0 ? Math.min(100, (exposure / cap) * 100) : 0;
          const remColor  = remaining === null
            ? 'rgba(248,250,252,0.55)'
            : remaining <= 0 ? '#f87171' : remaining < cap * 0.2 ? '#fbbf24' : '#34d399';

          return (
            <div style={{ marginTop: '0.55rem', paddingTop: '0.45rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              {/* Max Exposure — READ-ONLY display of the DB-confirmed cap.
                  The edit control is separate below; this row always reflects
                  the last value returned by /api/copy/exposure, never the
                  unsaved input the operator may be typing. */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.72rem', marginBottom: '0.2rem' }}>
                <span style={{ color: 'rgba(248,250,252,0.35)' }}>Max Exposure</span>
                <span style={{
                  fontWeight: 700,
                  color: cap > 0 ? '#f8fafc' : 'rgba(248,250,252,0.38)',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {cap > 0 ? fmt(cap) : 'Unlimited'}
                </span>
              </div>

              {/* Remaining row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.72rem', marginBottom: cap > 0 ? '0.1rem' : 0 }}>
                <span style={{ color: 'rgba(248,250,252,0.35)' }}>Remaining</span>
                <span style={{ fontWeight: 700, color: remColor, fontVariantNumeric: 'tabular-nums' }}>
                  {remaining === null ? 'Unlimited' : fmt(remaining)}
                </span>
              </div>

              {/* Utilisation bar — only shown when a cap is set */}
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

              {/* Change-cap edit control — clearly separated from the display rows.
                  capInput holds the operator's pending value; the display above
                  always reads from paperExposure.cap (DB-confirmed), so typing
                  here does not corrupt the displayed cap until Save is clicked. */}
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
                  title="Paper max exposure (0 = unlimited)"
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
                  onClick={handleSavePaperCap}
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

      {/* P&L row — combined copy + BTC */}
      <div className="copy-paper-pnl-row">
        <span className="copy-paper-pnl-label">Combined All-time P/L</span>
        <span className="copy-paper-pnl-value" style={{
          color: (state?.combined_realized_pnl ?? state?.pnl ?? 0) === 0
            ? 'rgba(248,250,252,0.45)'
            : (state?.combined_realized_pnl ?? state?.pnl ?? 0) > 0 ? '#34d399' : '#f87171',
        }}>
          {(() => {
            const v = state?.combined_realized_pnl ?? state?.pnl ?? 0;
            return v !== 0 ? (v > 0 ? '+' : '') + fmt(v) : '—';
          })()}
        </span>
      </div>

      {/* Divider */}
      <div className="copy-paper-divider" />

      {/* Saved default display */}
      <div className="copy-paper-default-row">
        <span className="copy-paper-default-label">Saved Default</span>
        <span className="copy-paper-default-value">{fmt(state?.default_amount ?? 0)}</span>
      </div>

      {/* Set default input */}
      <div className="copy-paper-set-default">
        <label className="copy-paper-input-label">Set new default amount</label>
        <div className="copy-paper-input-row">
          <div className="copy-paper-input-wrap">
            <span className="copy-paper-input-prefix">$</span>
            <input
              className="copy-paper-input"
              type="number"
              min="1"
              step="any"
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                setInputError(null);
              }}
              placeholder="e.g. 1000"
            />
          </div>
          <button
            className="copy-btn copy-btn-sm copy-btn-secondary"
            onClick={handleSaveDefault}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save Default'}
          </button>
        </div>
        {inputError && <span className="copy-paper-hint-error">{inputError}</span>}
        <span className="copy-paper-hint">
          Reset to Default will restore the paper balance to this amount and zero the P/L.
        </span>
      </div>

      {/* Reset button */}
      <button
        className="copy-paper-reset-btn"
        onClick={handleReset}
        disabled={resetting}
      >
        {resetting
          ? 'Resetting…'
          : `Reset to Default (${fmt(state?.default_amount ?? 0)})`}
      </button>

      {/* ── Restart Paper ────────────────────────────────────────────────────── */}
      <div style={{
        marginTop: '0.6rem',
        paddingTop: '0.75rem',
        borderTop: '1px solid rgba(255,255,255,0.06)',
      }}>
        {/* Section label */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
          <span style={{
            fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.1em',
            textTransform: 'uppercase', color: 'rgba(248,250,252,0.3)',
          }}>
            Restart Paper
          </span>
          <span style={{
            fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.05em',
            textTransform: 'uppercase', padding: '0.1em 0.45em',
            background: 'rgba(248,113,113,0.1)', color: '#f87171',
            border: '1px solid rgba(248,113,113,0.2)', borderRadius: '0.3rem',
          }}>
            New Season
          </span>
        </div>

        <p style={{
          fontSize: '0.69rem', color: 'rgba(248,250,252,0.28)',
          lineHeight: 1.45, marginBottom: '0.55rem',
        }}>
          Archives all open paper positions, resets balance to the saved default, clears P/L,
          and sets Paper Max Exposure to match. Bots, wallets, and settings are preserved.
        </p>

        {!freshStartConfirm ? (
          <button
            className="copy-paper-fresh-start-btn"
            onClick={() => setFreshStartConfirm(true)}
            disabled={freshStarting}
          >
            {freshStarting ? 'Restarting…' : 'Restart Paper — New Season'}
          </button>
        ) : (
          <div className="copy-paper-fresh-start-confirm">
            <p>
              This will archive{' '}
              <strong>
                {paperExposure?.count ?? 0} open paper position
                {(paperExposure?.count ?? 0) !== 1 ? 's' : ''}
              </strong>{' '}
              and reset the balance to{' '}
              <strong>{fmt(state?.default_amount ?? FALLBACK_DEFAULT)}</strong>.
              {' '}Paper Max Exposure will also be set to{' '}
              <strong>{fmt(state?.default_amount ?? FALLBACK_DEFAULT)}</strong>.
              This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                className="copy-paper-fresh-start-confirm-btn"
                onClick={handleFreshStart}
                disabled={freshStarting}
              >
                {freshStarting ? 'Working…' : 'Yes, Restart Paper'}
              </button>
              <button
                className="copy-paper-fresh-start-cancel-btn"
                onClick={() => setFreshStartConfirm(false)}
                disabled={freshStarting}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Feedback */}
      {feedback && (
        <p className={`copy-paper-feedback ${feedback.type}`}>{feedback.text}</p>
      )}
    </div>
  );
}
