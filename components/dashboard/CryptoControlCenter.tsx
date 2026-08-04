'use client';

// CryptoControlCenter — Sticky top-of-page control bar for all crypto strategy bots.
//
// Appears above the KPI strip and bankroll cards. Sticks below the dashboard header
// while scrolling through bot cards below.
//
// Controls:
//   [PAPER | LIVE*] [BTC ON/OFF] [ETH ON/OFF] [SOL ON/OFF] [XRP ON/OFF]
//   [Pause All] [Reset Paper]   Active: N · Exposure: $0.40 · Balance: $999.60
//
// (* LIVE mode is disabled — no global-mode endpoint exists yet)
//
// Endpoints used (same as individual bot cards):
//   GET  /api/crypto/bots         → fetch all 4 bot states + stats (5s poll)
//   POST /api/btc-5m-late         → toggle BTC 5-Min (is_enabled)
//   POST /api/crypto-5m           → toggle ETH/SOL/XRP (bot_id + is_enabled)
//   POST /api/crypto/reset-paper  → reset shared PAPER account
//
// Synchronization:
//   Dispatches 'crypto:bot-state-changed' after any toggle → bot cards re-fetch.
//   Listens to 'crypto:bot-state-changed' + 'crypto:paper-reset' → re-fetches here.
//
// No FastLoop access. No wallet signing. No LIVE order submission.

import { useCallback, useEffect, useRef, useState } from 'react';
import CryptoMarketCountdown from './CryptoMarketCountdown';

// ── Constants ─────────────────────────────────────────────────────────────────

const CRYPTO_BOTS = [
  { id: 'btc_5m_late',  label: 'BTC', color: '#f97316', isBtc: true  },
  { id: 'eth_5m_paper', label: 'ETH', color: '#818cf8', isBtc: false },
  { id: 'sol_5m_paper', label: 'SOL', color: '#a78bfa', isBtc: false },
  { id: 'xrp_5m_paper', label: 'XRP', color: '#38bdf8', isBtc: false },
] as const;

type BotId   = (typeof CRYPTO_BOTS)[number]['id'];
type BotMeta = (typeof CRYPTO_BOTS)[number];

const CONFIRM_PHRASE = 'RESET PAPER';

// ── Types ─────────────────────────────────────────────────────────────────────

interface BotStat {
  bot_id:             string;
  is_enabled:         boolean;
  open_exposure:      number;
  account_equity:     number;
  starting_balance:   number;
  strategy_settings?: Record<string, unknown>;
  stats: {
    open_trades:   number;
    total_trades:  number;
    all_time_pnl:  number;
    today_pnl:     number;
  };
}

interface BotsApiResponse {
  ok:    boolean;
  bots?: BotStat[];
}

interface ExecModeResponse {
  ok:                    boolean;
  mode?:                 'PAPER' | 'LIVE';
  live_ready?:           boolean;
  live_not_ready_reason?: string | null;
  error?:                string;
  blocking_reason?:      string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtUsd(v: number, digits = 2) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: digits,
  }).format(v);
}

function dispatchBotChange() {
  window.dispatchEvent(new CustomEvent('crypto:bot-state-changed'));
}

const MARKET_DURATION  = 300;
const STALE_SEC        = 20;
const OLD_GRACE_SEC    = 10;

function getEndTs(ss: Record<string, unknown>): number | null {
  if (typeof ss.market_end === 'number' && ss.market_end > 1_000_000_000) return ss.market_end;
  const slug = typeof ss.market_slug === 'string' ? ss.market_slug : null;
  if (!slug) return null;
  const parts = slug.split('-');
  const startTs = parseInt(parts[parts.length - 1], 10);
  if (!Number.isFinite(startTs) || startTs < 1_000_000_000) return null;
  return startTs + MARKET_DURATION;
}

