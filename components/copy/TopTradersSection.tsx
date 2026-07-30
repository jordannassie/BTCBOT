'use client';

// TopTradersSection — READ-ONLY leaderboard of wallets from tracked_wallets + wallet_metrics.
// No execution buttons. No writes. No trading mutations.
// Data source: GET /api/copy/top-traders

import { useCallback, useEffect, useMemo, useState } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

type TraderRow = {
  tracked_wallet_id:   string;
  wallet_address:      string;
  display_name:        string | null;
  tags:                string[];
  is_active:           boolean;
  copy_score:          number | null;
  wallet_class:        string | null;
  pnl_7d:              number | null;
  pnl_30d:             number | null;
  win_rate:            number | null;
  trade_count:         number | null;
  volume:              number | null;
  avg_hold_minutes:    number | null;
  median_hold_minutes: number | null;
  pct_under_15min:     number | null;
  pct_under_30min:     number | null;
  recent_closed_count: number | null;
  max_drawdown:        number | null;
  category_focus:      string | null;
  last_trade_at:       string | null;
  updated_at:          string | null;
};

type FilterMode = 'all' | 'fast_copy' | 'profitable' | 'avoid';

// ─── Classification badge styles ──────────────────────────────────────────────
// Mirrors the WALLET_CLASS_STYLES from TrackedWalletsSection without modifying that file.

