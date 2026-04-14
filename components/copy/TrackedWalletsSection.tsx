'use client';

import { useCallback, useEffect, useState } from 'react';

type WalletMetrics = {
  copy_score: number | null;
  pnl_7d: number | null;
  pnl_30d: number | null;
  trade_count: number | null;
  category_focus: string | null;
  updated_at: string | null;
};

type WalletRow = {
  id: string;
  wallet_address: string;
  display_name: string | null;
  is_active: boolean;
  source: string;
  tags: string[];
  created_at: string;
  updated_at: string;
  metrics: WalletMetrics | null;
};

const fmtUSD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
const fmt = (v: number | null | undefined) => (v == null ? '—' : fmtUSD.format(v));
const truncate = (addr: string) =>
  addr.length > 14 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr;

export default function TrackedWalletsSection() {
  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Form fields
  const [fAddress, setFAddress] = useState('');
  const [fName, setFName] = useState('');
  const [fSaving, setFSaving] = useState(false);
  const [fError, setFError] = useState<string | null>(null);
  const [fSuccess, setFSuccess] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/copy/wallets', { cache: 'no-store' });
      const payload = await res.json();
      if (payload.ok) setWallets(payload.rows ?? []);
      else setError(payload.error ?? 'Failed to load wallets');
    } catch {
      setError('Network error loading wallets');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleToggleActive = async (wallet: WalletRow) => {
    setTogglingId(wallet.wallet_address);
    try {
      const res = await fetch('/api/copy/wallets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet_address: wallet.wallet_address, is_active: !wallet.is_active }),
        cache: 'no-store',
      });
      const payload = await res.json();
      if (payload.ok) {
        setWallets((prev) =>
          prev.map((w) =>
            w.wallet_address === wallet.wallet_address ? { ...w, is_active: !wallet.is_active } : w
          )
        );
      }
    } finally {
      setTogglingId(null);
    }
  };

  const handleAddWallet = async (e: React.FormEvent) => {
    e.preventDefault();
    setFError(null);
    setFSuccess(false);
    if (!fAddress.trim()) { setFError('Wallet address is required'); return; }
    setFSaving(true);
    try {
      const res = await fetch('/api/copy/wallets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet_address: fAddress.trim(), display_name: fName.trim() || undefined }),
        cache: 'no-store',
      });
      const payload = await res.json();
      if (!payload.ok) { setFError(payload.error ?? 'Failed to add wallet'); return; }
      setFAddress('');
      setFName('');
      setFSuccess(true);
      await load();
      setTimeout(() => setFSuccess(false), 2500);
    } finally {
      setFSaving(false);
    }
  };

  return (
    <div className="copy-section">
      <div className="copy-section-header">
        <h2 className="copy-section-title">Tracked Wallets</h2>
        <div className="copy-section-actions">
          <button
            className="copy-btn copy-btn-secondary copy-btn-sm"
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? 'Cancel' : '+ Add Wallet'}
          </button>
        </div>
      </div>

      {showForm && (
        <form className="copy-add-form" onSubmit={handleAddWallet}>
          <div className="copy-form-grid">
            <div className="copy-form-field" style={{ gridColumn: 'span 2' }}>
              <label className="copy-form-label">Wallet Address *</label>
              <input
                className="copy-form-input"
                value={fAddress}
                onChange={(e) => setFAddress(e.target.value)}
                placeholder="0x..."
                spellCheck={false}
              />
            </div>
            <div className="copy-form-field">
              <label className="copy-form-label">Display Name</label>
              <input
                className="copy-form-input"
                value={fName}
                onChange={(e) => setFName(e.target.value)}
                placeholder="e.g. Whale A"
              />
            </div>
          </div>
          <div className="copy-form-actions">
            <button className="copy-btn copy-btn-primary" type="submit" disabled={fSaving}>
              {fSaving ? 'Adding…' : 'Add Wallet'}
            </button>
            {fError && <p className="copy-form-error">{fError}</p>}
            {fSuccess && <p className="copy-form-success">Wallet added.</p>}
          </div>
        </form>
      )}

      {loading ? (
        <div className="copy-empty"><p>Loading wallets…</p></div>
      ) : error ? (
        <div className="copy-empty"><p style={{ color: '#ef4444' }}>{error}</p></div>
      ) : wallets.length === 0 ? (
        <div className="copy-empty">
          <p>No tracked wallets yet.</p>
          <p className="copy-empty-sub">Add a wallet address above to start monitoring it.</p>
        </div>
      ) : (
        <div className="copy-table-wrap">
          <table className="copy-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Address</th>
                <th>Active</th>
                <th>Score</th>
                <th>7d P/L</th>
                <th>30d P/L</th>
                <th>Trades</th>
                <th>Category</th>
                <th>Metrics Updated</th>
              </tr>
            </thead>
            <tbody>
              {wallets.map((w) => (
                <tr key={w.wallet_address}>
                  <td style={{ fontWeight: 600 }}>{w.display_name ?? '—'}</td>
                  <td><span className="copy-mono">{truncate(w.wallet_address)}</span></td>
                  <td>
                    <div className="toggle-switch" style={{ width: 36, height: 20 }}>
                      <input
                        type="checkbox"
                        checked={w.is_active}
                        onChange={() => handleToggleActive(w)}
                        disabled={togglingId === w.wallet_address}
                        id={`wallet-active-${w.wallet_address}`}
                      />
                      <label className="toggle-slider" htmlFor={`wallet-active-${w.wallet_address}`} />
                    </div>
                  </td>
                  <td>{w.metrics?.copy_score != null ? w.metrics.copy_score.toFixed(1) : '—'}</td>
                  <td style={{ color: (w.metrics?.pnl_7d ?? 0) >= 0 ? '#10b981' : '#ef4444' }}>
                    {fmt(w.metrics?.pnl_7d)}
                  </td>
                  <td style={{ color: (w.metrics?.pnl_30d ?? 0) >= 0 ? '#10b981' : '#ef4444' }}>
                    {fmt(w.metrics?.pnl_30d)}
                  </td>
                  <td>{w.metrics?.trade_count ?? '—'}</td>
                  <td>{w.metrics?.category_focus ?? '—'}</td>
                  <td style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.72rem' }}>
                    {w.metrics?.updated_at ? new Date(w.metrics.updated_at).toLocaleString() : '—'}
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
