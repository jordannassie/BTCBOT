'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import TraderCell from '@/components/copy/TraderCell';

const POLL_MS = 15_000;

type CopyAttempt = {
  id: string;
  copy_bot_id: string;
  wallet_address: string;
  display_name: string | null;
  source_trade_id: string;
  market_slug: string | null;
  market_title: string | null;
  token_id: string | null;
  source_side: string | null;
  source_outcome: string | null;
  source_price: number | null;
  source_size: number | null;
  submitted_price: number | null;
  submitted_size: number | null;
  copied: boolean;
  skip_reason: string | null;
  order_status: string | null;
  latency_ms: number | null;
  slippage: number | null;
  created_at: string;
};

type BotMap = Record<string, { mode: 'PAPER' | 'LIVE'; name: string }>;

type AttemptTab = 'ALL' | 'LIVE' | 'PAPER' | 'COPIED' | 'SKIPPED' | 'FAILED';

const truncateTradeId = (id: string | null) =>
  !id ? '—' : id.length > 16 ? `${id.slice(0, 12)}…` : id;
const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

// ── Skip reason helpers ──────────────────────────────────────────────────────
// Maps raw worker skip_reason strings to readable UI labels.
// The raw value is preserved in the title tooltip so operators can still
// search logs by the exact tag.

const SKIP_REASON_LABELS: Record<string, string> = {
  // Phase 3 fast-copy gates
  market_blocked:              'Blocked Market',
  market_not_fast:             'Not Fast Market',
  missing_fast_metrics:        'Missing Metrics',
  wallet_unscorable:           'Wallet Unscorable',
  wallet_not_fast_copy:        'Not Fast Copy',
  entry_too_late:              'Entry Too Late',
  // Pre-existing gates
  closes_not_enabled:          'Closes Disabled',
  copy_closes_disabled:        'Closes Disabled',
  emergency_stop_active:       'Emergency Stop',
  insufficient_funds:          'Insufficient Funds',
  position_limit:              'Position Limit',
  market_not_found:            'Market Not Found',
  already_copied:              'Already Copied',
  live_mode_not_supported_yet: 'Live Not Supported',
  exposure_cap:                'Exposure Cap',
  size_too_small:              'Size Too Small',
  no_market_id:                'No Market ID',
  price_missing:               'No Price',
};

function skipReasonLabel(reason: string | null): string {
  if (!reason) return '—';
  return SKIP_REASON_LABELS[reason] ?? reason.replace(/_/g, ' ');
}

// Badge colour by reason category:
//   yellow  → market type / timing filter (G8, G9, G13)
//   purple  → wallet scoring / fast-copy gate (G10, G11, G12)
//   red     → safety stops (emergency stop, exposure cap)
//   gray    → other (dedup, closes disabled, etc.)
function skipReasonBadgeClass(reason: string | null): string {
  if (!reason) return 'copy-badge-gray';
  if (['market_blocked', 'market_not_fast', 'entry_too_late'].includes(reason))
    return 'copy-badge-yellow';
  if (['missing_fast_metrics', 'wallet_unscorable', 'wallet_not_fast_copy'].includes(reason))
    return 'copy-badge-purple';
  if (['emergency_stop_active', 'exposure_cap'].includes(reason))
    return 'copy-badge-failed';
  return 'copy-badge-gray';
}

function orderStatusBadge(status: string | null) {
  if (!status) return <span className="copy-badge copy-badge-gray">—</span>;
  const map: Record<string, string> = {
    MATCHED: 'copy-badge-matched',
    FAILED:  'copy-badge-failed',
    SKIPPED: 'copy-badge-skipped',
    PARTIAL: 'copy-badge-partial',
  };
  return <span className={`copy-badge ${map[status] ?? 'copy-badge-blue'}`}>{status}</span>;
}

function BotModeDot({ mode }: { mode: 'PAPER' | 'LIVE' | undefined }) {
  if (!mode) return <span className="copy-td-muted">—</span>;
  return (
    <span className={`copy-attempt-mode-dot copy-attempt-mode-dot-${mode.toLowerCase()}`}>
      {mode}
    </span>
  );
}

