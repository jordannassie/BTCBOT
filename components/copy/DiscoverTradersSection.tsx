'use client';

// DiscoverTradersSection — Polymarket leaderboard discovery view.
//
// Data source: GET /api/copy/discover-traders?period=daily|weekly|monthly
// Fetches Polymarket's public leaderboard and cross-references tracked_wallets.
// "Add Paper Bot" action creates a single disabled PAPER bot for a row (no live bots,
// no ARM LIVE, no auto-enable, no positions touched).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getPolymarketProfileUrl } from '@/lib/polymarketProfile';
import SourceAvatar from './SourceAvatar';
import TraderRotationReview from './TraderRotationReview';
import dynamic from 'next/dynamic';

const FreshPaperSeasonModal = dynamic(() => import('./FreshPaperSeasonModal'), { ssr: false });

// ─── Types ────────────────────────────────────────────────────────────────────

type Period = 'daily' | 'weekly' | 'monthly';
type FilterMode = 'all' | 'daily' | 'weekly' | 'monthly' | 'new';

type DiscoverRow = {
  rank:           number;
  wallet_address: string;
  display_name:   string | null;
  username:       string | null;   // Polymarket xUsername (for @-style profile links)
  verified_badge: boolean;
  period:         string;
  pnl:            number | null;
  volume:         number | null;
  is_tracked:     boolean;
  tracked_since:  string | null;
  last_seen:      string | null;
};

type ApiResponse = {
  ok:                boolean;
  rows?:             DiscoverRow[];
  period?:           string;
  leaderboard_error?: string | null;
  total?:            number;
  tracked_count?:    number;
  fetched_at?:       string;
  error?:            string;
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
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '—';
  }
}

function pnlClass(v: number | null | undefined): string {
  if (v == null) return 'copy-td-muted';
  return v >= 0 ? 'copy-num-pos' : 'copy-num-neg';
}

const PERIOD_LABELS: Record<string, string> = {
  daily:   'Daily',
  weekly:  'Weekly',
  monthly: 'Monthly',
};

// ─── Main component ───────────────────────────────────────────────────────────