function fmtMmSs(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Single-bot mini countdown (self-contained interval). */
function MiniBotCountdown({ ss, color, label }: {
  ss: Record<string, unknown> | undefined;
  color: string;
  label: string;
}) {
  const [secsLeft, setSecsLeft] = useState<number | null>(null);
  const endTsRef = useRef<number | null>(null);

  useEffect(() => {
    if (!ss) { endTsRef.current = null; return; }
    endTsRef.current = getEndTs(ss);
  }, [ss]);

  useEffect(() => {
    const tick = () => {
      const endTs = endTsRef.current;
      if (endTs != null) setSecsLeft(Math.max(0, endTs - Date.now() / 1000));
      else setSecsLeft(null);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const updatedAt = ss && typeof ss.updated_at === 'string' ? ss.updated_at : null;
  const stale     = updatedAt ? (Date.now() - new Date(updatedAt).getTime()) / 1000 > STALE_SEC : false;
  const mktSlug   = ss && typeof ss.market_slug === 'string' ? ss.market_slug : null;
  const slugTs    = mktSlug ? parseInt(mktSlug.split('-').pop() ?? '', 10) : null;
  const bucket    = Math.floor(Date.now() / 1000 / MARKET_DURATION) * MARKET_DURATION;
  const oldMarket = !!(slugTs && slugTs < bucket && (Date.now() / 1000 - bucket) > OLD_GRACE_SEC);

  const txtColor = stale     ? '#f87171'
                 : oldMarket ? '#fbbf24'
                 : secsLeft === 0 ? '#818cf8'
                 : secsLeft == null ? 'rgba(248,250,252,0.2)'
                 : color;

  const display = secsLeft != null ? fmtMmSs(secsLeft) : '—:—';
  const alert   = stale ? '⚠' : oldMarket ? '⏳' : '';

  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flexShrink: 0 }}>
      <span style={{ fontSize: '0.6rem', fontWeight: 700, color: 'rgba(248,250,252,0.4)' }}>
        {label}
      </span>
      <span style={{ fontFamily: 'monospace', fontSize: '0.72rem', fontWeight: 800, color: txtColor, minWidth: '3rem', textAlign: 'right' }}>
        {display}
      </span>
      {alert && <span style={{ fontSize: '0.6rem' }}>{alert}</span>}
    </span>
  );
}

/** Compact sync bar — shows all 4 mini countdowns + a sync status badge. */
function MarketSyncBar({ bots }: { bots: BotStat[] }) {
  // Derive sync status: all bots on same expected bucket?
  const [syncStatus, setSyncStatus] = useState<'synced' | 'issue' | 'unknown'>('unknown');

  useEffect(() => {
    const check = () => {
      const nowSec = Date.now() / 1000;
      const bucket = Math.floor(nowSec / MARKET_DURATION) * MARKET_DURATION;
      const secsPast = nowSec - bucket;
      const statuses = CRYPTO_BOTS.map((meta) => {
        const bot = bots.find((b) => b.bot_id === meta.id);
        const ss  = bot?.strategy_settings ?? {};
        const slug = typeof ss.market_slug === 'string' ? ss.market_slug : null;
        const slugTs = slug ? parseInt(slug.split('-').pop() ?? '', 10) : null;
        const updatedAt = typeof ss.updated_at === 'string' ? ss.updated_at : null;
        const stale = updatedAt ? (Date.now() - new Date(updatedAt).getTime()) / 1000 > STALE_SEC : true;
        const old   = !!(slugTs && slugTs < bucket && secsPast > OLD_GRACE_SEC);
        return { stale, old, slugTs };
      });
      const anyIssue = statuses.some((s) => s.stale || s.old);
      const slugTsValues = statuses.map((s) => s.slugTs).filter(Boolean);
      const allSame = slugTsValues.length === 4 && new Set(slugTsValues).size === 1;
      setSyncStatus(anyIssue ? 'issue' : allSame ? 'synced' : 'unknown');
    };
    check();
    const id = setInterval(check, 5000);
    return () => clearInterval(id);
  }, [bots]);

  if (bots.length === 0) return null;

  return (
    <div style={{
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      gap: '0.65rem',
      flexWrap: 'wrap',
      paddingTop: '0.3rem',
      borderTop: '1px solid rgba(255,255,255,0.06)',
      fontSize: '0.65rem',
    }}>
      <span style={{ color: 'rgba(248,250,252,0.3)', fontWeight: 700, letterSpacing: '0.06em', fontSize: '0.6rem', flexShrink: 0 }}>
        MARKETS
      </span>

      {CRYPTO_BOTS.map((meta) => {
        const bot = bots.find((b) => b.bot_id === meta.id);
        return (
          <MiniBotCountdown
            key={meta.id}
            ss={bot?.strategy_settings}
            color={meta.color}
            label={meta.label}
          />
        );
      })}

      {/* Sync badge */}
      <span style={{
        marginLeft: 'auto',
        padding: '0.12rem 0.45rem',
        borderRadius: '0.3rem',
        fontSize: '0.58rem',
        fontWeight: 700,
        letterSpacing: '0.06em',
        background:    syncStatus === 'synced' ? 'rgba(52,211,153,0.08)' : syncStatus === 'issue' ? 'rgba(248,113,113,0.08)' : 'rgba(255,255,255,0.04)',
        border:        `1px solid ${syncStatus === 'synced' ? 'rgba(52,211,153,0.25)' : syncStatus === 'issue' ? 'rgba(248,113,113,0.25)' : 'rgba(255,255,255,0.08)'}`,
        color:         syncStatus === 'synced' ? '#34d399' : syncStatus === 'issue' ? '#f87171' : 'rgba(248,250,252,0.3)',
        flexShrink: 0,
      }}>
        {syncStatus === 'synced' ? 'ALL MARKETS SYNCED' : syncStatus === 'issue' ? 'MARKET SYNC ISSUE' : 'CHECKING…'}
      </span>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function CryptoControlCenter() {
  // ── Bot state ──────────────────────────────────────────────────────────────
  const [bots,       setBots]      = useState<BotStat[]>([]);
  const [loading,    setLoading]   = useState(true);

  // ── Execution mode state ───────────────────────────────────────────────────
  const [execMode,          setExecMode]          = useState<'PAPER' | 'LIVE'>('PAPER');
  const [liveReady,         setLiveReady]         = useState(false);
  const [liveNotReadyReason,setLiveNotReadyReason]= useState<string | null>(null);
  const [switching,         setSwitching]         = useState(false);
  const [switchError,       setSwitchError]       = useState<string | null>(null);
  const [showGoLiveModal,   setShowGoLiveModal]   = useState(false);
  const [paperSwitchMsg,    setPaperSwitchMsg]    = useState<string | null>(null);

  // ── Toggle state (per-bot) ─────────────────────────────────────────────────
  const [toggling,   setToggling]  = useState<Set<BotId>>(new Set());
  const [toggleErr,  setToggleErr] = useState<Partial<Record<BotId, string>>>({});

  // ── Pause All state ────────────────────────────────────────────────────────
  const [pausing,    setPausing]   = useState(false);
  const [pauseMsg,   setPauseMsg]  = useState<{ ok: boolean; text: string } | null>(null);

  // ── Reset modal state ──────────────────────────────────────────────────────
  const [showReset,     setShowReset]     = useState(false);
  const [resetText,     setResetText]     = useState('');
  const [resetAmountStr,setResetAmountStr]= useState('1000');
  const [resetting,     setResetting]     = useState(false);
  const [resetMsg,      setResetMsg]      = useState<{ ok: boolean; text: string } | null>(null);
  const resetInputRef                     = useRef<HTMLInputElement>(null);

  const resetAmountNum   = parseFloat(resetAmountStr);
  const resetAmountValid = Number.isFinite(resetAmountNum) && resetAmountNum > 0 && resetAmountNum <= 1_000_000;
  const resetUnlocked    = resetText.trim() === CONFIRM_PHRASE && resetAmountValid;

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      const [botsRes, modeRes] = await Promise.all([
        fetch('/api/crypto/bots',            { cache: 'no-store' }),
        fetch('/api/crypto/execution-mode',  { cache: 'no-store' }),
      ]);
      const botsJson = await botsRes.json() as BotsApiResponse;
      if (botsJson.ok && botsJson.bots) setBots(botsJson.bots);

      const modeJson = await modeRes.json() as ExecModeResponse;
      if (modeJson.ok) {
        const newMode = modeJson.mode ?? 'PAPER';
        setExecMode(newMode);
        setLiveReady(modeJson.live_ready ?? false);
        setLiveNotReadyReason(modeJson.live_not_ready_reason ?? null);
        // If backend reports PAPER while we thought we were LIVE → safety revert
        if (newMode === 'PAPER' && execMode === 'LIVE') {
          setSwitchError('LIVE DISABLED — backend reverted to PAPER');
        }
      }
    } catch {}
    finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 5_000);
    const onBotChange  = () => load();
    const onPaperReset = () => load();
    window.addEventListener('crypto:bot-state-changed', onBotChange);
    window.addEventListener('crypto:paper-reset',       onPaperReset);
    return () => {
      clearInterval(interval);
      window.removeEventListener('crypto:bot-state-changed', onBotChange);
      window.removeEventListener('crypto:paper-reset',       onPaperReset);
    };
  }, [load]);

  // ── Computed summaries ─────────────────────────────────────────────────────
  const enabledCount   = bots.filter((b) => b.is_enabled).length;
  const totalExposure  = bots.reduce((s, b) => s + (b.open_exposure  ?? 0), 0);
  const openPositions  = bots.reduce((s, b) => s + (b.stats?.open_trades ?? 0), 0);
  // Use BTC equity as the primary shared balance (only BTC trades currently)
  const btcBot         = bots.find((b) => b.bot_id === 'btc_5m_late');
  const availBalance   = btcBot ? btcBot.account_equity - btcBot.open_exposure : null;

  // ── Execution mode switching ───────────────────────────────────────────────

  const handleSwitchToPaper = useCallback(async () => {
    if (switching) return;
    setSwitching(true);
    setSwitchError(null);
    setPaperSwitchMsg(null);
    try {
      const [modeRes] = await Promise.all([
        fetch('/api/crypto/execution-mode', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'PAPER' }), cache: 'no-store',
        }),
        // Also disarm the copy-trading LIVE master
        fetch('/api/bot-settings', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bot_id: 'live', is_enabled: false }), cache: 'no-store',
        }),
      ]);
      const modeJson = await modeRes.json() as ExecModeResponse;
      if (!modeJson.ok) {
        setSwitchError(modeJson.error ?? 'Failed to switch to PAPER');
        return;
      }
      setExecMode('PAPER');
      setPaperSwitchMsg('PAPER MODE ACTIVE — NO NEW LIVE ORDERS');
      setTimeout(() => setPaperSwitchMsg(null), 5000);
      await load();
      dispatchBotChange();
    } catch {
      setSwitchError('Network error switching to PAPER');
    } finally {
      setSwitching(false);
    }
  }, [switching, load]);

  const handleConfirmGoLive = useCallback(async () => {
    if (switching) return;
    setSwitching(true);
    setSwitchError(null);
    try {
      const modeRes = await fetch('/api/crypto/execution-mode', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'LIVE' }), cache: 'no-store',
      });
      const modeJson = await modeRes.json() as ExecModeResponse;
      if (!modeJson.ok) {
        const rawErr = modeJson.error ?? modeJson.blocking_reason ?? 'Switch to LIVE failed';
        const friendly = rawErr === 'emergency_stop_active'
          ? 'LIVE BLOCKED — Emergency stop is active'
          : rawErr.startsWith('invalid_trade_size')
          ? 'LIVE BLOCKED — One or more bots have an invalid trade size'
          : rawErr;
        setSwitchError(friendly);
        setShowGoLiveModal(false);
        return;
      }
      // Also arm the copy-trading LIVE master (non-critical, ignore errors)
      fetch('/api/bot-settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bot_id: 'live', is_enabled: true }), cache: 'no-store',
      }).catch(() => {});
      setExecMode('LIVE');
      setShowGoLiveModal(false);
      await load();
      dispatchBotChange();
    } catch {
      setSwitchError('Network error switching to LIVE');
      setShowGoLiveModal(false);
    } finally {
      setSwitching(false);
    }
  }, [switching, load]);

  const handleModeToggleClick = useCallback(() => {
    if (switching) return;
    setSwitchError(null);
    if (execMode === 'LIVE') {
      handleSwitchToPaper();
    } else {
      if (!liveReady) {
        const reason = liveNotReadyReason === 'emergency_stop_active'
          ? 'LIVE BLOCKED — Emergency stop is active'
          : liveNotReadyReason?.startsWith('invalid_trade_size')
          ? 'LIVE NOT READY — One or more bots have an invalid trade size'
          : 'LIVE NOT READY — CHECK WALLET AUTH';
        setSwitchError(reason);
        return;
      }
      setShowGoLiveModal(true);
    }
  }, [switching, execMode, liveReady, liveNotReadyReason, handleSwitchToPaper]);

  // ── Individual toggle ──────────────────────────────────────────────────────
  const handleToggle = useCallback(async (meta: BotMeta, enable: boolean) => {
    const botId = meta.id;
    setToggling((prev) => new Set([...prev, botId]));
    setToggleErr((prev) => ({ ...prev, [botId]: undefined }));

    try {
      let res: Response;
      if (meta.isBtc) {
        res = await fetch('/api/btc-5m-late', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_enabled: enable }),
          cache: 'no-store',
        });
      } else {
        res = await fetch('/api/crypto-5m', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bot_id: botId, is_enabled: enable }),
          cache: 'no-store',
        });
      }

      const json = await res.json() as { ok: boolean; error?: string };
      if (json.ok) {
        await load();
        dispatchBotChange(); // keep bot cards in sync
      } else {
        setToggleErr((prev) => ({ ...prev, [botId]: json.error ?? 'Toggle failed' }));
      }
    } catch {
      setToggleErr((prev) => ({ ...prev, [botId]: 'Network error' }));
    } finally {
      setToggling((prev) => { const s = new Set(prev); s.delete(botId); return s; });
    }
  }, [load]);

  // ── Pause All ──────────────────────────────────────────────────────────────
  // Disables all currently-enabled bots. Settlement of open positions continues
  // unaffected — FastLoop resolves positions on market expiry regardless of is_enabled.
  const handlePauseAll = useCallback(async () => {
    const enabled = bots.filter((b) => b.is_enabled);
    if (enabled.length === 0) {
      setPauseMsg({ ok: true, text: 'All bots are already off.' });
      setTimeout(() => setPauseMsg(null), 3000);
      return;
    }
    setPausing(true);
    setPauseMsg(null);
    try {
      await Promise.all(
        enabled.map((b) => {
          const meta = CRYPTO_BOTS.find((m) => m.id === b.bot_id)!;
          return handleToggle(meta, false);
        })
      );
      setPauseMsg({ ok: true, text: `${enabled.length} bot${enabled.length !== 1 ? 's' : ''} paused. Open positions will still settle.` });
      setTimeout(() => setPauseMsg(null), 5000);
    } catch {
      setPauseMsg({ ok: false, text: 'Some bots could not be paused.' });
    } finally {
      setPausing(false);
    }
  }, [bots, handleToggle]);

  // ── Reset Paper ────────────────────────────────────────────────────────────
  const handleReset = useCallback(async () => {
    if (!resetUnlocked || resetting) return;
    setResetting(true);
    setResetMsg(null);
    try {
      const res  = await fetch('/api/crypto/reset-paper', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ starting_balance_usd: resetAmountNum }),
        cache:   'no-store',
      });
      const json = await res.json() as { ok: boolean; message?: string; error?: string };
      if (json.ok) {
        const amtStr = fmtUsd(resetAmountNum);
        setResetMsg({ ok: true, text: `Crypto Paper Account reset to ${amtStr}.` });
        setShowReset(false);
        setResetText('');
        setResetAmountStr('1000');
        await load();
        window.dispatchEvent(new CustomEvent('crypto:paper-reset'));
        dispatchBotChange();
      } else {
        setResetMsg({ ok: false, text: json.error ?? 'Reset failed.' });
      }
    } catch {
      setResetMsg({ ok: false, text: 'Network error during reset.' });
    } finally {
      setResetting(false);
    }
  }, [resetUnlocked, resetting, resetAmountNum, load]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
    {/* ── Sticky control bar ── */}
    <div
      className="crypto-cc-bar"
      style={{
        position:       'sticky',
        top:            57,          // header height ~57px
        zIndex:         90,
        background:     'rgba(10,14,26,0.92)',
        backdropFilter: 'blur(16px)',
        borderBottom:   '1px solid rgba(255,255,255,0.08)',
        padding:        '0.55rem 1.25rem',
        display:        'flex',
        alignItems:     'center',
        gap:            '0.75rem',
        flexWrap:       'wrap',
        marginBottom:   '0.75rem',
        marginLeft:     '-1.5rem',   // bleed to page edge
        marginRight:    '-1.5rem',
        paddingLeft:    '1.5rem',
        paddingRight:   '1.5rem',
      }}
    >

      {/* ── PAPER / LIVE unified mode toggle ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexShrink: 0 }}>
        {/* PAPER label */}
        <span style={{
          fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.07em',
          color: execMode === 'PAPER' ? '#818cf8' : 'rgba(248,250,252,0.3)',
          transition: 'color 0.2s',
        }}>
          PAPER
        </span>

        {/* Toggle pill */}
        <button
          onClick={handleModeToggleClick}
          disabled={switching}
          aria-label={execMode === 'PAPER' ? 'Switch to LIVE trading' : 'Switch to PAPER trading'}
          title={
            switching ? 'Switching…'
            : execMode === 'LIVE' ? 'Click to return to PAPER mode'
            : liveReady ? 'Click to go LIVE (confirmation required)'
            : 'LIVE not ready'
          }
          style={{
            position:   'relative',
            width:      46, height: 26, borderRadius: 13,
            border:     `1px solid ${execMode === 'LIVE' ? 'rgba(34,197,94,0.5)' : 'rgba(255,255,255,0.15)'}`,
            cursor:     switching ? 'wait' : 'pointer',
            background: execMode === 'LIVE' ? '#22c55e' : 'rgba(255,255,255,0.1)',
            transition: 'background 0.2s, border-color 0.2s',
            padding:    0, flexShrink: 0,
          }}
        >
          <span style={{
            position:   'absolute',
            top:        3,
            left:       execMode === 'LIVE' ? 23 : 3,
            width:      18, height: 18,
            borderRadius: '50%',
            background: '#f8fafc',
            transition: 'left 0.2s',
            boxShadow:  '0 1px 4px rgba(0,0,0,0.35)',
          }} />
        </button>

        {/* LIVE label */}
        <span style={{
          fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.07em',
          color: execMode === 'LIVE' ? '#22c55e'
               : liveReady         ? 'rgba(248,250,252,0.55)'
               :                     'rgba(248,250,252,0.2)',
          transition: 'color 0.2s',
        }}>
          LIVE
        </span>

        {/* Not-ready hint */}
        {!liveReady && execMode === 'PAPER' && (
          <span style={{ fontSize: '0.55rem', fontWeight: 700, color: '#fbbf24', letterSpacing: '0.04em' }}>
            NOT READY
          </span>
        )}
      </div>

      {/* Mode status badge */}
      {execMode === 'LIVE' ? (
        <span style={{
          padding:    '0.18rem 0.6rem', borderRadius: '0.3rem',
          background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)',
          fontSize:   '0.62rem', fontWeight: 800, letterSpacing: '0.07em',
          color:      '#f87171', flexShrink: 0,
          animation:  'none',
        }}>
          ● LIVE TRADING ACTIVE
        </span>
      ) : (
        <span style={{
          padding:    '0.18rem 0.6rem', borderRadius: '0.3rem',
          background: 'rgba(129,140,248,0.08)', border: '1px solid rgba(129,140,248,0.2)',
          fontSize:   '0.62rem', fontWeight: 700, letterSpacing: '0.06em',
          color:      '#818cf8', flexShrink: 0,
        }}>
          PAPER TRADING ACTIVE
        </span>
      )}

      {/* ── Divider ── */}
      <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)', flexShrink: 0 }} />

      {/* ── Per-bot ON/OFF toggles ── */}
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {CRYPTO_BOTS.map((meta) => {
          const bot     = bots.find((b) => b.bot_id === meta.id);
          const isOn    = bot?.is_enabled ?? false;
          const busy    = toggling.has(meta.id);
          const err     = toggleErr[meta.id];

          return (
            <button
              key={meta.id}
              onClick={() => handleToggle(meta, !isOn)}
              disabled={busy || loading}
              title={err ?? `Toggle ${meta.label} bot ${isOn ? 'OFF' : 'ON'}`}
              style={{
                display:    'flex', alignItems: 'center', gap: '0.3rem',
                padding:    '0.2rem 0.6rem',
                borderRadius: '0.35rem',
                fontSize:   '0.68rem', fontWeight: 700, letterSpacing: '0.05em',
                cursor:     busy || loading ? 'wait' : 'pointer',
                transition: 'all 0.15s',
                background:  isOn ? `${meta.color}18` : 'rgba(255,255,255,0.04)',
                border:      `1px solid ${isOn ? `${meta.color}50` : 'rgba(255,255,255,0.1)'}`,
                color:       isOn ? meta.color : 'rgba(248,250,252,0.4)',
                minWidth:    44,
              }}
            >
              <span style={{
                width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                background: isOn ? meta.color : 'rgba(255,255,255,0.2)',
                boxShadow:  isOn ? `0 0 6px ${meta.color}80` : 'none',
              }} />
              {meta.label}
              <span style={{ fontSize: '0.58rem', opacity: 0.7 }}>
                {busy ? '…' : isOn ? 'ON' : 'OFF'}
              </span>
              {err && <span style={{ fontSize: '0.6rem', color: '#f87171', marginLeft: 2 }}>!</span>}
            </button>
          );
        })}
      </div>

      {/* ── Divider ── */}
      <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)', flexShrink: 0 }} />

      {/* ── Action buttons ── */}
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>

        {/* Pause All */}
        <button
          onClick={handlePauseAll}
          disabled={pausing || loading || enabledCount === 0}
          title={
            enabledCount === 0
              ? 'All bots are already off'
              : 'Disable all enabled bots — open positions still settle'
          }
          style={{
            padding:  '0.2rem 0.65rem', borderRadius: '0.35rem',
            fontSize: '0.68rem', fontWeight: 700,
            background: pausing ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(251,191,36,0.3)',
            color: pausing ? '#fbbf24' : 'rgba(248,250,252,0.55)',
            cursor: (pausing || loading || enabledCount === 0) ? 'not-allowed' : 'pointer',
            opacity: (pausing || loading || enabledCount === 0) ? 0.55 : 1,
          }}
        >
          {pausing ? 'Pausing…' : 'Pause All'}
        </button>

        {/* Reset Paper */}
        <button
          onClick={() => { setShowReset(true); setResetText(''); setResetMsg(null); setResetAmountStr('1000'); }}
          disabled={resetting}
          title="Reset shared crypto paper account (BTC, ETH, SOL, XRP)"
          style={{
            padding:  '0.2rem 0.65rem', borderRadius: '0.35rem',
            fontSize: '0.68rem', fontWeight: 700,
            background: 'rgba(248,113,113,0.08)',
            border: '1px solid rgba(248,113,113,0.25)',
            color: 'rgba(248,113,113,0.7)',
            cursor: resetting ? 'wait' : 'pointer',
          }}
        >
          Reset Paper
        </button>
      </div>

      {/* ── Status summary ── */}
      <div style={{
        marginLeft: 'auto', display: 'flex', gap: '0.75rem', alignItems: 'center',
        fontSize: '0.65rem', color: 'rgba(248,250,252,0.4)', flexWrap: 'wrap', flexShrink: 0,
      }}>
        {loading ? (
          <span>Loading…</span>
        ) : (
          <>
            <span>
              <span style={{ color: enabledCount > 0 ? '#34d399' : 'rgba(248,250,252,0.3)', fontWeight: 700 }}>
                {enabledCount}
              </span>
              {' '}active
            </span>
            {openPositions > 0 && (
              <span>
                <span style={{ color: '#fbbf24', fontWeight: 700 }}>{openPositions}</span>
                {' '}open
              </span>
            )}
            {totalExposure > 0 && (
              <span>
                Exposure: <span style={{ color: '#f8fafc', fontWeight: 600 }}>{fmtUsd(totalExposure)}</span>
              </span>
            )}
            {availBalance !== null && (
              <span>
                Balance: <span style={{ color: '#f8fafc', fontWeight: 600 }}>{fmtUsd(availBalance)}</span>
              </span>
            )}
          </>
        )}
      </div>

      {/* ── Inline status messages ── */}
      {(pauseMsg || resetMsg || switchError || paperSwitchMsg) && (
        <div style={{
          width: '100%', fontSize: '0.65rem', fontWeight: 600, paddingTop: '0.2rem',
          color: switchError ? '#f87171'
               : paperSwitchMsg ? '#818cf8'
               : (pauseMsg ?? resetMsg)!.ok ? '#34d399' : '#f87171',
        }}>
          {switchError ?? paperSwitchMsg ?? pauseMsg?.text ?? resetMsg?.text}
        </div>
      )}

      {/* ── Compact market countdown summary ── */}
      <MarketSyncBar bots={bots} />
    </div>

    {/* ── GO LIVE confirmation modal ── */}
    {showGoLiveModal && (
      <div
        className="copy-modal-overlay"
        onClick={(e) => { if (e.target === e.currentTarget && !switching) setShowGoLiveModal(false); }}
        style={{ zIndex: 300 }}
      >
        <div className="copy-modal" role="dialog" aria-modal="true" style={{ maxWidth: 420 }}>
          <div className="copy-modal-header" style={{ borderBottom: '1px solid rgba(239,68,68,0.25)' }}>
            <h3 className="copy-modal-title" style={{ color: '#f87171' }}>TURN ON LIVE TRADING?</h3>
            <button className="copy-modal-close" onClick={() => setShowGoLiveModal(false)} disabled={switching}>×</button>
          </div>
          <div className="copy-modal-body">
            <div style={{
              padding: '0.65rem 0.85rem', marginBottom: '1rem',
              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
              borderRadius: '0.5rem', fontSize: '0.75rem', color: '#f8fafc', lineHeight: 1.55,
            }}>
              <strong style={{ color: '#f87171' }}>BTC, ETH, SOL and XRP</strong> will submit{' '}
              <strong style={{ color: '#f8fafc' }}>real orders using their current trade sizes.</strong>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'rgba(248,250,252,0.55)', marginBottom: '0.75rem', lineHeight: 1.6 }}>
              The LIVE Master will be enabled and all four crypto bots will be armed.
              Each bot&apos;s individual ON/OFF state and trade sizes are preserved.
            </p>
            <p style={{ fontSize: '0.7rem', color: 'rgba(248,250,252,0.4)', lineHeight: 1.5 }}>
              To return to paper trading at any time, flip the PAPER / LIVE toggle.
              No open positions will be closed automatically.
            </p>
          </div>
          <div className="copy-modal-footer">
            <button
              className="copy-btn copy-btn-secondary"
              onClick={() => setShowGoLiveModal(false)}
              disabled={switching}
            >
              Cancel
            </button>
            <button
              className="copy-btn copy-btn-primary"
              onClick={handleConfirmGoLive}
              disabled={switching}
              style={{
                background:  'rgba(239,68,68,0.2)', borderColor: 'rgba(239,68,68,0.5)',
                color:       '#f87171', cursor: switching ? 'wait' : 'pointer',
              }}
            >
              {switching ? 'Switching…' : 'GO LIVE'}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* ── Reset Paper confirmation modal ── */}
    {showReset && (
      <div
        className="copy-modal-overlay"
        onClick={(e) => { if (e.target === e.currentTarget && !resetting) { setShowReset(false); setResetText(''); setResetAmountStr('1000'); } }}
        style={{ zIndex: 200 }}
      >
        <div className="copy-modal" role="dialog" aria-modal="true" style={{ maxWidth: 440 }}>

          {/* Header */}
          <div className="copy-modal-header">
            <h3 className="copy-modal-title">Reset Crypto Paper Account?</h3>
            <button className="copy-modal-close" onClick={() => { setShowReset(false); setResetText(''); setResetAmountStr('1000'); }} disabled={resetting}>×</button>
          </div>

          {/* Body */}
          <div className="copy-modal-body">
            <p style={{ fontSize: '0.8rem', color: 'rgba(248,250,252,0.65)', marginBottom: '0.75rem', lineHeight: 1.55 }}>
              This permanently clears all <strong style={{ color: '#f8fafc' }}>PAPER</strong> trades,
              positions, performance and equity history for{' '}
              <strong style={{ color: '#f8fafc' }}>BTC, ETH, SOL and XRP</strong>.
            </p>
            <p style={{ fontSize: '0.8rem', color: 'rgba(248,250,252,0.65)', marginBottom: '1rem', lineHeight: 1.55 }}>
              Your <strong style={{ color: '#34d399' }}>LIVE</strong> bankroll and trades will
              <strong style={{ color: '#f8fafc' }}> not be affected</strong>.
              Bot ON/OFF states, trade sizes and strategy settings are preserved.
            </p>

            {/* ── Reset amount ── */}
            <label style={{ display: 'block', fontSize: '0.72rem', color: 'rgba(248,250,252,0.5)', marginBottom: '0.35rem' }}>
              Reset Paper Balance
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.5rem' }}>
              <span style={{ color: 'rgba(248,250,252,0.4)', fontFamily: 'monospace', fontSize: '0.85rem' }}>$</span>
              <input
                type="number"
                value={resetAmountStr}
                onChange={(e) => setResetAmountStr(e.target.value)}
                min="0.01" max="1000000" step="any"
                disabled={resetting}
                style={{
                  flex: 1, padding: '0.4rem 0.65rem',
                  background: 'rgba(255,255,255,0.06)',
                  border: `1px solid ${resetAmountValid ? 'rgba(255,255,255,0.15)' : 'rgba(248,113,113,0.4)'}`,
                  borderRadius: '0.4rem', color: '#f8fafc', fontSize: '0.85rem',
                  fontFamily: 'monospace', outline: 'none',
                }}
              />
            </div>
            {!resetAmountValid && resetAmountStr.length > 0 && (
              <p style={{ fontSize: '0.68rem', color: '#f87171', marginBottom: '0.5rem' }}>
                Enter a number between $0.01 and $1,000,000
              </p>
            )}

            {/* Expected outcome — live preview */}
            <div style={{
              background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: '0.45rem', padding: '0.6rem 0.8rem', marginBottom: '1rem',
              fontSize: '0.7rem', display: 'flex', flexDirection: 'column', gap: '0.2rem',
            }}>
              {[
                ['Starting Balance', resetAmountValid ? fmtUsd(resetAmountNum) : '—'],
                ['Current Equity',   resetAmountValid ? fmtUsd(resetAmountNum) : '—'],
                ['Available Balance',resetAmountValid ? fmtUsd(resetAmountNum) : '—'],
                ['Realized P/L',     '$0.00'],
                ['Open Positions',   '0'],
                ['Total Trades',     '0'],
              ].map(([label, val]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'rgba(248,250,252,0.4)' }}>{label}</span>
                  <span style={{ fontWeight: 600, fontFamily: 'monospace' }}>{val}</span>
                </div>
              ))}
            </div>

            {/* Confirm phrase */}
            <label style={{ display: 'block', fontSize: '0.72rem', color: 'rgba(248,250,252,0.5)', marginBottom: '0.4rem' }}>
              Type <strong style={{ color: '#f87171', fontFamily: 'monospace' }}>RESET PAPER</strong> to confirm:
            </label>
            <input
              ref={resetInputRef}
              type="text"
              value={resetText}
              onChange={(e) => setResetText(e.target.value)}
              placeholder="RESET PAPER"
              disabled={resetting}
              autoFocus
              style={{
                width: '100%', padding: '0.5rem 0.75rem',
                background: 'rgba(255,255,255,0.06)',
                border: `1px solid ${resetUnlocked ? 'rgba(248,113,113,0.5)' : 'rgba(255,255,255,0.12)'}`,
                borderRadius: '0.4rem', color: '#f8fafc', fontSize: '0.85rem',
                fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box',
              }}
            />
            {resetMsg && !resetMsg.ok && (
              <p style={{ marginTop: '0.5rem', fontSize: '0.7rem', color: '#f87171' }}>✗ {resetMsg.text}</p>
            )}
          </div>

          {/* Footer */}
          <div className="copy-modal-footer">
            <button
              className="copy-btn copy-btn-secondary"
              onClick={() => { setShowReset(false); setResetText(''); setResetAmountStr('1000'); }}
              disabled={resetting}
            >
              Cancel
            </button>
            <button
              className="copy-btn copy-btn-primary"
              onClick={handleReset}
              disabled={!resetUnlocked || resetting}
              style={{
                background:   resetUnlocked ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.05)',
                borderColor:  resetUnlocked ? 'rgba(239,68,68,0.5)' : 'rgba(255,255,255,0.1)',
                color:        resetUnlocked ? '#f87171' : 'rgba(248,250,252,0.25)',
                cursor:       resetUnlocked && !resetting ? 'pointer' : 'not-allowed',
              }}
            >
              {resetting ? 'Resetting…' : 'Reset Crypto Paper Account'}
            </button>
          </div>

        </div>
      </div>
    )}
    </>
  );
}