const TAB_DEFS: { id: AttemptTab; label: string; activeClass: string }[] = [
  { id: 'ALL',    label: 'All',    activeClass: 'active' },
  { id: 'LIVE',   label: 'Live',   activeClass: 'active-live' },
  { id: 'PAPER',  label: 'Paper',  activeClass: 'active-paper' },
  { id: 'COPIED', label: 'Copied', activeClass: 'active-copied' },
  { id: 'SKIPPED',label: 'Skipped',activeClass: 'active-skipped' },
  { id: 'FAILED', label: 'Failed', activeClass: 'active-failed' },
];

export default function CopyAttemptsSection({ scrollable = false }: { scrollable?: boolean }) {
  const [rows, setRows] = useState<CopyAttempt[]>([]);
  const [botMap, setBotMap] = useState<BotMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<AttemptTab>('ALL');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [attemptsRes, botsRes] = await Promise.all([
        fetch('/api/copy/attempts?limit=200', { cache: 'no-store' }),
        fetch('/api/copy/bots', { cache: 'no-store' }),
      ]);
      const attemptsPayload = await attemptsRes.json();
      const botsPayload = await botsRes.json();

      if (attemptsPayload.ok) setRows(attemptsPayload.rows ?? []);
      else setError(attemptsPayload.error ?? 'Failed to load attempts');

      if (botsPayload.ok) {
        const map: BotMap = {};
        for (const b of botsPayload.rows ?? []) {
          map[b.id] = { mode: b.mode, name: b.name };
        }
        setBotMap(map);
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load.
  useEffect(() => { load(); }, [load]);

  // Live polling + event-driven refresh so new Worker attempts appear automatically.
  useEffect(() => {
    // 15 s poll — same cadence as CopyOverviewCards / CopyTradingTabs.
    const poll = setInterval(load, POLL_MS);

    // Reload when the operator clicks the page-level Refresh button.
    const onRefresh = () => load();
    // Reload when the browser tab regains focus.
    const onVisible = () => { if (!document.hidden) load(); };

    window.addEventListener('copy:refresh', onRefresh);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(poll);
      window.removeEventListener('copy:refresh', onRefresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  // Filter rows based on active tab
  const filtered = useMemo(() => {
    switch (tab) {
      case 'LIVE':   return rows.filter((r) => botMap[r.copy_bot_id]?.mode === 'LIVE');
      case 'PAPER':  return rows.filter((r) => botMap[r.copy_bot_id]?.mode === 'PAPER');
      case 'COPIED': return rows.filter((r) => r.copied);
      case 'SKIPPED':return rows.filter((r) => !r.copied);
      case 'FAILED': return rows.filter((r) => r.order_status === 'FAILED');
      default:       return rows;
    }
  }, [rows, botMap, tab]);

  // Compute counts for tab badges
  const counts = useMemo(() => ({
    ALL:    rows.length,
    LIVE:   rows.filter((r) => botMap[r.copy_bot_id]?.mode === 'LIVE').length,
    PAPER:  rows.filter((r) => botMap[r.copy_bot_id]?.mode === 'PAPER').length,
    COPIED: rows.filter((r) => r.copied).length,
    SKIPPED:rows.filter((r) => !r.copied).length,
    FAILED: rows.filter((r) => r.order_status === 'FAILED').length,
  }), [rows, botMap]);

  return (
    <div className="copy-section">
      <div className="copy-section-head">
        <div className="copy-section-title-row">
          <h2 className="copy-section-title">Recent Copy Attempts</h2>
          {!loading && rows.length > 0 && (
            <span className="copy-section-count">{rows.length}</span>
          )}
        </div>
        <div className="copy-section-actions">
          <button className="copy-btn copy-btn-secondary copy-btn-sm" onClick={load} disabled={loading}>
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Tab bar */}
      {!loading && rows.length > 0 && (
        <div style={{ padding: '0.6rem 1.5rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <div className="copy-tab-bar">
            {TAB_DEFS.map((t) => (
              <button
                key={t.id}
                className={`copy-tab${tab === t.id ? ` ${t.activeClass}` : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
                {counts[t.id] > 0 && (
                  <span className="copy-tab-count">{counts[t.id]}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="copy-loading">Loading copy attempts…</div>
      ) : error ? (
        <div className="copy-empty">
          <p className="copy-empty-title" style={{ color: '#f87171' }}>{error}</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="copy-empty">
          <div className="copy-empty-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
          </div>
          <p className="copy-empty-title">No copy attempts yet</p>
          <p className="copy-empty-sub">
            Attempts appear here once the copy worker detects trades from tracked wallets.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="copy-empty">
          <p className="copy-empty-title">No {tab.toLowerCase()} attempts</p>
          <p className="copy-empty-sub">Try a different filter.</p>
        </div>
      ) : (
        <div className={`copy-table-wrap${scrollable ? ' copy-table-scroll' : ''}`}>
          <table className="copy-table" style={{ minWidth: '1250px' }}>
            <thead>
              <tr>
                <th>Time</th>
                <th>Bot / Mode</th>
                <th>Wallet</th>
                <th>Market</th>
                <th>Outcome</th>
                <th>Source Trade ID</th>
                <th>Src Price</th>
                <th>Sub Price</th>
                <th>Sub Size</th>
                <th>Result</th>
                <th>Order Status</th>
                <th>Latency</th>
                <th>Slippage</th>
                <th>Skip Reason</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const bot = botMap[r.copy_bot_id];
                return (
                  <tr key={r.id}>
                    <td className="copy-td-muted" style={{ fontSize: '0.72rem' }}>{fmtDate(r.created_at)}</td>
                    <td>
                      <BotModeDot mode={bot?.mode} />
                      {bot && <span className="copy-td-sub">{bot.name}</span>}
                    </td>
                    <td>
                      <TraderCell
                        displayName={r.display_name}
                        walletAddress={r.wallet_address}
                      />
                    </td>
                    <td>
                      <span className="copy-td-truncate" title={r.market_title ?? r.market_slug ?? undefined}>
                        {r.market_title ?? r.market_slug ?? '—'}
                      </span>
                    </td>
                    <td>
                      {r.source_outcome ? (
                        <span className={`copy-badge ${r.source_outcome.toUpperCase() === 'YES' ? 'copy-badge-green' : 'copy-badge-red'}`}>
                          {r.source_outcome.toUpperCase()}
                        </span>
                      ) : <span className="copy-td-muted">—</span>}
                    </td>
                    <td>
                      <span
                        className="copy-mono"
                        title={r.source_trade_id ?? undefined}
                        style={{ fontSize: '0.7rem', color: 'rgba(248,250,252,0.4)' }}
                      >
                        {truncateTradeId(r.source_trade_id)}
                      </span>
                    </td>
                    <td className="copy-td-num copy-td-muted">
                      {r.source_price != null ? r.source_price.toFixed(3) : '—'}
                    </td>
                    <td className="copy-td-num copy-td-muted">
                      {r.submitted_price != null ? r.submitted_price.toFixed(3) : '—'}
                    </td>
                    <td className="copy-td-num">
                      {r.submitted_size != null ? `$${r.submitted_size.toFixed(2)}` : '—'}
                    </td>
                    <td>
                      <span className={`copy-badge ${r.copied ? 'copy-badge-copied' : 'copy-badge-skipped'}`}>
                        {r.copied ? 'Copied' : 'Skipped'}
                      </span>
                    </td>
                    <td>{orderStatusBadge(r.order_status)}</td>
                    <td className="copy-td-num copy-td-muted">
                      {r.latency_ms != null ? `${r.latency_ms}ms` : '—'}
                    </td>
                    <td className="copy-td-num copy-td-muted">
                      {r.slippage != null ? `${(r.slippage * 100).toFixed(2)}%` : '—'}
                    </td>
                    <td style={{ maxWidth: 180 }}>
                      {r.skip_reason ? (
                        <span
                          className={`copy-badge ${skipReasonBadgeClass(r.skip_reason)}`}
                          title={r.skip_reason}
                          style={{ fontSize: '0.68rem', whiteSpace: 'nowrap' }}
                        >
                          {skipReasonLabel(r.skip_reason)}
                        </span>
                      ) : (
                        <span className="copy-td-muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
