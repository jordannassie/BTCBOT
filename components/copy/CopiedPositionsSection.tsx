'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const POLL_MS = 15_000;

type CopiedPosition = {
  id: string;
  copy_bot_id: string;
  wallet_address: string;
  market_slug: string | null;
  market_title: string | null;
  outcome: string | null;
  side: string | null;
  entry_price: number | null;
  size: number | null;
  status: 'OPEN' | 'CLOSED' | 'CANCELLED';
  opened_at: string;
  closed_at: string | null;
  exit_price: number | null;
  pnl: number;
};

type ExitMode = 'mirror_only' | 'auto_profit' | 'auto_profit_max_hold';
type BotMap = Record<string, { mode: 'PAPER' | 'LIVE'; name: string; exit_mode?: ExitMode; take_profit_pct?: number; max_hold_minutes?: number }>;

function ExitModeBadge({ mode, tpPct, maxMin }: { mode?: ExitMode; tpPct?: number; maxMin?: number }) {
  const m = mode ?? 'mirror_only';
  if (m === 'auto_profit') {
    return (
      <span className="copy-exit-badge copy-exit-badge-profit" title={`Close at +${tpPct ?? 8}% profit`}>
        AP {tpPct ?? 8}%
      </span>
    );
  }
  if (m === 'auto_profit_max_hold') {
    return (
      <span className="copy-exit-badge copy-exit-badge-maxhold" title={`Close at +${tpPct ?? 8}% profit or after ${maxMin ?? 10}m`}>
        AP {tpPct ?? 8}% · {maxMin ?? 10}m
      </span>
    );
  }
  return null; // mirror_only = no badge, it's the default
}

const truncate = (addr: string) =>
  addr.length > 14 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr;
const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

function statusBadge(status: string) {
  if (status === 'OPEN')      return <span className="copy-badge copy-badge-open">Open</span>;
  if (status === 'CLOSED')    return <span className="copy-badge copy-badge-closed">Closed</span>;
  if (status === 'CANCELLED') return <span className="copy-badge copy-badge-cancelled">Cancelled</span>;
  return <span className="copy-badge copy-badge-gray">{status}</span>;
}

type Filter = 'ALL' | 'OPEN' | 'CLOSED' | 'CANCELLED';

// Server-confirmed open exposure summary (from the unbounded RPC via /api/copy/exposure).
// Stored separately from the table rows so the summary bar is always accurate
// regardless of the 100-row fetch limit on /api/copy/positions.
type ExposureSummary = {
  paperCount: number;
  paperExposure: number;
  liveCount: number;
  liveExposure: number;
};

