'use client';

// Hot Wallets — discovery / ranking panel.
//
// Shows wallet_metrics rows for addresses NOT yet in tracked_wallets,
// ranked by a server-computed `hot_score` (fast-turnover copy suitability).
//
// Actions per row:
//   + Track   → POST /api/copy/wallets (auto-creates a PAPER copy bot)
//   Ignore    → stores address in localStorage; hides from the list
//   [↗ link]  → opens polymarket.com/profile/<address> in a new tab
//
// Ignore list is kept in localStorage only — operator preference,
// no DB table needed.

import { useCallback, useEffect, useMemo, useState } from 'react';

const IGNORE_LS_KEY = 'copy-hot-wallets-ignored';
const POLL_MS       = 60_000; // 1-minute poll (candidates change slowly)

// ─── Types ────────────────────────────────────────────────────────────────────

type HotWallet = {
  wallet_address:    string;
  hot_score:         number;
  copy_score:        number | null;
  pnl_7d:            number | null;
  pnl_30d:           number | null;
  win_rate:          number | null;
  avg_hold_minutes:  number | null;
  trade_count:       number | null;
  volume:            number | null;
  category_focus:    string | null;
  last_trade_at:     string | null;
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

function fmtPct(v: number | null): string {
  if (v == null) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

function fmtRelative(d: string | null): string {
  if (!d) return '—';
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs  < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function truncate(addr: string): string {
  return addr.length > 14 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr;
}

function pnlClass(v: number | null): string {
  if (v == null) return 'copy-td-muted';
  return v >= 0 ? 'copy-num-pos' : 'copy-num-neg';
}

function hotScoreClass(score: number): string {
  if (score >= 70) return 'copy-score-high';
  if (score >= 40) return 'copy-score-mid';
  return 'copy-score-low';
}

// Hold-time coloring: fast = green, medium = neutral, slow = muted
function holdClass(minutes: number | null): string {
  if (minutes == null) return 'copy-td-muted';
  if (minutes < 60)  return 'copy-num-pos';
  if (minutes < 360) return '';
  return 'copy-td-muted';
}

// Win-rate colour
function winColor(rate: number | null): string {
  if (rate == null) return 'inherit';
  const pct = rate * 100;
  if (pct >= 55) return '#34d399';
  if (pct >= 40) return '#fbbf24';
  return '#f87171';
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

// Flame icon for the section header badge
function FlameIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2c-.5 2-2.5 3.5-3.5 5.5C7.5 9.5 8 11.5 9 13c-1-.5-1.5-1.5-1.5-2.5C5 12.5 4 15 5 18c1 2.5 3.5 4 7 4s7-2 7-5c0-2.5-1-4.5-2.5-6C17 13 17 15 16 16c.5-2 0-5-4-14z"/>
    </svg>
  );
}

// HotScore bar — visual representation of score out of 100
function HotScoreBar({ score }: { score: number }) {
  const pct   = Math.min(100, Math.max(0, score));
  const color = score >= 70 ? '#34d399' : score >= 40 ? '#fbbf24' : 'rgba(248,250,252,0.2)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
      <span className={`copy-score-badge ${hotScoreClass(score)}`}>
        {score.toFixed(0)}
      </span>
      <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)', minWidth: 48 }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 2, background: color, transition: 'width 0.3s' }} />
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function HotWalletsSection() {
  const [rows,       setRows]       = useState<HotWallet[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [ignored,    setIgnored]    = useState<Set<string>>(new Set());
  const [showIgnored,setShowIgnored]= useState(false);
  const [adding,     setAdding]     = useState<string | null>(null);
  const [addedSet,   setAddedSet]   = useState<Set<string>>(new Set());
  const [addError,   setAddError]   = useState<string | null>(null);

  // ── Ignore list (localStorage) ──────────────────────────────────────────────

  useEffect(() => {
    try {
      const raw = localStorage.getItem(IGNORE_LS_KEY);
      if (raw) setIgnored(new Set(JSON.parse(raw) as string[]));
    } catch {}
  }, []);

  const persistIgnored = (next: Set<string>) => {
    setIgnored(next);
    try { localStorage.setItem(IGNORE_LS_KEY, JSON.stringify([...next])); } catch {}
  };

  const handleIgnore = (addr: string) => {
    persistIgnored(new Set([...ignored, addr]));
  };

  const handleUnignore = (addr: string) => {
    const next = new Set(ignored);
    next.delete(addr);
    persistIgnored(next);
  };

  // ── Data loading ────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res     = await fetch('/api/copy/hot-wallets', { cache: 'no-store' });
      const payload = await res.json();
      if (payload.ok) {
        setRows(payload.rows ?? []);
      } else {
        setError(payload.error ?? 'Failed to load hot wallets');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const poll      = setInterval(load, POLL_MS);
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

  // ── Add to tracked wallets ──────────────────────────────────────────────────

  const handleAdd = async (w: HotWallet) => {
    setAdding(w.wallet_address);
    setAddError(null);
    try {
      const res = await fetch('/api/copy/wallets', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ wallet_address: w.wallet_address }),
        cache:   'no-store',
      });
      const payload = await res.json();
      if (payload.ok) {
        setAddedSet((prev) => new Set([...prev, w.wallet_address]));
        // Refresh after a short delay so Supabase completes the write
        setTimeout(load, 800);
      } else {
        setAddError(payload.error ?? 'Failed to add wallet');
        setTimeout(() => setAddError(null), 5000);
      }
    } catch {
      setAddError('Network error adding wallet');
      setTimeout(() => setAddError(null), 5000);
    } finally {
      setAdding(null);
    }
  };

  // ── Derived state ────────────────────────────────────────────────────────────

  const visible = useMemo(() => {
    if (showIgnored) return rows;
    return rows.filter((r) => !ignored.has(r.wallet_address));
  }, [rows, ignored, showIgnored]);

  const ignoredCount = useMemo(
    () => rows.filter((r) => ignored.has(r.wallet_address)).length,
    [rows, ignored]
  );

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="copy-section copy-hot-wallets-section">
      {/* ── Section header ── */}
      <div className="copy-section-head">
        <div className="copy-section-title-row">
          <h2 className="copy-section-title">Hot Wallets</h2>
          {!loading && visible.length > 0 && (
            <span className="copy-section-count">{visible.length}</span>
          )}
          {/* DISCOVERY badge */}
          <span className="copy-hot-badge">
            <FlameIcon />
            DISCOVERY
          </span>
        </div>

        <div className="copy-section-actions">
          {ignoredCount > 0 && (
            <button
              className="copy-btn copy-btn-secondary copy-btn-sm"
              onClick={() => setShowIgnored((v) => !v)}
            >
              {showIgnored ? `Hide ignored` : `Ignored (${ignoredCount})`}
            </button>
          )}
          <button
            className="copy-btn copy-btn-secondary copy-btn-sm"
            onClick={load}
            disabled={loading}
            title="Refresh"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Subtitle */}
      <div className="copy-hot-subtitle">
        Untracked wallets with strong fast-exit metrics — ranked by copy suitability.
        Add any wallet to begin monitoring it and auto-creating a PAPER copy bot.
      </div>

      {/* Add error */}
      {addError && (
        <div style={{ padding: '0 1.5rem 0.5rem' }}>
          <span className="copy-form-msg copy-form-error">{addError}</span>
        </div>
      )}

      {/* ── States ── */}
      {loading ? (
        <div className="copy-loading">Scanning for hot wallets…</div>

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
          <p className="copy-empty-title">No candidates yet</p>
          <p className="copy-empty-sub">
            Candidates appear here when <code>wallet_metrics</code> contains entries for
            wallets not yet in your tracked list.
            {ignoredCount > 0 && (
              <>
                {' '}
                <button
                  style={{ background: 'none', border: 'none', color: '#fbbf24', cursor: 'pointer', padding: 0, fontSize: 'inherit' }}
                  onClick={() => setShowIgnored(true)}
                >
                  Show {ignoredCount} ignored wallet{ignoredCount !== 1 ? 's' : ''}.
                </button>
              </>
            )}
          </p>
        </div>

      ) : (
        /* ── Ranked table ── */
        <div className="copy-table-wrap copy-table-scroll">
          <table className="copy-table" style={{ minWidth: '1100px' }}>
            <thead>
              <tr>
                <th className="copy-th-rank">#</th>
                <th style={{ minWidth: 190 }}>Wallet</th>
                <th style={{ minWidth: 130 }} title="Composite fast-copy suitability score (0–100)">Hot Score</th>
                <th title="Average hold time — lower = faster exits = easier to copy">Avg Hold</th>
                <th title="Total trades in wallet_metrics">Trades</th>
                <th>Win Rate</th>
                <th>30d P/L</th>
                <th>7d P/L</th>
                <th>Volume</th>
                <th>Last Active</th>
                <th>Category</th>
                <th style={{ minWidth: 140 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((w, idx) => {
                const isIgnored = ignored.has(w.wallet_address);
                const isAdded   = addedSet.has(w.wallet_address);
                const isAdding  = adding === w.wallet_address;

                return (
                  <tr
                    key={w.wallet_address}
                    className={isIgnored ? 'copy-row-inactive' : ''}
                  >
                    {/* Rank */}
                    <td className="copy-td-rank">{idx + 1}</td>

                    {/* Wallet identity */}
                    <td>
                      <a
                        className="copy-td-name copy-wallet-pm-link"
                        href={`https://polymarket.com/profile/${w.wallet_address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`View ${w.wallet_address} on Polymarket`}
                      >
                        {truncate(w.wallet_address)}
                        <ExternalLinkIcon />
                      </a>
                      <span className="copy-td-sub copy-mono" style={{ fontSize: '0.65rem', opacity: 0.35 }}>
                        {w.wallet_address}
                      </span>
                    </td>

                    {/* Hot score with mini-bar */}
                    <td>
                      <HotScoreBar score={w.hot_score} />
                    </td>

                    {/* Avg hold time */}
                    <td className={`copy-td-num ${holdClass(w.avg_hold_minutes)}`}>
                      {fmtHold(w.avg_hold_minutes)}
                    </td>

                    {/* Trade count */}
                    <td className="copy-td-num copy-td-muted">
                      {w.trade_count != null ? w.trade_count.toLocaleString() : '—'}
                    </td>

                    {/* Win rate */}
                    <td className="copy-td-num">
                      {w.win_rate != null ? (
                        <span style={{ color: winColor(w.win_rate), fontWeight: 600 }}>
                          {fmtPct(w.win_rate)}
                        </span>
                      ) : (
                        <span className="copy-td-muted">—</span>
                      )}
                    </td>

                    {/* P/L columns */}
                    <td className={`copy-td-num ${pnlClass(w.pnl_30d)}`}>{fmtCompact(w.pnl_30d)}</td>
                    <td className={`copy-td-num ${pnlClass(w.pnl_7d)}`}>{fmtCompact(w.pnl_7d)}</td>

                    {/* Volume */}
                    <td className="copy-td-num copy-td-muted">{fmtCompact(w.volume)}</td>

                    {/* Last active */}
                    <td className="copy-td-muted" style={{ fontSize: '0.71rem', whiteSpace: 'nowrap' }}>
                      {fmtRelative(w.last_trade_at)}
                    </td>

                    {/* Category */}
                    <td>
                      {w.category_focus ? (
                        <span className="copy-badge copy-badge-purple">{w.category_focus}</span>
                      ) : (
                        <span className="copy-td-muted">—</span>
                      )}
                    </td>

                    {/* Actions */}
                    <td>
                      <div className="copy-hot-actions">
                        {isAdded ? (
                          <span className="copy-hot-added">✓ Tracked</span>
                        ) : (
                          <button
                            className="copy-btn copy-btn-primary copy-btn-sm"
                            onClick={() => handleAdd(w)}
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
                            title="Remove from ignore list"
                          >
                            Unignore
                          </button>
                        ) : (
                          <button
                            className="copy-btn copy-btn-secondary copy-btn-sm copy-hot-ignore-btn"
                            onClick={() => handleIgnore(w.wallet_address)}
                            title="Hide this wallet from the discovery list"
                          >
                            Ignore
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

      {/* Ignored wallets footer note */}
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
