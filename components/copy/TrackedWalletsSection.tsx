'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import WalletSparkline from './WalletSparkline';

// ─── Types ────────────────────────────────────────────────────────────────────

type WalletMetrics = {
  copy_score: number | null;
  pnl_7d: number | null;
  pnl_30d: number | null;
  pnl_all: number | null;
  win_rate: number | null;
  trade_count: number | null;
  volume: number | null;
  avg_hold_minutes: number | null;
  max_drawdown: number | null;
  category_focus: string | null;
  last_trade_at: string | null;
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

type SeriesPoint = { x: string; y: number };
type WalletSeries = { wallet_address: string; points: SeriesPoint[] };

type SortKey = 'copy_score' | 'pnl_7d' | 'pnl_30d' | 'pnl_all' | 'win_rate' | 'trade_count' | 'volume';
type SortDir = 'desc' | 'asc';

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtCompact(v: number | null | undefined): string {
  if (v == null) return '—';
  const abs = Math.abs(v);
  const prefix = v < 0 ? '-$' : '$';
  if (abs >= 1_000_000) return `${prefix}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${prefix}${(abs / 1_000).toFixed(1)}K`;
  return `${prefix}${abs.toFixed(2)}`;
}

function fmtNum(v: number | null | undefined): string {
  if (v == null) return '—';
  return v.toLocaleString();
}

function fmtPct(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

function fmtRelative(d: string | null | undefined): string {
  if (!d) return '—';
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const truncate = (addr: string) =>
  addr.length > 14 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr;

function scoreColor(score: number | null | undefined): string {
  if (score == null) return 'copy-score-none';
  if (score >= 70) return 'copy-score-high';
  if (score >= 40) return 'copy-score-mid';
  return 'copy-score-low';
}

function pnlClass(v: number | null | undefined): string {
  if (v == null) return 'copy-td-muted';
  return v >= 0 ? 'copy-num-pos' : 'copy-num-neg';
}

// ─── Sub-components ───────────────────────────────────────────────────────────

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

interface SortHeaderProps {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
}
function SortHeader({ label, sortKey, active, dir, onSort }: SortHeaderProps) {
  const isActive = active === sortKey;
  return (
    <th
      className={`copy-th-sort${isActive ? ` ${dir}` : ''}`}
      onClick={() => onSort(sortKey)}
      title={`Sort by ${label}`}
    >
      {label}
    </th>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TrackedWalletsSection() {
  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [seriesMap, setSeriesMap] = useState<Map<string, SeriesPoint[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Sort state — default: sort by copy_score descending
  const [sortKey, setSortKey] = useState<SortKey>('copy_score');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Add wallet form state
  const [fAddress, setFAddress] = useState('');
  const [fName, setFName] = useState('');
  const [fSaving, setFSaving] = useState(false);
  const [fError, setFError] = useState<string | null>(null);
  const [fSuccess, setFSuccess] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [walletsRes, seriesRes] = await Promise.all([
        fetch('/api/copy/wallets', { cache: 'no-store' }),
        fetch('/api/copy/wallet-series', { cache: 'no-store' }),
      ]);

      const walletsPayload = await walletsRes.json();
      if (walletsPayload.ok) {
        setWallets(walletsPayload.rows ?? []);
      } else {
        setError(walletsPayload.error ?? 'Failed to load wallets');
      }

      if (seriesRes.ok) {
        const seriesPayload = await seriesRes.json();
        if (seriesPayload.ok) {
          const map = new Map<string, SeriesPoint[]>();
          for (const entry of (seriesPayload.series ?? []) as WalletSeries[]) {
            map.set(entry.wallet_address, entry.points);
          }
          setSeriesMap(map);
        }
      }
    } catch {
      setError('Network error loading wallets');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const sorted = useMemo(() => {
    return [...wallets].sort((a, b) => {
      const av = a.metrics?.[sortKey] ?? -Infinity;
      const bv = b.metrics?.[sortKey] ?? -Infinity;
      return sortDir === 'desc' ? (bv as number) - (av as number) : (av as number) - (bv as number);
    });
  }, [wallets, sortKey, sortDir]);

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
      {/* ── Section header ── */}
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

      {/* ── Add wallet form ── */}
      {showForm && (
        <form className="copy-add-form" onSubmit={handleAddWallet}>
          <div className="copy-form-title">Add Tracked Wallet</div>
          <div className="copy-form-grid">
            <div className="copy-form-field copy-form-grid-wide">
              <label className="copy-form-label">
                Wallet Address <span style={{ color: '#f87171' }}>*</span>
              </label>
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

      {/* ── Table / states ── */}
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
          <table className="copy-table copy-table-leaderboard">
            <thead>
              <tr>
                <th className="copy-th-rank">#</th>
                <th style={{ minWidth: 180 }}>Wallet</th>
                <th style={{ minWidth: 50 }}>Active</th>
                <SortHeader label="Score"    sortKey="copy_score"  active={sortKey} dir={sortDir} onSort={handleSort} />
                <th style={{ minWidth: 92 }}>Trend</th>
                <SortHeader label="7d P/L"   sortKey="pnl_7d"      active={sortKey} dir={sortDir} onSort={handleSort} />
                <SortHeader label="30d P/L"  sortKey="pnl_30d"     active={sortKey} dir={sortDir} onSort={handleSort} />
                <SortHeader label="All-time" sortKey="pnl_all"     active={sortKey} dir={sortDir} onSort={handleSort} />
                <SortHeader label="Win Rate" sortKey="win_rate"    active={sortKey} dir={sortDir} onSort={handleSort} />
                <SortHeader label="Trades"   sortKey="trade_count" active={sortKey} dir={sortDir} onSort={handleSort} />
                <SortHeader label="Volume"   sortKey="volume"      active={sortKey} dir={sortDir} onSort={handleSort} />
                <th>Category</th>
                <th style={{ minWidth: 80 }}>Last Trade</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((w, idx) => {
                const m = w.metrics;
                const points = seriesMap.get(w.wallet_address) ?? [];
                const winRatePct = m?.win_rate != null ? m.win_rate * 100 : null;

                return (
                  <tr key={w.wallet_address} className={w.is_active ? '' : 'copy-row-inactive'}>
                    {/* Rank */}
                    <td className="copy-td-rank">
                      {idx + 1}
                    </td>

                    {/* Wallet identity */}
                    <td>
                      <span className="copy-td-name">
                        {w.display_name ?? <span className="copy-td-muted">Unnamed</span>}
                      </span>
                      <span
                        className="copy-td-sub copy-mono"
                        title={w.wallet_address}
                        style={{ cursor: 'default' }}
                      >
                        {truncate(w.wallet_address)}
                      </span>
                    </td>

                    {/* Active toggle */}
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

                    {/* Copy score — prominent */}
                    <td className="copy-td-num">
                      {m?.copy_score != null ? (
                        <span className={`copy-score-badge ${scoreColor(m.copy_score)}`}>
                          {m.copy_score.toFixed(1)}
                        </span>
                      ) : (
                        <span className="copy-td-muted">—</span>
                      )}
                    </td>

                    {/* Sparkline */}
                    <td className="copy-td-sparkline">
                      <WalletSparkline
                        points={points}
                        walletAddress={w.wallet_address}
                      />
                    </td>

                    {/* P/L fields */}
                    <td className={`copy-td-num ${pnlClass(m?.pnl_7d)}`}>
                      {fmtCompact(m?.pnl_7d)}
                    </td>
                    <td className={`copy-td-num ${pnlClass(m?.pnl_30d)}`}>
                      {fmtCompact(m?.pnl_30d)}
                    </td>
                    <td className={`copy-td-num ${pnlClass(m?.pnl_all)}`}>
                      {fmtCompact(m?.pnl_all)}
                    </td>

                    {/* Win rate with mini bar */}
                    <td className="copy-td-num">
                      {winRatePct != null ? (
                        <div className="copy-winrate">
                          <span style={{ color: winRatePct >= 55 ? '#34d399' : winRatePct >= 40 ? '#fbbf24' : '#f87171' }}>
                            {fmtPct(m?.win_rate)}
                          </span>
                          <div className="copy-winrate-bar">
                            <div
                              className="copy-winrate-fill"
                              style={{
                                width: `${Math.min(100, winRatePct)}%`,
                                background: winRatePct >= 55 ? '#34d399' : winRatePct >= 40 ? '#fbbf24' : '#f87171',
                              }}
                            />
                          </div>
                        </div>
                      ) : (
                        <span className="copy-td-muted">—</span>
                      )}
                    </td>

                    {/* Trades */}
                    <td className="copy-td-num copy-td-muted">{fmtNum(m?.trade_count)}</td>

                    {/* Volume */}
                    <td className="copy-td-num copy-td-muted">{fmtCompact(m?.volume)}</td>

                    {/* Category */}
                    <td>
                      {m?.category_focus ? (
                        <span className="copy-badge copy-badge-purple">{m.category_focus}</span>
                      ) : (
                        <span className="copy-td-muted">—</span>
                      )}
                    </td>

                    {/* Last trade */}
                    <td className="copy-td-muted" style={{ fontSize: '0.71rem', whiteSpace: 'nowrap' }}>
                      {fmtRelative(m?.last_trade_at)}
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
