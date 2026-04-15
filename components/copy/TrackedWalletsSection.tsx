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
  // Bot counts injected by GET /api/copy/wallets
  bot_count: number;           // total bots linked to this wallet
  bots_enabled_count: number;  // how many of those bots are currently enabled
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
  if (abs >= 1_000)     return `${prefix}${(abs / 1_000).toFixed(1)}K`;
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
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs  = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const truncate = (addr: string) =>
  addr.length > 14 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr;

const walletLabel = (w: WalletRow) =>
  w.display_name || truncate(w.wallet_address);

function scoreColor(score: number | null | undefined): string {
  if (score == null) return 'copy-score-none';
  if (score >= 70)   return 'copy-score-high';
  if (score >= 40)   return 'copy-score-mid';
  return 'copy-score-low';
}

function pnlClass(v: number | null | undefined): string {
  if (v == null) return 'copy-td-muted';
  return v >= 0 ? 'copy-num-pos' : 'copy-num-neg';
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ExternalLinkIcon() {
  return (
    <svg
      className="copy-wallet-ext-icon"
      width="10" height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
      <polyline points="15 3 21 3 21 9"/>
      <line x1="10" y1="14" x2="21" y2="3"/>
    </svg>
  );
}

function WalletAddressRow({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  return (
    <div className="copy-wallet-addr-row">
      <span className="copy-td-sub copy-mono" title={address}>
        {truncate(address)}
      </span>
      <button
        className="copy-wallet-copy-btn"
        onClick={handleCopy}
        title={copied ? 'Copied!' : 'Copy address'}
        aria-label="Copy wallet address"
      >
        {copied ? (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
        )}
      </button>
    </div>
  );
}

function EmptyWallets({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="copy-empty">
      <div className="copy-empty-icon">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/>
          <path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/>
          <path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>
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
    <th className={`copy-th-sort${isActive ? ` ${dir}` : ''}`} onClick={() => onSort(sortKey)} title={`Sort by ${label}`}>
      {label}
    </th>
  );
}

// ── Bot count badge per wallet row ──────────────────────────────────────────
// Green:  all bots enabled        → "3"
// Orange: some bots disabled      → "1/3"
// Grey:   all bots disabled / 0   → "0" (muted) or "0/3" (warning)

function BotCountBadge({ total, enabled }: { total: number; enabled: number }) {
  if (total === 0) {
    return <span className="copy-wallet-bots copy-wallet-bots-none">—</span>;
  }
  if (enabled === total) {
    return (
      <span className="copy-wallet-bots copy-wallet-bots-ok" title={`${total} bot${total !== 1 ? 's' : ''}, all enabled`}>
        {total}
      </span>
    );
  }
  if (enabled === 0) {
    return (
      <span className="copy-wallet-bots copy-wallet-bots-off" title={`${total} bot${total !== 1 ? 's' : ''}, all disabled — re-enable from Bots tab`}>
        0/{total}
      </span>
    );
  }
  return (
    <span className="copy-wallet-bots copy-wallet-bots-partial" title={`${enabled} of ${total} bot${total !== 1 ? 's' : ''} enabled`}>
      {enabled}/{total}
    </span>
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

  // Sort state
  const [sortKey, setSortKey] = useState<SortKey>('copy_score');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkWorking, setBulkWorking] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  // Add wallet form
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

  // ── Sort ──────────────────────────────────────────────────────────────────

  const handleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else { setSortKey(key); setSortDir('desc'); }
  };

  const sorted = useMemo(() => {
    return [...wallets].sort((a, b) => {
      const av = a.metrics?.[sortKey] ?? -Infinity;
      const bv = b.metrics?.[sortKey] ?? -Infinity;
      return sortDir === 'desc' ? (bv as number) - (av as number) : (av as number) - (bv as number);
    });
  }, [wallets, sortKey, sortDir]);

  // ── Toggle single wallet ──────────────────────────────────────────────────

  const handleToggleActive = async (wallet: WalletRow) => {
    const turningOff = wallet.is_active;
    const linkedCount = wallet.bot_count ?? 0;

    // Always confirm before toggling — make the bot sync effect explicit
    const botLine = linkedCount > 0
      ? `\nThis will also ${turningOff ? 'disable' : 're-enable'} ${linkedCount} linked bot${linkedCount !== 1 ? 's' : ''}.`
      : '';
    const confirmed = window.confirm(
      `${turningOff ? 'Disable' : 'Enable'} "${walletLabel(wallet)}"?${botLine}`
    );
    if (!confirmed) return;

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
        // Reload to get fresh bot counts from the server
        await load();
      }
    } finally {
      setTogglingId(null);
    }
  };

  // ── Bulk selection helpers ────────────────────────────────────────────────

  const allSelected = wallets.length > 0 && selectedIds.size === wallets.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

  const toggleSelect = (addr: string) =>
    setSelectedIds((prev) => { const s = new Set(prev); s.has(addr) ? s.delete(addr) : s.add(addr); return s; });

  const toggleSelectAll = () =>
    setSelectedIds(allSelected ? new Set() : new Set(wallets.map((w) => w.wallet_address)));

  const clearSelection = () => setSelectedIds(new Set());

  // ── Bulk toggle selected wallets + their linked bots ─────────────────────
  // Syncs all selected wallets to the specified is_active value.
  // Linked bots are mirrored automatically by the API (wallet is master switch).

  const handleBulkSetActive = async (activate: boolean) => {
    const targets  = wallets.filter((w) => selectedIds.has(w.wallet_address));
    const toChange = targets.filter((w) => w.is_active !== activate);
    const totalBots = toChange.reduce((sum, w) => sum + (w.bot_count ?? 0), 0);

    if (toChange.length === 0) {
      window.alert(`All selected wallets are already ${activate ? 'active' : 'inactive'}.`);
      clearSelection();
      return;
    }

    const verb    = activate ? 'Enable' : 'Disable';
    const verbPast = activate ? 'enabled' : 'disabled';
    const botLine = totalBots > 0
      ? `\nThis will also ${activate ? 're-enable' : 'disable'} ${totalBots} linked bot${totalBots !== 1 ? 's' : ''}.`
      : '';

    const confirmed = window.confirm(
      `${verb} ${toChange.length} wallet${toChange.length !== 1 ? 's' : ''}?${botLine}`
    );
    if (!confirmed) return;

    setBulkWorking(true);
    try {
      await Promise.all(
        toChange.map((w) =>
          fetch('/api/copy/wallets', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wallet_address: w.wallet_address, is_active: activate }),
            cache: 'no-store',
          })
        )
      );
      await load();
      clearSelection();
      const botsNote = totalBots > 0 ? ` and ${totalBots} linked bot${totalBots !== 1 ? 's' : ''}` : '';
      setBulkResult(`${toChange.length} wallet${toChange.length !== 1 ? 's' : ''}${botsNote} ${verbPast}.`);
      setTimeout(() => setBulkResult(null), 5000);
    } finally {
      setBulkWorking(false);
    }
  };

  // ── Add wallet ────────────────────────────────────────────────────────────

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

  // ─── Render ──────────────────────────────────────────────────────────────

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
          <button className="copy-btn copy-btn-secondary copy-btn-sm" onClick={load} disabled={loading} title="Refresh">↻</button>
          <button
            className={`copy-btn copy-btn-sm ${showForm ? 'copy-btn-secondary' : 'copy-btn-primary'}`}
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? 'Cancel' : '+ Add Wallet'}
          </button>
        </div>
      </div>

      {/* Bulk action result */}
      {bulkResult && (
        <div className="copy-backfill-result">✓ {bulkResult}</div>
      )}

      {/* ── Bulk selection bar (appears when selection > 0) ── */}
      {!loading && wallets.length > 0 && (
        <div className="copy-bulk-bar">
          <label className="copy-bulk-bar-select-all" title={allSelected ? 'Deselect all' : 'Select all'}>
            <input
              type="checkbox"
              className="copy-bulk-check"
              checked={allSelected}
              ref={(el) => { if (el) el.indeterminate = someSelected; }}
              onChange={toggleSelectAll}
            />
            <span style={{ fontSize: '0.75rem', color: 'rgba(248,250,252,0.5)' }}>
              {selectedIds.size > 0 ? `${selectedIds.size} selected` : 'Select'}
            </span>
          </label>

          {selectedIds.size > 0 && (
            <>
              <button className="copy-btn copy-btn-secondary copy-btn-sm" onClick={clearSelection}>
                Clear
              </button>
              <div style={{ display: 'flex', gap: '0.4rem', marginLeft: 'auto' }}>
                <button
                  className="copy-btn copy-btn-secondary copy-btn-sm"
                  onClick={() => handleBulkSetActive(true)}
                  disabled={bulkWorking}
                  title="Enable selected wallets and re-enable their linked bots"
                >
                  {bulkWorking ? '…' : `Enable (${selectedIds.size})`}
                </button>
                <button
                  className="copy-btn copy-btn-sm copy-btn-danger"
                  onClick={() => handleBulkSetActive(false)}
                  disabled={bulkWorking}
                  title="Disable selected wallets and disable their linked bots"
                >
                  {bulkWorking ? 'Working…' : `Disable (${selectedIds.size})`}
                </button>
              </div>
            </>
          )}
        </div>
      )}

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
                {/* Checkbox column */}
                <th style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    className="copy-bulk-check"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected; }}
                    onChange={toggleSelectAll}
                    title={allSelected ? 'Deselect all' : 'Select all'}
                  />
                </th>
                <th className="copy-th-rank">#</th>
                <th style={{ minWidth: 180 }}>Wallet</th>
                <th style={{ minWidth: 50 }}>Active</th>
                <th style={{ minWidth: 60 }} title="Linked copy bots (enabled / total)">Bots</th>
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
                const m        = w.metrics;
                const points   = seriesMap.get(w.wallet_address) ?? [];
                const winPct   = m?.win_rate != null ? m.win_rate * 100 : null;
                const isSelected = selectedIds.has(w.wallet_address);

                // No hint needed — bots always mirror wallet active state now

                return (
                  <tr
                    key={w.wallet_address}
                    className={[
                      w.is_active ? '' : 'copy-row-inactive',
                      isSelected ? 'copy-row-selected' : '',
                    ].filter(Boolean).join(' ')}
                  >
                    {/* Row checkbox */}
                    <td>
                      <input
                        type="checkbox"
                        className="copy-bulk-check"
                        checked={isSelected}
                        onChange={() => toggleSelect(w.wallet_address)}
                      />
                    </td>

                    {/* Rank */}
                    <td className="copy-td-rank">{idx + 1}</td>

                    {/* Wallet identity */}
                    <td>
                      {/* Display name links to Polymarket profile */}
                      <a
                        className="copy-td-name copy-wallet-pm-link"
                        href={`https://polymarket.com/profile/${w.wallet_address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="View on Polymarket"
                      >
                        {w.display_name ?? <span style={{ opacity: 0.45 }}>Unnamed</span>}
                        <ExternalLinkIcon />
                      </a>
                      {/* Address row: copy-to-clipboard + truncated address */}
                      <WalletAddressRow address={w.wallet_address} />
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

                    {/* Linked bots count */}
                    <td className="copy-td-num">
                      <BotCountBadge total={w.bot_count} enabled={w.bots_enabled_count} />
                    </td>

                    {/* Copy score */}
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
                      <WalletSparkline points={points} walletAddress={w.wallet_address} />
                    </td>

                    {/* P/L */}
                    <td className={`copy-td-num ${pnlClass(m?.pnl_7d)}`}>{fmtCompact(m?.pnl_7d)}</td>
                    <td className={`copy-td-num ${pnlClass(m?.pnl_30d)}`}>{fmtCompact(m?.pnl_30d)}</td>
                    <td className={`copy-td-num ${pnlClass(m?.pnl_all)}`}>{fmtCompact(m?.pnl_all)}</td>

                    {/* Win rate */}
                    <td className="copy-td-num">
                      {winPct != null ? (
                        <div className="copy-winrate">
                          <span style={{ color: winPct >= 55 ? '#34d399' : winPct >= 40 ? '#fbbf24' : '#f87171' }}>
                            {fmtPct(m?.win_rate)}
                          </span>
                          <div className="copy-winrate-bar">
                            <div
                              className="copy-winrate-fill"
                              style={{
                                width: `${Math.min(100, winPct)}%`,
                                background: winPct >= 55 ? '#34d399' : winPct >= 40 ? '#fbbf24' : '#f87171',
                              }}
                            />
                          </div>
                        </div>
                      ) : (
                        <span className="copy-td-muted">—</span>
                      )}
                    </td>

                    <td className="copy-td-num copy-td-muted">{fmtNum(m?.trade_count)}</td>
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
