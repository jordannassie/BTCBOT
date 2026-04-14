'use client';

import { useCallback, useEffect, useState } from 'react';

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

const truncate = (addr: string) =>
  addr.length > 14 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr;

function statusBadge(status: string) {
  if (status === 'OPEN')      return <span className="copy-badge copy-badge-green">OPEN</span>;
  if (status === 'CLOSED')    return <span className="copy-badge copy-badge-gray">CLOSED</span>;
  if (status === 'CANCELLED') return <span className="copy-badge copy-badge-red">CANCELLED</span>;
  return <span className="copy-badge copy-badge-gray">{status}</span>;
}

type Filter = 'ALL' | 'OPEN' | 'CLOSED' | 'CANCELLED';

export default function CopiedPositionsSection() {
  const [rows, setRows] = useState<CopiedPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');

  const load = useCallback(async (statusFilter: Filter) => {
    setLoading(true);
    setError(null);
    try {
      const qs = statusFilter !== 'ALL' ? `?status=${statusFilter}` : '';
      const res = await fetch(`/api/copy/positions${qs}`, { cache: 'no-store' });
      const payload = await res.json();
      if (payload.ok) setRows(payload.rows ?? []);
      else setError(payload.error ?? 'Failed to load positions');
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(filter); }, [load, filter]);

  const filters: Filter[] = ['ALL', 'OPEN', 'CLOSED', 'CANCELLED'];

  return (
    <div className="copy-section">
      <div className="copy-section-header">
        <h2 className="copy-section-title">Copied Positions</h2>
        <div className="copy-section-actions" style={{ gap: '0.3rem' }}>
          {filters.map((f) => (
            <button
              key={f}
              className={`copy-btn copy-btn-sm ${filter === f ? 'copy-btn-primary' : 'copy-btn-secondary'}`}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
          <button className="copy-btn copy-btn-secondary copy-btn-sm" onClick={() => load(filter)} disabled={loading}>
            ↻
          </button>
        </div>
      </div>

      {loading ? (
        <div className="copy-empty"><p>Loading…</p></div>
      ) : error ? (
        <div className="copy-empty"><p style={{ color: '#ef4444' }}>{error}</p></div>
      ) : rows.length === 0 ? (
        <div className="copy-empty">
          <p>No {filter !== 'ALL' ? filter.toLowerCase() + ' ' : ''}copied positions yet.</p>
          <p className="copy-empty-sub">
            Positions will appear here once the copy-trading worker successfully executes trades.
          </p>
        </div>
      ) : (
        <div className="copy-table-wrap">
          <table className="copy-table">
            <thead>
              <tr>
                <th>Opened</th>
                <th>Wallet</th>
                <th>Market</th>
                <th>Outcome</th>
                <th>Side</th>
                <th>Entry</th>
                <th>Size</th>
                <th>Status</th>
                <th>P/L</th>
                <th>Exit Price</th>
                <th>Closed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.72rem' }}>
                    {new Date(r.opened_at).toLocaleString()}
                  </td>
                  <td><span className="copy-mono">{truncate(r.wallet_address)}</span></td>
                  <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.market_title ?? r.market_slug ?? '—'}
                  </td>
                  <td>
                    {r.outcome ? (
                      <span className={`copy-badge ${r.outcome.toUpperCase() === 'YES' ? 'copy-badge-green' : 'copy-badge-red'}`}>
                        {r.outcome.toUpperCase()}
                      </span>
                    ) : '—'}
                  </td>
                  <td>{r.side ?? '—'}</td>
                  <td>{r.entry_price != null ? r.entry_price.toFixed(3) : '—'}</td>
                  <td>{r.size != null ? `$${r.size.toFixed(2)}` : '—'}</td>
                  <td>{statusBadge(r.status)}</td>
                  <td style={{ color: r.pnl > 0 ? '#10b981' : r.pnl < 0 ? '#ef4444' : 'rgba(255,255,255,0.5)', fontWeight: 600 }}>
                    {r.status === 'OPEN' ? '—' : (r.pnl >= 0 ? '+' : '') + `$${r.pnl.toFixed(2)}`}
                  </td>
                  <td>{r.exit_price != null ? r.exit_price.toFixed(3) : '—'}</td>
                  <td style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.72rem' }}>
                    {r.closed_at ? new Date(r.closed_at).toLocaleString() : '—'}
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
