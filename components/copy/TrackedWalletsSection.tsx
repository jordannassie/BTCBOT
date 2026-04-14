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
const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

function EmptyWallets({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="copy-empty">
      <div className="copy-empty-icon">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>
        </svg>
      </div>
      <p className="copy-empty-title">No tracked wallets</p>
      <p className="copy-empty-sub">Add a Polymarket wallet address to begin monitoring its trades and ranking its performance.</p>
      <button className="copy-btn copy-btn-primary" style={{ marginTop: '1rem' }} onClick={onAdd}>
        + Add Wallet
      </button>
    </div>
  );
}

export default function TrackedWalletsSection() {
  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

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
      <div className="copy-section-head">
        <div className="copy-section-title-row">
          <h2 className="copy-section-title">Tracked Wallets</h2>
          {!loading && wallets.length > 0 && (
            <span className="copy-section-count">{wallets.length}</span>
          )}
        </div>
        <div className="copy-section-actions">
          <button
            className={`copy-btn copy-btn-sm ${showForm ? 'copy-btn-secondary' : 'copy-btn-primary'}`}
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? 'Cancel' : '+ Add Wallet'}
          </button>
        </div>
      </div>

      {showForm && (
        <form className="copy-add-form" onSubmit={handleAddWallet}>
          <div className="copy-form-title">Add Tracked Wallet</div>
          <div className="copy-form-grid">
            <div className="copy-form-field copy-form-grid-wide">
              <label className="copy-form-label">Wallet Address <span style={{ color: '#f87171' }}>*</span></label>
              <input
                className="copy-form-input"
                value={fAddress}
                onChange={(e) => setFAddress(e.target.value)}
                placeholder="0x…"
                spellCheck={false}
                autoComplete="off"
              />
              <span className="copy-form-hint">Paste the full Polymarket wallet address</span>
            </div>
            <div className="copy-form-field">
              <label className="copy-form-label">Display Name</label>
              <input
                className="copy-form-input"
                value={fName}
                onChange={(e) => setFName(e.target.value)}
                placeholder="e.g. Whale A"
              />
              <span className="copy-form-hint">Optional label for this wallet</span>
            </div>
          </div>
          <div className="copy-form-actions">
            <button className="copy-btn copy-btn-primary" type="submit" disabled={fSaving}>
              {fSaving ? 'Adding…' : 'Add Wallet'}
            </button>
            {fError && <span className="copy-form-msg copy-form-error">{fError}</span>}
            {fSuccess && <span className="copy-form-msg copy-form-success">Wallet added successfully.</span>}
          </div>
        </form>
      )}

      {loading ? (
        <div className="copy-loading">Loading wallets…</div>
      ) : error ? (
        <div className="copy-empty">
          <p className="copy-empty-title" style={{ color: '#f87171' }}>{error}</p>
        </div>
      ) : wallets.length === 0 ? (
        <EmptyWallets onAdd={() => setShowForm(true)} />
      ) : (
        <div className="copy-table-wrap">
          <table className="copy-table">
            <thead>
              <tr>
                <th>Wallet</th>
                <th>Active</th>
                <th>Score</th>
                <th>7d P/L</th>
                <th>30d P/L</th>
                <th>Trades</th>
                <th>Category</th>
                <th>Metrics At</th>
              </tr>
            </thead>
            <tbody>
              {wallets.map((w) => (
                <tr key={w.wallet_address}>
                  <td>
                    <span className="copy-td-name">{w.display_name ?? <span className="copy-td-muted">Unnamed</span>}</span>
                    <span className="copy-td-sub copy-mono" title={w.wallet_address}>{truncate(w.wallet_address)}</span>
                  </td>
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
                  <td className="copy-td-num">
                    {w.metrics?.copy_score != null
                      ? <span style={{ fontWeight: 600, color: '#f8fafc' }}>{w.metrics.copy_score.toFixed(1)}</span>
                      : <span className="copy-td-muted">—</span>}
                  </td>
                  <td className="copy-td-num">
                    <span className={(w.metrics?.pnl_7d ?? 0) >= 0 ? 'copy-num-pos' : 'copy-num-neg'}>
                      {fmt(w.metrics?.pnl_7d)}
                    </span>
                  </td>
                  <td className="copy-td-num">
                    <span className={(w.metrics?.pnl_30d ?? 0) >= 0 ? 'copy-num-pos' : 'copy-num-neg'}>
                      {fmt(w.metrics?.pnl_30d)}
                    </span>
                  </td>
                  <td className="copy-td-num copy-td-muted">{w.metrics?.trade_count ?? '—'}</td>
                  <td>
                    {w.metrics?.category_focus
                      ? <span className="copy-badge copy-badge-purple">{w.metrics.category_focus}</span>
                      : <span className="copy-td-muted">—</span>}
                  </td>
                  <td className="copy-td-muted" style={{ fontSize: '0.72rem' }}>{fmtDate(w.metrics?.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
