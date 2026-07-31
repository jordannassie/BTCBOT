'use client';

// TraderRotationReview — READ-ONLY rotation recommendation panel.
//
// Shown at the top of the Discover Traders tab.
// Data source: GET /api/copy/rotation-review
// No write actions. No bot creation. No trading execution.
//
// Four recommendations: paper_test · keep_active · exit_monitor · turn_off

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getPolymarketProfileUrl } from '@/lib/polymarketProfile';
import SourceAvatar from './SourceAvatar';

// ─── Types ────────────────────────────────────────────────────────────────────

type RotationRec    = 'paper_test' | 'keep_active' | 'exit_monitor' | 'turn_off';
type BotStatus      = 'ACTIVE' | 'EXIT_MONITOR_ONLY' | 'OFF' | 'NO_BOT';
type RotationFilter = 'all' | RotationRec;

type RotationRow = {
  wallet_address:      string;
  display_name:        string | null;
  username:            string | null;
  recommendation:      RotationRec;
  current_status:      BotStatus;
  leaderboard_rank:    number | null;
  leaderboard_pnl:     number | null;
  copy_score:          number | null;
  pnl_30d:             number | null;
  median_hold_minutes: number | null;
  last_trade_at:       string | null;
  open_positions:      number;
  reason:              string;
};