const CLASS_STYLES: Record<string, { bg: string; color: string; border: string; label: string }> = {
  FAST_COPY:       { bg: 'rgba(16,185,129,0.14)',  color: '#34d399', border: 'rgba(16,185,129,0.4)',  label: 'FAST COPY'   },
  CONVICTION_COPY: { bg: 'rgba(59,130,246,0.14)',  color: '#60a5fa', border: 'rgba(59,130,246,0.4)',  label: 'CONVICTION'  },
  MIXED:           { bg: 'rgba(234,179,8,0.12)',   color: '#fbbf24', border: 'rgba(234,179,8,0.35)',  label: 'MIXED'       },
  AVOID:           { bg: 'rgba(239,68,68,0.10)',   color: '#f87171', border: 'rgba(239,68,68,0.30)',  label: 'AVOID'       },
  UNSCORABLE:      { bg: 'rgba(255,255,255,0.04)', color: 'rgba(248,250,252,0.3)', border: 'rgba(255,255,255,0.1)', label: 'UNSCORED' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const truncate = (addr: string) =>
  addr.length > 14 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr;

function fmtCompact(v: number | null | undefined): string {
  if (v == null) return '—';
  const abs = Math.abs(v);
  const prefix = v < 0 ? '-$' : '$';
  if (abs >= 1_000_000) return `${prefix}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `${prefix}${(abs / 1_000).toFixed(1)}K`;
  return `${prefix}${abs.toFixed(2)}`;
}

function fmtPct(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

function fmtHold(minutes: number | null | undefined): string {
  if (minutes == null || minutes === 0) return '—';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function fmtRelative(d: string | null | undefined): string {
  if (!d) return '—';
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function pnlClass(v: number | null | undefined): string {
  if (v == null) return 'copy-td-muted';
  return v >= 0 ? 'copy-num-pos' : 'copy-num-neg';
}

function scoreColorClass(score: number | null | undefined): string {
  if (score == null) return 'copy-score-none';
  if (score >= 70)   return 'copy-score-high';
  if (score >= 40)   return 'copy-score-mid';
  return 'copy-score-low';
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ClassBadge({ cls }: { cls: string | null | undefined }) {
  if (!cls) return <span className="copy-td-muted">—</span>;
  const s = CLASS_STYLES[cls];
  if (!s) {
    return (
      <span className="copy-td-muted copy-mono" style={{ fontSize: '0.68rem' }}>
        {cls}
      </span>
    );
  }
  return (
    <span
      className="copy-class-badge"
      style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}
      title={`wallet_class: ${cls}`}
    >
      {s.label}
    </span>
  );
}

function WinRateCell({ win_rate }: { win_rate: number | null }) {
  if (win_rate == null) return <span className="copy-td-muted">—</span>;
  const pct = win_rate * 100;
  const color = pct >= 55 ? '#34d399' : pct >= 40 ? '#fbbf24' : '#f87171';
  return (
    <div className="copy-winrate">
      <span style={{ color }}>{fmtPct(win_rate)}</span>
      <div className="copy-winrate-bar">
        <div
          className="copy-winrate-fill"
          style={{ width: `${Math.min(100, pct)}%`, background: color }}
        />
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TopTradersSection() {
  const [traders, setTraders] = useState<TraderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterMode>('all');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/copy/top-traders', { cache: 'no-store' });
      const payload = await res.json();
      if (payload.ok) {
        setTraders(payload.rows ?? []);
      } else {
        setError(payload.error ?? 'Failed to load top traders');
      }
    } catch {
      setError('Network error loading top traders');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Listen for the global refresh event fired by the page header Refresh button
  useEffect(() => {
    const onRefresh = () => { setRefreshing(true); load(); };
    window.addEventListener('copy:refresh', onRefresh);
    return () => window.removeEventListener('copy:refresh', onRefresh);
  }, [load]);

  const handleRefresh = () => {
    setRefreshing(true);
    load();
  };

  // ── Filter logic ────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    switch (filter) {
      case 'fast_copy':
        return traders.filter((t) => t.wallet_class === 'FAST_COPY');
      case 'profitable':
        return traders.filter((t) => t.pnl_30d != null && t.pnl_30d > 0);
      case 'avoid':
        return traders.filter((t) => t.wallet_class === 'AVOID');
      default:
        return traders;
    }
  }, [traders, filter]);

  // Count per filter for badges
  const counts = useMemo(() => ({
    all:        traders.length,
    fast_copy:  traders.filter((t) => t.wallet_class === 'FAST_COPY').length,
    profitable: traders.filter((t) => t.pnl_30d != null && t.pnl_30d > 0).length,
    avoid:      traders.filter((t) => t.wallet_class === 'AVOID').length,
  }), [traders]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="copy-section">
      {/* ── Section header ── */}
      <div className="copy-section-head">
        <div className="copy-section-title-row">
          <h2 className="copy-section-title">Top Traders</h2>
          {!loading && traders.length > 0 && (
            <span className="copy-section-count">
              {filter !== 'all' ? `${filtered.length} / ${traders.length}` : traders.length}
            </span>
          )}
        </div>
        <div className="copy-section-actions">
          <button
            className="copy-btn copy-btn-secondary copy-btn-sm"
            onClick={handleRefresh}
            disabled={loading || refreshing}
            title="Refresh top traders"
          >
            {refreshing ? '…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* ── Filter buttons ── */}
      {!loading && traders.length > 0 && (
        <div className="copy-filter-bar" style={{ padding: '0.45rem 1.5rem' }}>
          <button
            className={`copy-filter-btn ${filter === 'all' ? 'copy-filter-btn-active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All
            <span className="copy-filter-count">{counts.all}</span>
          </button>
          <button
            className={`copy-filter-btn ${filter === 'fast_copy' ? 'copy-filter-btn-active' : ''}`}
            onClick={() => setFilter('fast_copy')}
            title="wallet_class = FAST_COPY"
            style={filter === 'fast_copy'
              ? { background: 'rgba(16,185,129,0.12)', color: '#34d399', borderColor: 'rgba(16,185,129,0.35)' }
              : { color: 'rgba(52,211,153,0.65)', borderColor: 'rgba(16,185,129,0.2)' }
            }
          >
            Fast Copy
            {counts.fast_copy > 0 && <span className="copy-filter-count">{counts.fast_copy}</span>}
          </button>
          <button
            className={`copy-filter-btn ${filter === 'profitable' ? 'copy-filter-btn-active' : ''}`}
            onClick={() => setFilter('profitable')}
            title="30-day P&L > $0"
            style={filter === 'profitable'
              ? { background: 'rgba(99,102,241,0.12)', color: '#818cf8', borderColor: 'rgba(99,102,241,0.35)' }
              : {}
            }
          >
            Profitable
            {counts.profitable > 0 && <span className="copy-filter-count">{counts.profitable}</span>}
          </button>
          <button
            className={`copy-filter-btn ${filter === 'avoid' ? 'copy-filter-btn-active' : ''}`}
            onClick={() => setFilter('avoid')}
            title="wallet_class = AVOID"
            style={filter === 'avoid'
              ? { background: 'rgba(239,68,68,0.1)', color: '#f87171', borderColor: 'rgba(239,68,68,0.3)' }
              : { color: 'rgba(248,113,113,0.55)', borderColor: 'rgba(239,68,68,0.15)' }
            }
          >
            Avoid
            {counts.avoid > 0 && <span className="copy-filter-count">{counts.avoid}</span>}
          </button>
        </div>
      )}

      {/* ── States ── */}
      {loading ? (
        <div className="copy-loading">Loading top traders…</div>
      ) : error ? (
        <div className="copy-empty">
          <div className="copy-empty-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </div>
          <p className="copy-empty-title" style={{ color: '#f87171' }}>{error}</p>
          <button className="copy-btn copy-btn-secondary copy-btn-sm" style={{ marginTop: '0.75rem' }} onClick={handleRefresh}>
            Try again
          </button>
        </div>
      ) : traders.length === 0 ? (
        <div className="copy-empty">
          <div className="copy-empty-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          </div>
          <p className="copy-empty-title">No traders found</p>
          <p className="copy-empty-sub">Add wallets in the Wallets tab to start tracking traders.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="copy-filter-empty" style={{ padding: '1.5rem' }}>
          <span>No traders match this filter.</span>
          <button className="copy-filter-empty-reset" onClick={() => setFilter('all')}>
            Show all traders
          </button>
        </div>
      ) : (
        <div className="copy-table-wrap copy-table-scroll">
          <table className="copy-table copy-table-leaderboard" style={{ minWidth: 860 }}>
            <thead>
              <tr>
                <th className="copy-th-rank">#</th>
                <th style={{ minWidth: 200 }}>Trader</th>
                <th style={{ minWidth: 110 }} title="Worker-assigned wallet classification">Classification</th>
                <th style={{ minWidth: 72 }} title="Composite copy score (higher = better)">Copy Score</th>
                <th style={{ minWidth: 96 }} title="30-day profit/loss">30d P&amp;L</th>
                <th style={{ minWidth: 80 }} title="Win rate of closed trades">Win Rate</th>
                <th style={{ minWidth: 76 }} title="Median hold time of closed trades">Median Hold</th>
                <th style={{ minWidth: 68 }} title="Recent closed trade count">Closed Trades</th>
                <th style={{ minWidth: 80 }} title="Maximum drawdown">Drawdown</th>
                <th style={{ minWidth: 90 }} title="Last recorded trade time">Last Active</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t, idx) => (
                <tr key={t.wallet_address}>
                  {/* Rank */}
                  <td className="copy-td-rank">{idx + 1}</td>

                  {/* Trader */}
                  <td>
                    <div className="copy-td-name" style={{ fontWeight: 600, fontSize: '0.82rem', color: '#f8fafc' }}>
                      {t.display_name ?? (
                        <span className="copy-td-muted copy-mono" style={{ fontSize: '0.77rem' }}>
                          {truncate(t.wallet_address)}
                        </span>
                      )}
                    </div>
                    <span className="copy-td-sub copy-mono" title={t.wallet_address}>
                      {truncate(t.wallet_address)}
                    </span>
                    {!t.is_active && (
                      <span
                        className="copy-td-sub"
                        style={{ color: 'rgba(248,250,252,0.2)', fontSize: '0.65rem', marginTop: '0.1rem', display: 'block' }}
                      >
                        inactive
                      </span>
                    )}
                  </td>

                  {/* Classification */}
                  <td>
                    <ClassBadge cls={t.wallet_class} />
                  </td>

                  {/* Copy Score */}
                  <td className="copy-td-num">
                    {t.copy_score != null ? (
                      <span className={`copy-score-badge ${scoreColorClass(t.copy_score)}`}>
                        {t.copy_score.toFixed(1)}
                      </span>
                    ) : (
                      <span className="copy-td-muted">—</span>
                    )}
                  </td>

                  {/* 30d P&L */}
                  <td className={`copy-td-num ${pnlClass(t.pnl_30d)}`}>
                    {fmtCompact(t.pnl_30d)}
                  </td>

                  {/* Win Rate */}
                  <td className="copy-td-num">
                    <WinRateCell win_rate={t.win_rate} />
                  </td>

                  {/* Median Hold */}
                  <td className={`copy-td-num ${t.median_hold_minutes != null && t.median_hold_minutes < 60 ? 'copy-fast-hold' : 'copy-td-muted'}`}>
                    {fmtHold(t.median_hold_minutes)}
                  </td>

                  {/* Closed Trades */}
                  <td className="copy-td-num copy-td-muted">
                    {t.recent_closed_count ?? '—'}
                  </td>

                  {/* Drawdown */}
                  <td className="copy-td-num">
                    {t.max_drawdown != null ? (
                      <span style={{ color: '#f87171' }}>
                        {fmtCompact(t.max_drawdown)}
                      </span>
                    ) : (
                      <span className="copy-td-muted">—</span>
                    )}
                  </td>

                  {/* Last Active */}
                  <td className="copy-td-num copy-td-muted">
                    {fmtRelative(t.last_trade_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Read-only notice ── */}
      {!loading && traders.length > 0 && (
        <div style={{
          padding: '0.6rem 1.5rem',
          fontSize: '0.67rem',
          color: 'rgba(248,250,252,0.2)',
          borderTop: '1px solid rgba(255,255,255,0.04)',
        }}>
          Read-only view · Data from tracked_wallets + wallet_metrics · No trading actions available here
        </div>
      )}
    </div>
  );
}
