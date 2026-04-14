'use client';

import { useCallback, useEffect, useState } from 'react';

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

export default function CopyAttemptsSection() {
  const [rows, setRows] = useState<CopyAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/copy/attempts?limit=50', { cache: 'no-store' });
      const payload = await res.json();
      if (payload.ok) setRows(payload.rows ?? []);
      else setError(payload.error ?? 'Failed to load attempts');
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

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
            Attempts appear here once the copy worker detects trades from tracked wallets and decides to copy or skip.
          </p>
        </div>
      ) : (
        <div className="copy-table-wrap">
          <table className="copy-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Wallet</th>
                <th>Market</th>
                <th>Side</th>
                <th>Outcome</th>
                <th>Src Price</th>
                <th>Sub Price</th>
                <th>Sub Size</th>
                <th>Copied</th>
                <th>Status</th>
                <th>Latency</th>
                <th>Slippage</th>
                <th>Skip Reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="copy-td-muted" style={{ fontSize: '0.72rem' }}>{fmtDate(r.created_at)}</td>
                  <td>
                    <span className="copy-mono" title={r.wallet_address}>{truncate(r.wallet_address)}</span>
                  </td>
                  <td>
                    <span className="copy-td-truncate" title={r.market_title ?? r.market_slug ?? undefined}>
                      {r.market_title ?? r.market_slug ?? '—'}
                    </span>
                  </td>
                  <td className="copy-td-muted">{r.source_side ?? '—'}</td>
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
                  <td className="copy-td-muted copy-td-truncate" title={r.skip_reason ?? undefined}
                    style={{ fontSize: '0.72rem', maxWidth: 160 }}>
                    {r.skip_reason ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