type RotationSummary = {
  paper_test:   number;
  keep_active:  number;
  exit_monitor: number;
  turn_off:     number;
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

function fmtHold(minutes: number | null | undefined): string {
  if (minutes == null || minutes === 0) return '—';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function fmtRelative(d: string | null | undefined): string {
  if (!d) return '—';
  try {
    const diff = Date.now() - new Date(d).getTime();
    if (isNaN(diff)) return '—';
    const mins = Math.floor(diff / 60_000);
    if (mins < 1)  return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  } catch { return '—'; }
}

function pnlClass(v: number | null | undefined): string {
  if (v == null) return 'copy-td-muted';
  return v >= 0 ? 'copy-num-pos' : 'copy-num-neg';
}

// ─── Badge sub-components ─────────────────────────────────────────────────────

const REC_STYLES: Record<RotationRec, { bg: string; color: string; border: string; label: string }> = {
  paper_test:   { bg: 'rgba(99,102,241,0.12)',  color: '#818cf8', border: 'rgba(99,102,241,0.3)',  label: 'PAPER TEST'   },
  keep_active:  { bg: 'rgba(16,185,129,0.12)',  color: '#34d399', border: 'rgba(16,185,129,0.3)',  label: 'KEEP ACTIVE'  },
  exit_monitor: { bg: 'rgba(234,179,8,0.12)',   color: '#fbbf24', border: 'rgba(234,179,8,0.3)',   label: 'EXIT MONITOR' },
  turn_off:     { bg: 'rgba(239,68,68,0.10)',   color: '#f87171', border: 'rgba(239,68,68,0.25)',  label: 'TURN OFF'     },
};

function RecBadge({ rec }: { rec: RotationRec }) {
  const s = REC_STYLES[rec];
  return (
    <span className="copy-badge" style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}`, fontSize: '0.62rem', whiteSpace: 'nowrap' }}>
      {s.label}
    </span>
  );
}

function CurrStatusBadge({ status }: { status: BotStatus }) {
  if (status === 'NO_BOT')            return <span className="copy-badge copy-badge-disabled"  style={{ fontSize: '0.62rem' }}>NO BOT</span>;
  if (status === 'OFF')               return <span className="copy-badge copy-badge-disabled"  style={{ fontSize: '0.62rem' }}>OFF</span>;
  if (status === 'EXIT_MONITOR_ONLY') return <span className="copy-badge copy-badge-arm-live" style={{ fontSize: '0.62rem', whiteSpace: 'nowrap' }}>EXIT MONITOR</span>;
  return <span className="copy-badge copy-badge-enabled" style={{ fontSize: '0.62rem' }}>ACTIVE</span>;
}

// ─── Summary card config ──────────────────────────────────────────────────────

const CARD_CONFIG: readonly { key: RotationRec; label: string; color: string; bg: string; border: string }[] = [
  { key: 'paper_test',   label: 'Add to Paper Test',  color: '#818cf8', bg: 'rgba(99,102,241,0.08)',  border: 'rgba(99,102,241,0.2)'  },
  { key: 'keep_active',  label: 'Keep Active',         color: '#34d399', bg: 'rgba(16,185,129,0.08)',  border: 'rgba(16,185,129,0.2)'  },
  { key: 'exit_monitor', label: 'Exit Monitor Only',   color: '#fbbf24', bg: 'rgba(234,179,8,0.08)',   border: 'rgba(234,179,8,0.2)'   },
  { key: 'turn_off',     label: 'Ready to Turn Off',   color: '#f87171', bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.2)'   },
] as const;

// ─── Main component ───────────────────────────────────────────────────────────

export default function TraderRotationReview() {
  const [rows,    setRows]    = useState<RotationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [summary, setSummary] = useState<RotationSummary | null>(null);
  const [filter,  setFilter]  = useState<RotationFilter>('all');
  const [isOpen,        setIsOpen]        = useState(true);
  // FastLoop snapshot metadata
  const [stale,         setStale]         = useState(false);
  const [source,        setSource]        = useState<string | null>(null);
  const [generatedAt,   setGeneratedAt]   = useState<string | null>(null);
  const [version,       setVersion]       = useState<number | null>(null);
  const [noSnapshot,    setNoSnapshot]    = useState(false);
  const [noSnapshotMsg, setNoSnapshotMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res     = await fetch('/api/copy/rotation-review', { cache: 'no-store' });
      const payload = await res.json();
      if (payload.ok) {
        setRows(payload.rows        ?? []);
        setSummary(payload.summary  ?? null);
        setStale(payload.stale      ?? false);
        setSource(payload.source    ?? null);
        setGeneratedAt(payload.generated_at ?? null);
        setVersion(payload.version  ?? null);
        setNoSnapshot(payload.no_snapshot   ?? false);
        setNoSnapshotMsg(payload.message    ?? null);
      } else {
        setError(payload.error ?? 'Failed to load rotation review');
      }
    } catch {
      setError('Network error loading rotation review');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Refresh when the page-level refresh event fires
  useEffect(() => {
    const onRefresh = () => { setLoading(true); load(); };
    window.addEventListener('copy:refresh', onRefresh);
    return () => window.removeEventListener('copy:refresh', onRefresh);
  }, [load]);

  const filteredRows = useMemo(() => {
    if (filter === 'all') return rows;
    return rows.filter((r) => r.recommendation === filter);
  }, [rows, filter]);

  const total = summary
    ? summary.paper_test + summary.keep_active + summary.exit_monitor + summary.turn_off
    : 0;

  // Filter pill definitions (built at render time so counts stay reactive)
  const filterPills: { key: RotationFilter; label: string; count: number }[] = [
    { key: 'all',          label: 'All',          count: rows.length              },
    { key: 'paper_test',   label: 'Paper Test',   count: summary?.paper_test   ?? 0 },
    { key: 'keep_active',  label: 'Keep Active',  count: summary?.keep_active  ?? 0 },
    { key: 'exit_monitor', label: 'Exit Monitor', count: summary?.exit_monitor ?? 0 },
    { key: 'turn_off',     label: 'Turn Off',     count: summary?.turn_off     ?? 0 },
  ];

  return (
    <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>

      {/* ── Collapsible header ── */}
      <div
        style={{ padding: '0.65rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setIsOpen((v) => !v)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#f8fafc' }}>Trader Rotation Review</span>
          <span style={{ fontSize: '0.55rem', fontWeight: 800, padding: '0.1em 0.5em', borderRadius: '0.3rem', background: 'rgba(16,185,129,0.1)', color: '#34d399', border: '1px solid rgba(16,185,129,0.2)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            Read Only
          </span>
          {!loading && total > 0 && (
            <span style={{ fontSize: '0.65rem', color: 'rgba(248,250,252,0.3)' }}>
              {total} traders reviewed
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <button
            className="copy-btn copy-btn-secondary copy-btn-sm"
            onClick={(e) => { e.stopPropagation(); setLoading(true); load(); }}
            disabled={loading}
            title="Refresh rotation review"
            style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem' }}
          >
            {loading ? '…' : '↻'}
          </button>
          <span style={{ fontSize: '0.65rem', color: 'rgba(248,250,252,0.25)' }}>{isOpen ? '▲' : '▼'}</span>
        </div>
      </div>

      {isOpen && (
        <div>

          {/* ── Stale warning ── */}
          {!loading && stale && (
            <div style={{ margin: '0 1.5rem 0.6rem', padding: '0.5rem 0.85rem', background: 'rgba(234,179,8,0.07)', border: '1px solid rgba(234,179,8,0.25)', borderRadius: '0.5rem', fontSize: '0.75rem', color: '#fbbf24' }}>
              ⚠ This rotation review is more than 12 hours old. Wait for FastLoop to refresh before making changes.
            </div>
          )}

          {/* ── FastLoop source status line ── */}
          {!loading && generatedAt && (
            <div style={{ padding: '0 1.5rem 0.55rem', display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', fontSize: '0.68rem', color: 'rgba(248,250,252,0.35)' }}>
              <span>Generated: {fmtRelative(generatedAt)}</span>
              <span style={{ width: 1, height: 10, background: 'rgba(255,255,255,0.1)', display: 'inline-block' }} />
              <span>Source: <span style={{ color: '#818cf8', fontWeight: 700 }}>{source ?? 'FASTLOOP'}</span></span>
              <span style={{ width: 1, height: 10, background: 'rgba(255,255,255,0.1)', display: 'inline-block' }} />
              <span>Status: <span style={{ color: stale ? '#fbbf24' : '#34d399', fontWeight: 700 }}>{stale ? 'STALE' : 'FRESH'}</span></span>
              {version != null && (
                <>
                  <span style={{ width: 1, height: 10, background: 'rgba(255,255,255,0.1)', display: 'inline-block' }} />
                  <span style={{ color: 'rgba(248,250,252,0.2)' }}>v{version}</span>
                </>
              )}
            </div>
          )}

          {/* ── Summary cards ── */}
          {!loading && summary && (
            <div style={{ display: 'flex', gap: '0.55rem', padding: '0 1.5rem 0.7rem', flexWrap: 'wrap' }}>
              {CARD_CONFIG.map(({ key, label, color, bg, border }) => {
                const count  = summary[key];
                const active = filter === key;
                return (
                  <button
                    key={key}
                    onClick={() => setFilter(active ? 'all' : key)}
                    style={{
                      background:   active ? bg    : 'rgba(255,255,255,0.03)',
                      border:       `1px solid ${active ? border : 'rgba(255,255,255,0.07)'}`,
                      borderRadius: '0.5rem',
                      padding:      '0.4rem 0.85rem',
                      cursor:       'pointer',
                      textAlign:    'left',
                      minWidth:     118,
                    }}
                  >
                    <div style={{ fontSize: '1.15rem', fontWeight: 700, color: active ? color : '#f8fafc', lineHeight: 1.1 }}>
                      {count}
                    </div>
                    <div style={{ fontSize: '0.63rem', color: active ? color : 'rgba(248,250,252,0.38)', marginTop: '0.12rem', whiteSpace: 'nowrap' }}>
                      {label}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* ── Filter pills ── */}
          {!loading && rows.length > 0 && (
            <div style={{ display: 'flex', gap: '0.35rem', padding: '0 1.5rem 0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.6rem', fontWeight: 700, color: 'rgba(248,250,252,0.25)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Filter
              </span>
              {filterPills.map(({ key, label, count }) => (
                <button
                  key={key}
                  className={`copy-filter-btn ${filter === key ? 'copy-filter-btn-active' : ''}`}
                  onClick={() => setFilter(key)}
                  style={{ fontSize: '0.7rem', padding: '0.18rem 0.6rem' }}
                >
                  {label}
                  {count > 0 && <span className="copy-filter-count">{count}</span>}
                </button>
              ))}
            </div>
          )}

          {/* ── Table / States ── */}
          {loading ? (
            <div className="copy-loading" style={{ padding: '1rem 1.5rem' }}>Loading rotation review…</div>
          ) : error ? (
            <div style={{ padding: '0.75rem 1.5rem', fontSize: '0.78rem', color: '#f87171', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span>⚠ {error}</span>
              <button className="copy-btn copy-btn-secondary copy-btn-sm" onClick={() => { setLoading(true); load(); }}>
                Retry
              </button>
            </div>
          ) : rows.length === 0 ? (
            <div style={{ padding: '1rem 1.5rem', fontSize: '0.78rem', color: 'rgba(248,250,252,0.35)' }}>
              {noSnapshot
                ? (noSnapshotMsg ?? 'FastLoop has not published a rotation review yet.')
                : 'No rotation recommendations available in the current snapshot.'}
            </div>
          ) : filteredRows.length === 0 ? (
            <div style={{ padding: '0.75rem 1.5rem', fontSize: '0.75rem', color: 'rgba(248,250,252,0.3)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              No traders in this category.
              <button className="copy-filter-empty-reset" onClick={() => setFilter('all')}>Show all</button>
            </div>
          ) : (
            <div className="copy-table-wrap copy-table-scroll">
              <table className="copy-table" style={{ minWidth: 1080 }}>
                <thead>
                  <tr>
                    <th className="copy-th-rank">#</th>
                    <th style={{ minWidth: 170 }}>Trader</th>
                    <th style={{ minWidth: 108 }} title="Current bot status">Current Status</th>
                    <th style={{ minWidth: 112 }}>Recommendation</th>
                    <th style={{ minWidth: 72 }} title="Monthly leaderboard rank">Leaderboard</th>
                    <th style={{ minWidth: 72 }} title="Composite copy score from wallet_metrics">Copy Score</th>
                    <th style={{ minWidth: 88 }} title="30-day P&L from Supabase or leaderboard">30d P&amp;L</th>
                    <th style={{ minWidth: 78 }} title="Median hold time from wallet_metrics">Med. Hold</th>
                    <th style={{ minWidth: 84 }} title="Last recorded trade">Last Active</th>
                    <th style={{ minWidth: 70 }} title="Count of open copied positions for this wallet">Open Pos.</th>
                    <th style={{ minWidth: 180 }}>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((r, idx) => (
                    <tr key={r.wallet_address}>
                      <td className="copy-td-rank">{idx + 1}</td>

                      {/* Trader — avatar + name + address link to Polymarket profile */}
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                          <SourceAvatar sourceType="COPY_TRADER" name={r.display_name ?? undefined} size={28} style={{ flexShrink: 0 }} />
                          <div>
                        <div style={{ fontWeight: 600, fontSize: '0.8rem', color: '#f8fafc' }}>
                          <a
                            href={getPolymarketProfileUrl(r.username, r.wallet_address) ?? '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: 'inherit', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}
                          >
                            {r.display_name ?? (
                              <span className="copy-mono" style={{ fontSize: '0.72rem' }}>{truncate(r.wallet_address)}</span>
                            )}
                            <span style={{ fontSize: '0.55rem', opacity: 0.4 }}>↗</span>
                          </a>
                        </div>
                        <a
                          href={getPolymarketProfileUrl(null, r.wallet_address) ?? '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ textDecoration: 'none' }}
                        >
                          <span className="copy-td-sub copy-mono" title={r.wallet_address} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.12rem' }}>
                            {truncate(r.wallet_address)}
                            <span style={{ fontSize: '0.5rem', opacity: 0.3 }}>↗</span>
                          </span>
                        </a>
                          </div>
                        </div>
                      </td>

                      {/* Current Status */}
                      <td><CurrStatusBadge status={r.current_status} /></td>

                      {/* Recommendation */}
                      <td><RecBadge rec={r.recommendation} /></td>

                      {/* Leaderboard rank */}
                      <td className="copy-td-num copy-td-muted">
                        {r.leaderboard_rank != null ? `#${r.leaderboard_rank}` : '—'}
                      </td>

                      {/* Copy Score */}
                      <td className="copy-td-num">
                        {r.copy_score != null ? (
                          <span style={{
                            color: r.copy_score >= 70 ? '#34d399' : r.copy_score >= 40 ? '#fbbf24' : '#f87171',
                            fontWeight: 600, fontSize: '0.82rem',
                          }}>
                            {r.copy_score.toFixed(1)}
                          </span>
                        ) : <span className="copy-td-muted">—</span>}
                      </td>

                      {/* 30d P&L — prefer Supabase pnl_30d, fall back to leaderboard PNL */}
                      <td className={`copy-td-num ${pnlClass(r.pnl_30d ?? r.leaderboard_pnl)}`}>
                        {fmtCompact(r.pnl_30d ?? r.leaderboard_pnl)}
                      </td>

                      {/* Median Hold */}
                      <td className="copy-td-num copy-td-muted">
                        {fmtHold(r.median_hold_minutes)}
                      </td>

                      {/* Last Active */}
                      <td className="copy-td-num copy-td-muted" style={{ fontSize: '0.72rem' }}>
                        {fmtRelative(r.last_trade_at)}
                      </td>

                      {/* Open Positions */}
                      <td className="copy-td-num">
                        {r.open_positions > 0 ? (
                          <span style={{ color: '#fbbf24', fontWeight: 600 }}>{r.open_positions}</span>
                        ) : (
                          <span className="copy-td-muted">0</span>
                        )}
                      </td>

                      {/* Reason */}
                      <td style={{ fontSize: '0.72rem', color: 'rgba(248,250,252,0.45)', maxWidth: 200 }}>
                        {r.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Read-only notice ── */}
          <div style={{ padding: '0.45rem 1.5rem', fontSize: '0.65rem', color: 'rgba(248,250,252,0.2)', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
            Review only. No traders or bots are changed automatically.
          </div>

        </div>
      )}
    </div>
  );
}