export default function CopiedPositionsSection({ scrollable = false }: { scrollable?: boolean }) {
  const [rows, setRows] = useState<CopiedPosition[]>([]);
  const [botMap, setBotMap] = useState<BotMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');
  // Server-confirmed exposure totals — never limited by the table row cap
  const [exposureSummary, setExposureSummary] = useState<ExposureSummary | null>(null);
  // Keep the current filter accessible inside event callbacks without re-subscribing
  const filterRef = useRef<Filter>('ALL');

  const load = useCallback(async (statusFilter: Filter) => {
    setLoading(true);
    setError(null);
    try {
      const qs = statusFilter !== 'ALL' ? `?status=${statusFilter}` : '';
      const [posRes, botsRes, expRes] = await Promise.all([
        fetch(`/api/copy/positions${qs}`, { cache: 'no-store' }),
        fetch('/api/copy/bots', { cache: 'no-store' }),
        // Fetch true open exposure via the unbounded RPC (copy_open_exposure_by_mode).
        // This is the same source used by the Paper and Live bankroll cards, so the
        // summary bar will always match those cards regardless of the table row limit.
        fetch('/api/copy/exposure', { cache: 'no-store' }),
      ]);
      const posPayload = await posRes.json();
      const botsPayload = await botsRes.json();

      if (posPayload.ok) setRows(posPayload.rows ?? []);
      else setError(posPayload.error ?? 'Failed to load positions');

      if (botsPayload.ok) {
        const map: BotMap = {};
        for (const b of botsPayload.rows ?? []) {
          map[b.id] = {
            mode: b.mode,
            name: b.name,
            exit_mode: b.exit_mode ?? 'mirror_only',
            take_profit_pct: b.take_profit_pct ?? 8,
            max_hold_minutes: b.max_hold_minutes ?? 10,
          };
        }
        setBotMap(map);
      }

      if (expRes.ok) {
        const expPayload = await expRes.json();
        if (expPayload.ok) {
          setExposureSummary({
            paperCount:    expPayload.paper?.count    ?? 0,
            paperExposure: expPayload.paper?.exposure ?? 0,
            liveCount:     expPayload.live?.count     ?? 0,
            liveExposure:  expPayload.live?.exposure  ?? 0,
          });
        }
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  // Keep filterRef in sync so the polling/event callbacks always use the current filter.
  useEffect(() => { filterRef.current = filter; }, [filter]);

  // Initial load + reload whenever the filter pill changes.
  useEffect(() => { load(filter); }, [load, filter]);

  // Live polling + event-driven refresh so new Worker positions appear automatically.
  useEffect(() => {
    // 15 s poll — same cadence as CopyOverviewCards / CopyTradingTabs summary poll.
    const poll = setInterval(() => load(filterRef.current), POLL_MS);

    // Reload when the operator clicks the page-level Refresh button.
    const onRefresh    = () => load(filterRef.current);
    // Reload after Paper Restart so OPEN → CANCELLED transition is immediate.
    const onPaperReset = () => load(filterRef.current);
    // Reload when the browser tab regains focus (catches activity that happened
    // while the operator was on another tab).
    const onVisible    = () => { if (!document.hidden) load(filterRef.current); };

    window.addEventListener('copy:refresh',    onRefresh);
    window.addEventListener('copy:paper-reset', onPaperReset);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(poll);
      window.removeEventListener('copy:refresh',    onRefresh);
      window.removeEventListener('copy:paper-reset', onPaperReset);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const totalPnl = useMemo(() =>
    rows.filter((r) => r.status !== 'OPEN').reduce((sum, r) => sum + r.pnl, 0),
    [rows]
  );

  // Derived summary totals from the RPC response (not the table rows)
  const totalOpenCount    = (exposureSummary?.paperCount    ?? 0) + (exposureSummary?.liveCount    ?? 0);
  const totalOpenExposure = (exposureSummary?.paperExposure ?? 0) + (exposureSummary?.liveExposure ?? 0);
  const avgOpenSize       = totalOpenCount > 0 ? totalOpenExposure / totalOpenCount : 0;
  const hasPaper          = (exposureSummary?.paperCount ?? 0) > 0;
  const hasLive           = (exposureSummary?.liveCount  ?? 0) > 0;

  const filters: Filter[] = ['ALL', 'OPEN', 'CLOSED', 'CANCELLED'];

  return (
    <div className="copy-section">
      <div className="copy-section-head">
        <div className="copy-section-title-row">
          <h2 className="copy-section-title">Copied Positions</h2>
          {!loading && rows.length > 0 && (
            <span className="copy-section-count">{rows.length}</span>
          )}
          {!loading && rows.some((r) => r.status !== 'OPEN') && (
            <span
              className={totalPnl >= 0 ? 'copy-num-pos' : 'copy-num-neg'}
              style={{ fontSize: '0.78rem', fontWeight: 700, marginLeft: '0.25rem' }}
              title="Total realised P/L across closed positions in current view"
            >
              {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)} P/L
            </span>
          )}
        </div>
        <div className="copy-section-actions">
          <div className="copy-filter-pills">
            {filters.map((f) => (
              <button
                key={f}
                className={`copy-filter-pill${filter === f ? ' active' : ''}`}
                onClick={() => setFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
          <button
            className="copy-btn copy-btn-secondary copy-btn-sm"
            onClick={() => load(filter)}
            disabled={loading}
            title="Refresh"
          >
            ↻
          </button>
        </div>
      </div>

      {/* ── Open Exposure Summary ── above the table, outside the scroll area ──
           Numbers come from /api/copy/exposure (copy_open_exposure_by_mode RPC)
           so they are always accurate regardless of the table's 100-row limit.
           Matches the Paper Bankroll card and Live card exactly. ── */}
      {!loading && !error && totalOpenCount > 0 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.5rem 1.5rem',
          padding: '0.6rem 1.5rem',
          borderBottom: '1px solid rgba(16, 185, 129, 0.12)',
          background: 'rgba(16, 185, 129, 0.04)',
          fontSize: '0.78rem',
        }}>
          <span style={{ color: 'rgba(248,250,252,0.45)', fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase', fontSize: '0.68rem' }}>
            Open Exposure
          </span>
          <span style={{ fontWeight: 700, color: '#f8fafc' }}>
            ${totalOpenExposure.toFixed(2)}
          </span>
          <span style={{ color: 'rgba(248,250,252,0.25)' }}>·</span>
          <span style={{ color: 'rgba(248,250,252,0.45)' }}>
            {totalOpenCount} open position{totalOpenCount !== 1 ? 's' : ''}
          </span>
          <span style={{ color: 'rgba(248,250,252,0.25)' }}>·</span>
          <span style={{ color: 'rgba(248,250,252,0.45)' }}>
            Avg <span style={{ color: '#f8fafc', fontWeight: 600 }}>${avgOpenSize.toFixed(2)}</span>
          </span>
          {/* Mode breakdown — only shown when both modes have open positions */}
          {hasPaper && hasLive && (
            <>
              <span style={{ color: 'rgba(248,250,252,0.25)' }}>·</span>
              <span style={{ color: 'rgba(248,250,252,0.35)', fontSize: '0.69rem' }}>
                Paper <span style={{ color: '#34d399', fontWeight: 600 }}>${(exposureSummary?.paperExposure ?? 0).toFixed(2)}</span>
                {' '}· Live <span style={{ color: '#60a5fa', fontWeight: 600 }}>${(exposureSummary?.liveExposure ?? 0).toFixed(2)}</span>
              </span>
            </>
          )}
          {hasPaper && !hasLive && (
            <>
              <span style={{ color: 'rgba(248,250,252,0.25)' }}>·</span>
              <span style={{ color: 'rgba(248,250,252,0.35)', fontSize: '0.69rem' }}>
                <span style={{ color: '#34d399' }}>PAPER</span> only
              </span>
            </>
          )}
          {hasLive && !hasPaper && (
            <>
              <span style={{ color: 'rgba(248,250,252,0.25)' }}>·</span>
              <span style={{ color: 'rgba(248,250,252,0.35)', fontSize: '0.69rem' }}>
                <span style={{ color: '#60a5fa' }}>LIVE</span> only
              </span>
            </>
          )}
        </div>
      )}

      {loading ? (
        <div className="copy-loading">Loading positions…</div>
      ) : error ? (
        <div className="copy-empty">
          <p className="copy-empty-title" style={{ color: '#f87171' }}>{error}</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="copy-empty">
          <div className="copy-empty-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>
            </svg>
          </div>
          <p className="copy-empty-title">
            No {filter !== 'ALL' ? filter.toLowerCase() + ' ' : ''}copied positions
          </p>
          <p className="copy-empty-sub">
            Positions appear here once the copy worker successfully places orders.
          </p>
        </div>
      ) : (
        <div className={`copy-table-wrap${scrollable ? ' copy-table-scroll' : ''}`}>
          <table className="copy-table" style={{ minWidth: '1050px' }}>
            <thead>
              <tr>
                <th>Opened</th>
                <th>Bot / Mode</th>
                <th>Wallet</th>
                <th>Market</th>
                <th>Outcome</th>
                <th>Side</th>
                <th>Entry</th>
                <th>Size ($)</th>
                <th>Status</th>
                <th>P / L</th>
                <th>Exit</th>
                <th>Closed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const bot = botMap[r.copy_bot_id];
                return (
                  <tr key={r.id}>
                    <td className="copy-td-muted" style={{ fontSize: '0.72rem' }}>{fmtDate(r.opened_at)}</td>
                    <td>
                      {bot ? (
                        <>
                          <span className={`copy-attempt-mode-dot copy-attempt-mode-dot-${bot.mode.toLowerCase()}`}>
                            {bot.mode}
                          </span>
                          <span className="copy-td-sub">{bot.name}</span>
                          {r.status === 'OPEN' && bot.exit_mode && bot.exit_mode !== 'mirror_only' && (
                            <div style={{ marginTop: '0.2rem' }}>
                              <ExitModeBadge
                                mode={bot.exit_mode}
                                tpPct={bot.take_profit_pct}
                                maxMin={bot.max_hold_minutes}
                              />
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="copy-td-muted">—</span>
                      )}
                    </td>
                    <td>
                      <span className="copy-mono" title={r.wallet_address}>{truncate(r.wallet_address)}</span>
                    </td>
                    <td>
                      <span className="copy-td-truncate" title={r.market_title ?? r.market_slug ?? undefined}>
                        {r.market_title ?? r.market_slug ?? '—'}
                      </span>
                    </td>
                    <td>
                      {r.outcome ? (
                        <span className={`copy-badge ${r.outcome.toUpperCase() === 'YES' ? 'copy-badge-green' : 'copy-badge-red'}`}>
                          {r.outcome.toUpperCase()}
                        </span>
                      ) : <span className="copy-td-muted">—</span>}
                    </td>
                    <td className="copy-td-muted">{r.side ?? '—'}</td>
                    <td className="copy-td-num">{r.entry_price != null ? r.entry_price.toFixed(3) : '—'}</td>
                    <td className="copy-td-num">{r.size != null ? `$${r.size.toFixed(2)}` : '—'}</td>
                    <td>{statusBadge(r.status)}</td>
                    <td className="copy-td-num">
                      {r.status === 'OPEN' ? (
                        <span className="copy-td-muted">Open</span>
                      ) : (
                        <span className={r.pnl > 0 ? 'copy-num-pos' : r.pnl < 0 ? 'copy-num-neg' : 'copy-num-neu'}>
                          {r.pnl >= 0 ? '+' : ''}${r.pnl.toFixed(2)}
                        </span>
                      )}
                    </td>
                    <td className="copy-td-num copy-td-muted">{r.exit_price != null ? r.exit_price.toFixed(3) : '—'}</td>
                    <td className="copy-td-muted" style={{ fontSize: '0.72rem' }}>{fmtDate(r.closed_at)}</td>
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