export default function DiscoverTradersSection() {
  const [showFreshModal, setShowFreshModal] = useState(false);
  const [freshModalMode, setFreshModalMode] = useState<'replace' | 'add'>('replace');

  // Fetch state
  const [rows, setRows] = useState<DiscoverRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lbError, setLbError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  // Add Paper Bot per-row state
  const [addConfirmRow, setAddConfirmRow] = useState<DiscoverRow | null>(null);
  const [addingWallet, setAddingWallet]   = useState<string | null>(null);
  const [addedWallets, setAddedWallets]   = useState<Set<string>>(new Set());
  const [addError, setAddError]           = useState<string | null>(null);

  // Period — which leaderboard window to load
  const [period, setPeriod] = useState<Period>('monthly');

  // Filter — which rows to show
  const [filter, setFilter] = useState<FilterMode>('all');

  // ── Fetch ─────────────────────────────────────────────────────────────────

  const load = useCallback(async (p: Period) => {
    setError(null);
    setLbError(null);
    try {
      const res = await fetch(`/api/copy/discover-traders?period=${p}`, { cache: 'no-store' });
      const payload: ApiResponse = await res.json();

      if (!payload.ok) {
        setError(payload.error ?? 'Failed to load discovery data');
        setRows([]);
      } else {
        setRows(payload.rows ?? []);
        if (payload.leaderboard_error) setLbError(payload.leaderboard_error);
        if (payload.fetched_at) setFetchedAt(payload.fetched_at);
      }
    } catch {
      setError('Network error loading discovery data');
      setRows([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Load on mount and when period changes
  useEffect(() => {
    setLoading(true);
    load(period);
  }, [period, load]);

  // Listen for global refresh event
  useEffect(() => {
    const onRefresh = () => { setRefreshing(true); load(period); };
    window.addEventListener('copy:refresh', onRefresh);
    return () => window.removeEventListener('copy:refresh', onRefresh);
  }, [period, load]);

  const handleRefresh = () => {
    setRefreshing(true);
    load(period);
  };

  // ── Add Paper Bot handler ─────────────────────────────────────────────────

  async function confirmAddBot(row: DiscoverRow) {
    setAddConfirmRow(null);
    setAddingWallet(row.wallet_address);
    setAddError(null);
    try {
      const res = await fetch('/api/copy/add-paper-bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          wallet_address: row.wallet_address,
          display_name:   row.display_name,
          sizing_value:   0.10,
          max_trade_size: 0.10,
        }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Failed to add bot');
      setAddedWallets((prev) => new Set([...prev, row.wallet_address.toLowerCase()]));
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Failed to add bot');
    } finally {
      setAddingWallet(null);
    }
  }

  const changePeriod = (p: Period) => {
    setPeriod(p);
    // filter stays (unless it's period-specific — reset to 'all' on period switch)
    setFilter('all');
  };

  // ── Filtered rows ─────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    if (filter === 'new') return rows.filter((r) => !r.is_tracked);
    // daily / weekly / monthly filter just changes the loaded period, not client filter
    return rows;
  }, [rows, filter]);

  const newCount = useMemo(() => rows.filter((r) => !r.is_tracked).length, [rows]);
  const trackedCount = useMemo(() => rows.filter((r) => r.is_tracked).length, [rows]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="copy-section">

      {/* Fresh Paper Season modal (lazy-loaded) */}
      {showFreshModal && (
        <FreshPaperSeasonModal
          addMode={freshModalMode === 'add'}
          onClose={() => setShowFreshModal(false)}
        />
      )}

      {/* ── Section header ── */}
      <div className="copy-section-head">
        <div className="copy-section-title-row">
          <h2 className="copy-section-title">Discover Traders</h2>
          {!loading && rows.length > 0 && (
            <span className="copy-section-count">
              {filter === 'new' ? `${filtered.length} new / ${rows.length}` : rows.length}
            </span>
          )}
          {/* Live leaderboard badge */}
          <span
            style={{
              fontSize: '0.58rem', fontWeight: 800, letterSpacing: '0.08em',
              padding: '0.15em 0.55em', borderRadius: '0.35rem',
              background: 'rgba(99,102,241,0.1)', color: '#818cf8',
              border: '1px solid rgba(99,102,241,0.25)',
              textTransform: 'uppercase',
            }}
          >
            Polymarket
          </span>
        </div>
        <div className="copy-section-actions">
          <button
            className="copy-btn copy-btn-secondary copy-btn-sm"
            onClick={handleRefresh}
            disabled={loading || refreshing}
            title="Reload from Polymarket leaderboard"
          >
            {refreshing ? '…' : '↻ Refresh'}
          </button>
          <button
            className="copy-btn copy-btn-secondary copy-btn-sm"
            onClick={() => { setFreshModalMode('add'); setShowFreshModal(true); }}
            title="Add more paper traders without resetting existing bots or positions"
            style={{ whiteSpace: 'nowrap' }}
          >
            + Add Paper Traders
          </button>
          <button
            className="copy-btn copy-btn-primary copy-btn-sm"
            onClick={() => { setFreshModalMode('replace'); setShowFreshModal(true); }}
            title="Replace all current bots with fresh paper traders from this leaderboard"
            style={{ whiteSpace: 'nowrap' }}
          >
            ⚡ Replace Old Traders
          </button>
        </div>
      </div>

      {/* ── Trader Rotation Review ── */}
      <TraderRotationReview />

      {/* ── Period selector + filter bar ── */}
      {!loading && (
        <div className="copy-filter-bar" style={{ padding: '0.55rem 1.5rem', gap: '0.5rem', flexWrap: 'wrap', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
          {/* Period buttons */}
          <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'rgba(248,250,252,0.3)', textTransform: 'uppercase', letterSpacing: '0.08em', alignSelf: 'center' }}>
            Period
          </span>
          {(['daily', 'weekly', 'monthly'] as Period[]).map((p) => (
            <button
              key={p}
              className={`copy-filter-btn ${period === p && filter !== 'new' ? 'copy-filter-btn-active' : ''}`}
              onClick={() => { changePeriod(p); setFilter(p as FilterMode); }}
              style={period === p && filter !== 'new' ? { background: 'rgba(99,102,241,0.12)', color: '#818cf8', borderColor: 'rgba(99,102,241,0.35)' } : {}}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}

          {/* Separator */}
          <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.08)', margin: '0 0.25rem', alignSelf: 'center' }} />

          {/* New Only */}
          <button
            className={`copy-filter-btn ${filter === 'new' ? 'copy-filter-btn-active' : ''}`}
            onClick={() => setFilter(filter === 'new' ? 'all' : 'new')}
            title="Show only traders not yet in your tracked wallets"
            style={filter === 'new' ? { background: 'rgba(16,185,129,0.12)', color: '#34d399', borderColor: 'rgba(16,185,129,0.35)' } : { color: 'rgba(52,211,153,0.6)', borderColor: 'rgba(16,185,129,0.18)' }}
          >
            New Only
            {newCount > 0 && <span className="copy-filter-count">{newCount}</span>}
          </button>

          {/* Tracked count chip */}
          {trackedCount > 0 && (
            <span style={{ fontSize: '0.68rem', color: 'rgba(248,250,252,0.25)', marginLeft: 'auto', alignSelf: 'center' }}>
              {trackedCount} already tracked
            </span>
          )}
        </div>
      )}

      {/* ── Leaderboard warning ── */}
      {lbError && !loading && (
        <div style={{ margin: '0.5rem 1.5rem', padding: '0.5rem 0.9rem', background: 'rgba(234,179,8,0.06)', border: '1px solid rgba(234,179,8,0.2)', borderRadius: '0.5rem', fontSize: '0.75rem', color: '#fbbf24' }}>
          ⚠ Polymarket leaderboard unavailable: {lbError}
        </div>
      )}

      {/* ── States ── */}
      {loading ? (
        <div className="copy-loading">Loading {PERIOD_LABELS[period]?.toLowerCase()} leaderboard…</div>
      ) : error ? (
        <div className="copy-empty">
          <div className="copy-empty-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </div>
          <p className="copy-empty-title" style={{ color: '#f87171' }}>{error}</p>
          <button className="copy-btn copy-btn-secondary copy-btn-sm" style={{ marginTop: '0.75rem' }} onClick={handleRefresh}>
            Try again
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="copy-empty">
          <div className="copy-empty-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </div>
          <p className="copy-empty-title">No traders found</p>
          <p className="copy-empty-sub">The Polymarket {PERIOD_LABELS[period]?.toLowerCase()} leaderboard returned no results. Try a different period or refresh.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="copy-filter-empty" style={{ padding: '1.5rem' }}>
          <span>No new (untracked) traders in this leaderboard.</span>
          <button className="copy-filter-empty-reset" onClick={() => setFilter('all')}>Show all traders</button>
        </div>
      ) : (
        <div className="copy-table-wrap copy-table-scroll">
          <table className="copy-table" style={{ minWidth: 820 }}>
            <thead>
              <tr>
                <th className="copy-th-rank">#</th>
                <th style={{ minWidth: 190 }}>Trader</th>
                <th style={{ minWidth: 130 }}>Wallet</th>
                <th style={{ minWidth: 80 }}>Period</th>
                <th style={{ minWidth: 70 }} title="Leaderboard rank (1 = top)">LB Rank</th>
                <th style={{ minWidth: 96 }} title="Profit/loss for this period">LB P&amp;L</th>
                <th style={{ minWidth: 90 }} title="Trading volume for this period">LB Volume</th>
                <th style={{ minWidth: 100 }}>Already Tracked</th>
                <th style={{ minWidth: 100 }} title="When this wallet was added to tracked_wallets">Discovery Time</th>
                <th style={{ minWidth: 90 }} title="Last activity seen on Polymarket">Last Seen</th>
                <th style={{ minWidth: 110 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, idx) => (
                <tr
                  key={row.wallet_address}
                  style={row.is_tracked ? { borderLeft: '2px solid rgba(52,211,153,0.35)' } : undefined}
                >
                  {/* Row # (position in filtered list) */}
                  <td className="copy-td-rank">{idx + 1}</td>

                  {/* Trader — avatar + links to Polymarket profile */}
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                      <SourceAvatar sourceType="COPY_TRADER" name={row.display_name ?? undefined} size={28} style={{ flexShrink: 0 }} />
                      <div>
                    {row.display_name ? (
                      <div style={{ fontWeight: 600, fontSize: '0.82rem', color: '#f8fafc' }}>
                        <a
                          href={getPolymarketProfileUrl(row.username, row.wallet_address) ?? '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: 'inherit', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                        >
                          {row.display_name}
                          <span style={{ fontSize: '0.6rem', opacity: 0.4 }}>↗</span>
                        </a>
                      </div>
                    ) : (
                      <span className="copy-td-muted" style={{ fontSize: '0.75rem' }}>—</span>
                    )}
                      </div>
                    </div>
                  </td>

                  {/* Wallet address — links to Polymarket @wallet profile */}
                  <td>
                    <a
                      href={getPolymarketProfileUrl(null, row.wallet_address) ?? '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={row.wallet_address}
                      style={{ color: 'inherit', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}
                    >
                      <span className="copy-mono copy-td-muted">{truncate(row.wallet_address)}</span>
                      <span style={{ fontSize: '0.6rem', opacity: 0.35 }}>↗</span>
                    </a>
                  </td>

                  {/* Source period */}
                  <td>
                    <span
                      className="copy-badge"
                      style={{
                        background: 'rgba(99,102,241,0.08)',
                        color: '#818cf8',
                        border: '1px solid rgba(99,102,241,0.2)',
                        fontSize: '0.62rem',
                      }}
                    >
                      {PERIOD_LABELS[row.period] ?? row.period}
                    </span>
                  </td>

                  {/* Leaderboard rank */}
                  <td className="copy-td-num copy-td-muted">
                    #{row.rank}
                  </td>

                  {/* Leaderboard P&L */}
                  <td className={`copy-td-num ${pnlClass(row.pnl)}`}>
                    {fmtCompact(row.pnl)}
                  </td>

                  {/* Leaderboard Volume */}
                  <td className="copy-td-num copy-td-muted">
                    {fmtCompact(row.volume)}
                  </td>

                  {/* Already Tracked */}
                  <td>
                    {row.is_tracked ? (
                      <span className="copy-badge copy-badge-enabled">✓ Tracked</span>
                    ) : (
                      <span className="copy-badge copy-badge-disabled">New</span>
                    )}
                  </td>

                  {/* Discovery Time */}
                  <td className="copy-td-muted copy-td-num" style={{ fontSize: '0.75rem' }}>
                    {row.tracked_since ? fmtRelative(row.tracked_since) : '—'}
                  </td>

                  {/* Last Seen */}
                  <td className="copy-td-muted copy-td-num" style={{ fontSize: '0.75rem' }}>
                    {fmtRelative(row.last_seen)}
                  </td>

                  {/* Actions — Add Paper Bot */}
                  <td>
                    {addedWallets.has(row.wallet_address.toLowerCase()) ? (
                      <span className="copy-badge copy-badge-enabled" style={{ fontSize: '0.68rem' }}>✓ Bot Added</span>
                    ) : addingWallet === row.wallet_address ? (
                      <span style={{ fontSize: '0.72rem', color: 'rgba(248,250,252,0.4)' }}>Adding…</span>
                    ) : (
                      <button
                        className="copy-btn copy-btn-secondary copy-btn-sm"
                        style={{ fontSize: '0.68rem', padding: '0.2rem 0.5rem', whiteSpace: 'nowrap' }}
                        onClick={() => { setAddError(null); setAddConfirmRow(row); }}
                        title={`Add ${row.display_name ?? truncate(row.wallet_address)} as a disabled PAPER bot`}
                      >
                        + Paper Bot
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Add Paper Bot confirm modal ── */}
      {addConfirmRow && (
        <div className="copy-modal-backdrop" onClick={() => setAddConfirmRow(null)}>
          <div className="copy-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <h3 className="copy-modal-title">Add Paper Bot</h3>
            <div style={{ fontSize: '0.82rem', color: 'rgba(248,250,252,0.6)', marginBottom: '1rem', lineHeight: 1.6 }}>
              <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#f8fafc', marginBottom: '0.5rem' }}>
                {addConfirmRow.display_name ?? truncate(addConfirmRow.wallet_address)}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.2rem 0.8rem', fontSize: '0.78rem' }}>
                <span style={{ color: 'rgba(248,250,252,0.4)' }}>Mode:</span>        <span>PAPER</span>
                <span style={{ color: 'rgba(248,250,252,0.4)' }}>Trade size:</span> <span>$0.10</span>
                <span style={{ color: 'rgba(248,250,252,0.4)' }}>LIVE:</span>       <span style={{ color: '#6b7280' }}>OFF</span>
                <span style={{ color: 'rgba(248,250,252,0.4)' }}>ARM LIVE:</span>  <span style={{ color: '#6b7280' }}>OFF</span>
                <span style={{ color: 'rgba(248,250,252,0.4)' }}>Enabled:</span>   <span style={{ color: '#6b7280' }}>OFF (manual)</span>
              </div>
              <div style={{ marginTop: '0.75rem', fontSize: '0.72rem', color: 'rgba(248,250,252,0.35)' }}>
                Bot will be created but disabled. Turn New Entries ON separately to start copying.
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
              <button className="copy-btn copy-btn-secondary copy-btn-sm" onClick={() => setAddConfirmRow(null)}>Cancel</button>
              <button className="copy-btn copy-btn-primary copy-btn-sm" onClick={() => confirmAddBot(addConfirmRow)}>
                ADD {(addConfirmRow.display_name ?? 'TRADER').toUpperCase()} PAPER BOT
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add error banner ── */}
      {addError && (
        <div style={{ margin: '0.4rem 1.5rem', padding: '0.45rem 0.9rem', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '0.45rem', fontSize: '0.76rem', color: '#f87171', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
          <span>⚠ {addError}</span>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f87171', fontSize: '0.9rem' }} onClick={() => setAddError(null)}>×</button>
        </div>
      )}

      {/* ── Footer: read-only notice + fetch metadata ── */}
      <div style={{
        padding: '0.6rem 1.5rem',
        fontSize: '0.67rem',
        color: 'rgba(248,250,252,0.2)',
        borderTop: rows.length > 0 ? '1px solid rgba(255,255,255,0.04)' : undefined,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem',
        flexWrap: 'wrap',
      }}>
        <span>
          Read-only discovery list. No traders are copied automatically.
        </span>
        {fetchedAt && (
          <span>
            Fetched {fmtRelative(fetchedAt)} · Source: Polymarket leaderboard
          </span>
        )}
      </div>
    </div>
  );
}
