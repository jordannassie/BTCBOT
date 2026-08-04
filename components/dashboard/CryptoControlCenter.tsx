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
  bot_id:            string;
  is_enabled:        boolean;
  open_exposure:     number;
  account_equity:    number;
  starting_balance:  number;
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtUsd(v: number, digits = 2) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: digits,
  }).format(v);
}

function dispatchBotChange() {
  window.dispatchEvent(new CustomEvent('crypto:bot-state-changed'));
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function CryptoControlCenter() {
  // ── Bot state ──────────────────────────────────────────────────────────────
  const [bots,       setBots]      = useState<BotStat[]>([]);
  const [loading,    setLoading]   = useState(true);

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
      const res  = await fetch('/api/crypto/bots', { cache: 'no-store' });
      const json = await res.json() as BotsApiResponse;
      if (json.ok && json.bots) setBots(json.bots);
    } catch {}
    finally { setLoading(false); }
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

      {/* ── Mode indicator (PAPER always active; LIVE not ready) ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexShrink: 0 }}>
        <span style={{
          fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.08em',
          padding: '0.2rem 0.65rem', borderRadius: '0.35rem',
          background: 'rgba(129,140,248,0.15)', border: '1px solid rgba(129,140,248,0.35)',
          color: '#818cf8',
        }}>
          PAPER MODE
        </span>
        <span
          title="LIVE mode is not yet available from the dashboard control center."
          style={{
            fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.06em',
            padding: '0.18rem 0.55rem', borderRadius: '0.35rem',
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
            color: 'rgba(248,250,252,0.2)', cursor: 'not-allowed',
          }}
        >
          LIVE — Not Ready
        </span>
      </div>

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
      {(pauseMsg || resetMsg) && (
        <div style={{
          width: '100%', fontSize: '0.65rem', fontWeight: 600, paddingTop: '0.2rem',
          color: (pauseMsg ?? resetMsg)!.ok ? '#34d399' : '#f87171',
        }}>
          {pauseMsg?.text ?? resetMsg?.text}
        </div>
      )}
    </div>

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
