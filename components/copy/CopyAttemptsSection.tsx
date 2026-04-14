'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type CopyAttempt = {
  id: string;
  copy_bot_id: string;
  wallet_address: string;
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

const truncate = (addr: string) =>
  addr.length > 14 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr;
const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

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

export default function CopyAttemptsSection() {
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
        fetch('/api/copy/attempts?limit=100', { cache: 'no-store' }),
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

  useEffect(() => { load(); }, [load]);

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
        <div className="copy-table-wrap">
          <table className="copy-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Bot / Mode</th>
                <th>Wallet</th>
                <th>Market</th>
                <th>Outcome</th>
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
                      <span className="copy-mono" title={r.wallet_address}>{truncate(r.wallet_address)}</span>
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
                    <td className="copy-td-muted copy-td-truncate"
                      title={r.skip_reason ?? undefined}
                      style={{ fontSize: '0.72rem', maxWidth: 160 }}>
                      {r.skip_reason ?? '—'}
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
