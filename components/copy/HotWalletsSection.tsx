'use client';

import SourceAvatar from './SourceAvatar';

// Hot Wallets — discovery / ranking panel.
//
// Data sources (in priority order):
//   1. Polymarket trading leaderboard (fetched server-side via /api/copy/hot-wallets).
//      Top 100 traders by 30-day P&L; no auth required; no CORS issues.
//   2. Operator-seeded manual candidates stored in localStorage.
//      Useful for specific addresses not on the leaderboard.
//
// Already-tracked wallets are excluded on the server side.
// The ignore list is maintained client-side in localStorage.
//
// Actions per row:
//   + Track   → POST /api/copy/wallets (auto-creates a PAPER copy bot)
//   Ignore    → localStorage; hides from list until "Show ignored" is toggled
//   ↗ link    → opens polymarket.com/profile/<address>

import { useCallback, useEffect, useMemo, useState } from 'react';

const IGNORE_LS_KEY    = 'copy-hot-wallets-ignored';
const MANUAL_LS_KEY    = 'copy-hot-wallets-manual';
const POLL_MS          = 90_000; // 90 s — leaderboard changes slowly

// ─── Types ────────────────────────────────────────────────────────────────────

type HotWallet = {
  wallet_address:               string;
  display_name:                 string | null;
  hot_score:                    number;
  pnl_30d:                      number | null;
  pnl_7d:                       number | null;
  pnl_daily:                    number | null;
  win_rate:                     number | null;
  avg_hold_minutes:             number | null;
  trade_count:                  number | null;
  trades_per_day:               number | null;
  volume:                       number | null;
  last_trade_at:                string | null;
  category_focus:               string | null;
  exit_before_resolution_rate:  number | null;
  source:                       'leaderboard' | 'manual';
};

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtHold(minutes: number | null): string {
  if (minutes == null) return '—';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function fmtCompact(v: number | null): string {
  if (v == null) return '—';
  const abs = Math.abs(v);
  const prefix = v < 0 ? '-$' : '$';
  if (abs >= 1_000_000) return `${prefix}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `${prefix}${(abs / 1_000).toFixed(1)}K`;
  return `${prefix}${abs.toFixed(2)}`;
}

function truncate(addr: string): string {
  return addr.length > 14 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr;
}

function pnlClass(v: number | null): string {
  if (v == null) return 'copy-td-muted';
  return v >= 0 ? 'copy-num-pos' : 'copy-num-neg';
}

function fmtTradesPerDay(v: number | null): string {
  if (v == null) return '—';
  if (v < 1) return `${(v * 10).toFixed(1)}/10d`;
  return `${v.toFixed(1)}/d`;
}

function fmtExitRate(v: number | null): string {
  if (v == null) return '—';
  return `${(v * 100).toFixed(0)}%`;
}

function holdClass(minutes: number | null): string {
  if (minutes == null) return 'copy-td-muted';
  if (minutes < 60)   return 'copy-num-pos';
  if (minutes < 360)  return '';
  return 'copy-td-muted';
}

function exitRateColor(rate: number | null): string {
  if (rate == null) return 'rgba(248,250,252,0.3)';
  if (rate >= 0.60) return '#34d399';  // green — actively exits early
  if (rate >= 0.35) return '#fbbf24';  // amber — moderate
  return '#f87171';                    // red — rarely exits before resolution
}

function hotScoreClass(score: number): string {
  if (score >= 70) return 'copy-score-high';
  if (score >= 40) return 'copy-score-mid';
  return 'copy-score-low';
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ExternalLinkIcon() {
  return (
    <svg
      className="copy-wallet-ext-icon"
      width="10" height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
      <polyline points="15 3 21 3 21 9"/>
      <line x1="10" y1="14" x2="21" y2="3"/>
    </svg>
  );
}

function HotScoreBar({ score }: { score: number }) {
  const pct   = Math.min(100, Math.max(0, score));
  const color = score >= 70 ? '#34d399' : score >= 40 ? '#fbbf24' : 'rgba(248,250,252,0.2)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
      <span className={`copy-score-badge ${hotScoreClass(score)}`}>
        {score.toFixed(0)}
      </span>
      <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)', minWidth: 44 }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 2, background: color, transition: 'width 0.3s' }} />
      </div>
    </div>
  );
}

function SourceBadge({ source }: { source: HotWallet['source'] }) {
  if (source === 'leaderboard') {
    return (
      <span style={{
        display: 'inline-block',
        fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.06em',
        padding: '0.1em 0.4em', borderRadius: '0.25rem',
        background: 'rgba(96,165,250,0.1)', color: '#60a5fa',
        border: '1px solid rgba(96,165,250,0.18)', whiteSpace: 'nowrap',
      }}>
        LB
      </span>
    );
  }
  return (
    <span style={{
      display: 'inline-block',
      fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.06em',
      padding: '0.1em 0.4em', borderRadius: '0.25rem',
      background: 'rgba(251,191,36,0.1)', color: '#fbbf24',
      border: '1px solid rgba(251,191,36,0.18)', whiteSpace: 'nowrap',
    }}>
      MANUAL
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function HotWalletsSection() {
  const [rows,        setRows]        = useState<HotWallet[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [lbError,     setLbError]     = useState<string | null>(null);
  const [ignored,     setIgnored]     = useState<Set<string>>(new Set());
  const [manual,      setManual]      = useState<string[]>([]);
  const [showIgnored, setShowIgnored] = useState(false);
  const [showForm,    setShowForm]    = useState(false);
  const [adding,      setAdding]      = useState<string | null>(null);
  const [addedSet,    setAddedSet]    = useState<Set<string>>(new Set());
  const [addError,    setAddError]    = useState<string | null>(null);

  // Manual form
  const [fAddr,  setFAddr]  = useState('');
  const [fError, setFError] = useState<string | null>(null);

  // ── LocalStorage bootstrap (runs once on mount, client-side only) ───────────

  useEffect(() => {
    try {
      const ig = localStorage.getItem(IGNORE_LS_KEY);
      if (ig) setIgnored(new Set(JSON.parse(ig) as string[]));
    } catch {}
    try {
      const mn = localStorage.getItem(MANUAL_LS_KEY);
      if (mn) setManual(JSON.parse(mn) as string[]);
    } catch {}
  }, []);

  const saveIgnored = (next: Set<string>) => {
    setIgnored(next);
    try { localStorage.setItem(IGNORE_LS_KEY, JSON.stringify([...next])); } catch {}
  };

  const saveManual = (next: string[]) => {
    setManual(next);
    try { localStorage.setItem(MANUAL_LS_KEY, JSON.stringify(next)); } catch {}
  };

  // ── Data loading ─────────────────────────────────────────────────────────────

  const load = useCallback(async (manualList?: string[]) => {
    setLoading(true);
    setError(null);
    // use the arg (if freshly updated) or fall back to the ref closed over at mount
    const addresses = manualList ?? manual;
    const qs = addresses.length > 0 ? `?manual=${addresses.join(',')}` : '';
    try {
      const res     = await fetch(`/api/copy/hot-wallets${qs}`, { cache: 'no-store' });
      const payload = await res.json();
      if (payload.ok) {
        setRows(payload.rows ?? []);
        setLbError(payload.leaderboard_error ?? null);
      } else {
        setError(payload.error ?? 'Failed to load hot wallets');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, [manual]); // eslint-disable-line react-hooks/exhaustive-deps

  // Initial load
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Polling + visibility
  useEffect(() => {
    const poll      = setInterval(() => load(), POLL_MS);
    const onVisible = () => { if (!document.hidden) load(); };
    const onRefresh = () => load();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('copy:refresh',       onRefresh);
    return () => {
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('copy:refresh',       onRefresh);
    };
  }, [load]);

  // ── Manual candidate form ─────────────────────────────────────────────────

  const handleAddManual = (e: React.FormEvent) => {
    e.preventDefault();
    setFError(null);
    const addr = fAddr.trim();
    if (!addr) { setFError('Address required'); return; }
    if (!addr.startsWith('0x')) { setFError('Must start with 0x'); return; }
    if (manual.includes(addr)) { setFError('Already in candidate list'); return; }
    const next = [...manual, addr];
    saveManual(next);
    setFAddr('');
    setShowForm(false);
    // reload with the fresh manual list immediately
    load(next);
  };

  const handleRemoveManual = (addr: string) => {
    const next = manual.filter((a) => a !== addr);
    saveManual(next);
    load(next);
  };

  // ── Ignore actions ─────────────────────────────────────────────────────────

  const handleIgnore = (addr: string) => {
    saveIgnored(new Set([...ignored, addr]));
  };
  const handleUnignore = (addr: string) => {
    const next = new Set(ignored);
    next.delete(addr);
    saveIgnored(next);
  };

  // ── Add to tracked wallets ─────────────────────────────────────────────────

  const handleTrack = async (w: HotWallet) => {
    setAdding(w.wallet_address);
    setAddError(null);
    try {
      const res = await fetch('/api/copy/wallets', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          wallet_address: w.wallet_address,
          display_name:   w.display_name ?? undefined,
          source:         'hot_wallets',
        }),
        cache: 'no-store',
      });
      const payload = await res.json();
      if (payload.ok) {
        setAddedSet((prev) => new Set([...prev, w.wallet_address]));
        // Also remove from manual list if it was manually added
        if (manual.includes(w.wallet_address)) handleRemoveManual(w.wallet_address);
        setTimeout(() => load(), 800);
      } else {
        setAddError(payload.error ?? 'Failed to add wallet');
        setTimeout(() => setAddError(null), 5000);
      }
    } catch {
      setAddError('Network error');
      setTimeout(() => setAddError(null), 5000);
    } finally {
      setAdding(null);
    }
  };

  // ── Derived state ──────────────────────────────────────────────────────────

  const visible = useMemo(() => {
    if (showIgnored) return rows;
    return rows.filter((r) => !ignored.has(r.wallet_address));
  }, [rows, ignored, showIgnored]);

  const ignoredCount = useMemo(
    () => rows.filter((r) => ignored.has(r.wallet_address)).length,
    [rows, ignored]
  );

  const lbCount     = rows.filter((r) => r.source === 'leaderboard').length;
  const manualCount = rows.filter((r) => r.source === 'manual').length;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="copy-section copy-hot-wallets-section">

      {/* ── Header ── */}
      <div className="copy-section-head">
        <div className="copy-section-title-row">
          <h2 className="copy-section-title">Hot Wallets</h2>
          {!loading && visible.length > 0 && (
            <span className="copy-section-count">{visible.length}</span>
          )}
          <span className="copy-hot-badge">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2c-.5 2-2.5 3.5-3.5 5.5C7.5 9.5 8 11.5 9 13c-1-.5-1.5-1.5-1.5-2.5C5 12.5 4 15 5 18c1 2.5 3.5 4 7 4s7-2 7-5c0-2.5-1-4.5-2.5-6C17 13 17 15 16 16c.5-2 0-5-4-14z"/>
            </svg>
            DISCOVERY
          </span>
        </div>

        <div className="copy-section-actions">
          {ignoredCount > 0 && (
            <button
              className="copy-btn copy-btn-secondary copy-btn-sm"
              onClick={() => setShowIgnored((v) => !v)}
            >
              {showIgnored ? 'Hide ignored' : `Ignored (${ignoredCount})`}
            </button>
          )}
          <button
            className={`copy-btn copy-btn-sm ${showForm ? 'copy-btn-secondary' : 'copy-btn-secondary'}`}
            onClick={() => setShowForm((v) => !v)}
            title="Add a specific wallet address as a candidate"
          >
            {showForm ? 'Cancel' : '+ Add address'}
          </button>
          <button
            className="copy-btn copy-btn-secondary copy-btn-sm"
            onClick={() => load()}
            disabled={loading}
            title="Refresh"
          >
            ↻
          </button>
        </div>
      </div>

      {/* ── Source summary ── */}
      <div className="copy-hot-subtitle">
        {loading ? 'Loading…' : (
          <>
            {lbError ? (
              <span style={{ color: '#f87171' }}>
                Leaderboard unavailable: {lbError}.{' '}
                {manualCount > 0 ? `Showing ${manualCount} manual candidate${manualCount !== 1 ? 's' : ''}.` : 'Add addresses manually below.'}
              </span>
            ) : (
              <>
                {lbCount > 0
                  ? `${lbCount} candidate${lbCount !== 1 ? 's' : ''} from Polymarket 30-day leaderboard`
                  : 'No leaderboard candidates'
                }
                {manualCount > 0 && ` + ${manualCount} manually added`}
                {lbCount === 0 && manualCount === 0 && ' — all top traders are already tracked, or the leaderboard returned no results.'}
                {'. '}
                Wallets already in your tracked list are excluded.
              </>
            )}
          </>
        )}
      </div>

      {/* ── Add address form ── */}
      {showForm && (
        <form className="copy-add-form" onSubmit={handleAddManual}>
          <div className="copy-form-title">Add Candidate Address</div>
          <div style={{ fontSize: '0.73rem', color: 'rgba(248,250,252,0.4)', marginBottom: '0.75rem', lineHeight: 1.5 }}>
            Paste a Polymarket wallet address to add it as a discovery candidate.
            The system will attempt to fetch its stats from Polymarket.
          </div>
          <div className="copy-form-grid">
            <div className="copy-form-field copy-form-grid-wide">
              <label className="copy-form-label">Wallet Address <span style={{ color: '#f87171' }}>*</span></label>
              <input
                className="copy-form-input"
                value={fAddr}
                onChange={(e) => setFAddr(e.target.value)}
                placeholder="0x…"
                spellCheck={false}
                autoComplete="off"
              />
              {fError && <span className="copy-form-msg copy-form-error">{fError}</span>}
            </div>
          </div>
          <div className="copy-form-actions">
            <button className="copy-btn copy-btn-primary" type="submit">Add Candidate</button>
          </div>
        </form>
      )}

      {/* ── Global add error ── */}
      {addError && (
        <div style={{ padding: '0 1.5rem 0.5rem' }}>
          <span className="copy-form-msg copy-form-error">{addError}</span>
        </div>
      )}

      {/* ── Manual candidates chip list ── */}
      {manual.length > 0 && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: '0.4rem',
          padding: '0 1.5rem 0.75rem',
        }}>
          <span style={{ fontSize: '0.7rem', color: 'rgba(248,250,252,0.3)', alignSelf: 'center' }}>Manual:</span>
          {manual.map((addr) => (
            <span key={addr} style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
              fontSize: '0.7rem', padding: '0.15rem 0.5rem', borderRadius: '0.4rem',
              background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.15)',
              color: 'rgba(248,250,252,0.55)',
            }}>
              <span className="copy-mono">{truncate(addr)}</span>
              <button
                onClick={() => handleRemoveManual(addr)}
                style={{ background: 'none', border: 'none', color: 'rgba(248,250,252,0.3)', cursor: 'pointer', padding: 0, lineHeight: 1, fontSize: '0.75rem' }}
                title="Remove from candidate list"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* ── States ── */}
      {loading ? (
        <div className="copy-loading">Fetching leaderboard…</div>

      ) : error ? (
        <div className="copy-empty">
          <p className="copy-empty-title" style={{ color: '#f87171' }}>{error}</p>
        </div>

      ) : visible.length === 0 ? (
        <div className="copy-empty">
          <div className="copy-empty-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </div>
          <p className="copy-empty-title">No candidates</p>
          <p className="copy-empty-sub">
            {lbError
              ? 'Polymarket leaderboard is unreachable. Use "+ Add address" to add candidates manually.'
              : 'All top leaderboard traders are already in your tracked list, or the leaderboard returned an empty result. Use "+ Add address" to add a specific wallet.'
            }
            {ignoredCount > 0 && (
              <>
                {' '}
                <button
                  style={{ background: 'none', border: 'none', color: '#fbbf24', cursor: 'pointer', padding: 0, fontSize: 'inherit' }}
                  onClick={() => setShowIgnored(true)}
                >
                  Show {ignoredCount} ignored.
                </button>
              </>
            )}
          </p>
        </div>

      ) : (
        /* ── Ranked table ── */
        <div className="copy-table-wrap copy-table-scroll">
          <table className="copy-table copy-hot-table" style={{ minWidth: '900px' }}>
            <thead>
              <tr>
                <th className="copy-th-rank">#</th>
                <th style={{ minWidth: 190 }}>Wallet</th>
                <th
                  style={{ minWidth: 130 }}
                  title="Fast-copy suitability score (0–100). Factors: hold speed, exit-before-resolution rate, win rate, recent P/L, recency."
                >
                  Fast-Copy Score
                </th>
                <th title="Estimated daily profit (30d P/L ÷ 30)">Daily Profit</th>
                <th title="30-day total trading volume">Volume</th>
                <th title="Average trades per day over the leaderboard window">Trades/Day</th>
                <th title="Average hold time. Shorter = easier to copy-exit before resolution.">Avg Hold</th>
                <th
                  className="copy-hot-col-ebr"
                  title="Fraction of trades closed before market resolution. Higher = trader actively exits early."
                >
                  Exit-Before-Res%
                </th>
                <th style={{ minWidth: 130 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((w, idx) => {
                const isIgnored = ignored.has(w.wallet_address);
                const isAdded   = addedSet.has(w.wallet_address);
                const isAdding  = adding === w.wallet_address;

                return (
                  <tr key={w.wallet_address} className={isIgnored ? 'copy-row-inactive' : ''}>

                    {/* Rank */}
                    <td className="copy-td-rank">{idx + 1}</td>

                    {/* Identity */}
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <SourceAvatar sourceType="COPY_TRADER" name={w.display_name ?? undefined} size={28} style={{ flexShrink: 0 }} />
                        <SourceBadge source={w.source} />
                        <div>
                          {w.display_name && (
                            <div
                              className="copy-td-name"
                              style={{ fontWeight: 600, fontSize: '0.8rem', color: '#f8fafc' }}
                            >
                              {w.display_name}
                            </div>
                          )}
                          <a
                            className="copy-wallet-pm-link"
                            href={`https://polymarket.com/profile/${w.wallet_address}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`View on Polymarket: ${w.wallet_address}`}
                            style={{ fontSize: '0.72rem' }}
                          >
                            <span className="copy-mono">{truncate(w.wallet_address)}</span>
                            <ExternalLinkIcon />
                          </a>
                        </div>
                      </div>
                    </td>

                    {/* Fast-copy score bar */}
                    <td><HotScoreBar score={w.hot_score} /></td>

                    {/* Daily profit (estimated) */}
                    <td className={`copy-td-num ${pnlClass(w.pnl_daily)}`}>
                      {fmtCompact(w.pnl_daily)}
                    </td>

                    {/* Volume */}
                    <td className="copy-td-num copy-td-muted">{fmtCompact(w.volume)}</td>

                    {/* Trades per day */}
                    <td className="copy-td-num copy-td-muted">
                      {fmtTradesPerDay(w.trades_per_day)}
                    </td>

                    {/* Avg hold */}
                    <td className={`copy-td-num ${holdClass(w.avg_hold_minutes)}`}>
                      {fmtHold(w.avg_hold_minutes)}
                    </td>

                    {/* Exit-before-resolution rate */}
                    <td className="copy-td-num copy-hot-col-ebr">
                      <span style={{ color: exitRateColor(w.exit_before_resolution_rate), fontWeight: 600 }}>
                        {fmtExitRate(w.exit_before_resolution_rate)}
                      </span>
                    </td>

                    {/* Actions */}
                    <td>
                      <div className="copy-hot-actions">
                        {isAdded ? (
                          <span className="copy-hot-added">✓ Tracked</span>
                        ) : (
                          <button
                            className="copy-btn copy-btn-primary copy-btn-sm"
                            onClick={() => handleTrack(w)}
                            disabled={isAdding}
                            title="Add to Tracked Wallets and create a PAPER copy bot"
                          >
                            {isAdding ? '…' : '+ Track'}
                          </button>
                        )}

                        {isIgnored ? (
                          <button
                            className="copy-btn copy-btn-secondary copy-btn-sm"
                            onClick={() => handleUnignore(w.wallet_address)}
                          >
                            Unignore
                          </button>
                        ) : (
                          <button
                            className="copy-btn copy-btn-secondary copy-btn-sm copy-hot-ignore-btn"
                            onClick={() => handleIgnore(w.wallet_address)}
                            title="Hide from discovery list"
                          >
                            Ignore
                          </button>
                        )}

                        {w.source === 'manual' && (
                          <button
                            className="copy-btn copy-btn-secondary copy-btn-sm"
                            onClick={() => handleRemoveManual(w.wallet_address)}
                            title="Remove from candidate list"
                            style={{ color: 'rgba(248,250,252,0.25)' }}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer: ignored count */}
      {!showIgnored && ignoredCount > 0 && visible.length > 0 && (
        <div className="copy-hot-ignore-note">
          {ignoredCount} wallet{ignoredCount !== 1 ? 's' : ''} hidden.{' '}
          <button
            style={{ background: 'none', border: 'none', color: '#fbbf24', cursor: 'pointer', padding: 0, fontSize: 'inherit' }}
            onClick={() => setShowIgnored(true)}
          >
            Show all
          </button>
        </div>
      )}
    </div>
  );
}
