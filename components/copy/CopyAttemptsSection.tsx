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

function orderStatusBadge(status: string | null) {
  if (!status) return <span className="copy-badge copy-badge-gray">—</span>;
  const cls =
    status === 'MATCHED' ? 'copy-badge-green' :
    status === 'FAILED'  ? 'copy-badge-red' :
    status === 'SKIPPED' ? 'copy-badge-gray' :
    status === 'PARTIAL' ? 'copy-badge-yellow' : 'copy-badge-purple';
  return <span className={`copy-badge ${cls}`}>{status}</span>;
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
      <div className="copy-section-header">
        <h2 className="copy-section-title">Recent Copy Attempts</h2>
        <div className="copy-section-actions">
          <button className="copy-btn copy-btn-secondary copy-btn-sm" onClick={load} disabled={loading}>
            ↻ Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="copy-empty"><p>Loading…</p></div>
      ) : error ? (
        <div className="copy-empty"><p style={{ color: '#ef4444' }}>{error}</p></div>
      ) : rows.length === 0 ? (
        <div className="copy-empty">
          <p>No copy attempts yet.</p>
          <p className="copy-empty-sub">
            Attempts will appear here once the copy-trading worker begins processing source wallet trades.
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
                  <td style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.72rem' }}>
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td><span className="copy-mono">{truncate(r.wallet_address)}</span></td>
                  <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.market_title ?? r.market_slug ?? '—'}
                  </td>
                  <td>{r.source_side ?? '—'}</td>
                  <td>{r.source_outcome ?? '—'}</td>
                  <td>{r.source_price != null ? r.source_price.toFixed(3) : '—'}</td>
                  <td>{r.submitted_price != null ? r.submitted_price.toFixed(3) : '—'}</td>
                  <td>{r.submitted_size != null ? `$${r.submitted_size.toFixed(2)}` : '—'}</td>
                  <td>
                    <span className={`copy-badge ${r.copied ? 'copy-badge-green' : 'copy-badge-gray'}`}>
                      {r.copied ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td>{orderStatusBadge(r.order_status)}</td>
                  <td>{r.latency_ms != null ? `${r.latency_ms}ms` : '—'}</td>
                  <td>{r.slippage != null ? `${(r.slippage * 100).toFixed(2)}%` : '—'}</td>
                  <td style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.75rem', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
