'use client';

import { useCallback, useEffect, useState } from 'react';

type CopyBot = {
  id: string;
  name: string;
  wallet_address: string;
  mode: 'PAPER' | 'LIVE';
  is_enabled: boolean;
  arm_live: boolean;
  copy_mode: string;
  sizing_value: number;
  max_trade_size: number;
  max_open_positions: number;
  max_trades_per_hour: number;
  max_slippage: number;
  opens_only: boolean;
  copy_closes: boolean;
  delay_seconds: number;
  updated_at: string;
};

type TrackedWallet = { wallet_address: string; display_name: string | null };

const truncate = (addr: string) =>
  addr.length > 14 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr;

export default function CopyBotsSection() {
  const [bots, setBots] = useState<CopyBot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [wallets, setWallets] = useState<TrackedWallet[]>([]);

  // Form fields
  const [fName, setFName] = useState('');
  const [fWallet, setFWallet] = useState('');
  const [fMode, setFMode] = useState<'PAPER' | 'LIVE'>('PAPER');
  const [fCopyMode, setFCopyMode] = useState('scaled');
  const [fSizingValue, setFSizingValue] = useState('1');
  const [fMaxTrade, setFMaxTrade] = useState('25');
  const [fMaxPos, setFMaxPos] = useState('10');
  const [fMaxPerHr, setFMaxPerHr] = useState('20');
  const [fMaxSlippage, setFMaxSlippage] = useState('0.03');
  const [fDelay, setFDelay] = useState('0');
  const [fSaving, setFSaving] = useState(false);
  const [fError, setFError] = useState<string | null>(null);
  const [fSuccess, setFSuccess] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/copy/bots', { cache: 'no-store' });
      const payload = await res.json();
      if (payload.ok) setBots(payload.rows ?? []);
      else setError(payload.error ?? 'Failed to load bots');
    } catch {
      setError('Network error loading bots');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadWallets = useCallback(async () => {
    try {
      const res = await fetch('/api/copy/wallets', { cache: 'no-store' });
      const payload = await res.json();
      if (payload.ok) setWallets(payload.rows ?? []);
    } catch {}
  }, []);

  useEffect(() => {
    if (showForm) loadWallets();
  }, [showForm, loadWallets]);

  const patchBot = useCallback(async (id: string, updates: Record<string, unknown>) => {
    setTogglingId(id);
    try {
      const res = await fetch(`/api/copy/bots/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
        cache: 'no-store',
      });
      const payload = await res.json();
      if (payload.ok && payload.row) {
        setBots((prev) => prev.map((b) => (b.id === id ? { ...b, ...payload.row } : b)));
      }
    } finally {
      setTogglingId(null);
    }
  }, []);

  const handleAddBot = async (e: React.FormEvent) => {
    e.preventDefault();
    setFError(null);
    setFSuccess(false);
    if (!fName.trim()) { setFError('Name is required'); return; }
    if (!fWallet.trim()) { setFError('Wallet address is required'); return; }
    setFSaving(true);
    try {
      const res = await fetch('/api/copy/bots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: fName.trim(),
          wallet_address: fWallet.trim(),
          mode: fMode,
          copy_mode: fCopyMode,
          sizing_value: parseFloat(fSizingValue) || 1,
          max_trade_size: parseFloat(fMaxTrade) || 25,
          max_open_positions: parseInt(fMaxPos, 10) || 10,
          max_trades_per_hour: parseInt(fMaxPerHr, 10) || 20,
          max_slippage: parseFloat(fMaxSlippage) || 0.03,
          delay_seconds: parseInt(fDelay, 10) || 0,
        }),
        cache: 'no-store',
      });
      const payload = await res.json();
      if (!payload.ok) { setFError(payload.error ?? 'Failed to add bot'); return; }
      setFName(''); setFWallet(''); setFMode('PAPER'); setFCopyMode('scaled');
      setFSizingValue('1'); setFMaxTrade('25'); setFMaxPos('10'); setFMaxPerHr('20');
      setFMaxSlippage('0.03'); setFDelay('0');
      setFSuccess(true);
      await load();
      setTimeout(() => setFSuccess(false), 2500);
    } finally {
      setFSaving(false);
    }
  };

  const modeBadge = (mode: string) =>
    mode === 'LIVE'
      ? <span className="copy-badge copy-badge-green">LIVE</span>
      : <span className="copy-badge copy-badge-blue">PAPER</span>;

  return (
    <div className="copy-section">
      <div className="copy-section-header">
        <h2 className="copy-section-title">Copy Bots</h2>
        <div className="copy-section-actions">
          <button
            className="copy-btn copy-btn-secondary copy-btn-sm"
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? 'Cancel' : '+ Add Bot'}
          </button>
        </div>
      </div>

      {showForm && (
        <form className="copy-add-form" onSubmit={handleAddBot}>
          <div className="copy-form-grid">
            <div className="copy-form-field">
              <label className="copy-form-label">Bot Name *</label>
              <input className="copy-form-input" value={fName} onChange={(e) => setFName(e.target.value)} placeholder="e.g. Copy Whale A" />
            </div>
            <div className="copy-form-field">
              <label className="copy-form-label">Source Wallet *</label>
              {wallets.length > 0 ? (
                <select className="copy-form-select" value={fWallet} onChange={(e) => setFWallet(e.target.value)}>
                  <option value="">— Select wallet —</option>
                  {wallets.map((w) => (
                    <option key={w.wallet_address} value={w.wallet_address}>
                      {w.display_name ? `${w.display_name} (${truncate(w.wallet_address)})` : truncate(w.wallet_address)}
                    </option>
                  ))}
                </select>
              ) : (
                <input className="copy-form-input" value={fWallet} onChange={(e) => setFWallet(e.target.value)} placeholder="0x… (add wallets first)" />
              )}
            </div>
            <div className="copy-form-field">
              <label className="copy-form-label">Mode</label>
              <select className="copy-form-select" value={fMode} onChange={(e) => setFMode(e.target.value as 'PAPER' | 'LIVE')}>
                <option value="PAPER">PAPER</option>
                <option value="LIVE">LIVE</option>
              </select>
            </div>
            <div className="copy-form-field">
              <label className="copy-form-label">Copy Mode</label>
              <select className="copy-form-select" value={fCopyMode} onChange={(e) => setFCopyMode(e.target.value)}>
                <option value="scaled">Scaled (multiplier)</option>
                <option value="exact">Exact (fixed USD)</option>
                <option value="percent">Percent of bankroll</option>
              </select>
            </div>
            <div className="copy-form-field">
              <label className="copy-form-label">Sizing Value</label>
              <input className="copy-form-input" type="number" step="0.01" value={fSizingValue} onChange={(e) => setFSizingValue(e.target.value)} />
            </div>
            <div className="copy-form-field">
              <label className="copy-form-label">Max Trade Size ($)</label>
              <input className="copy-form-input" type="number" step="1" value={fMaxTrade} onChange={(e) => setFMaxTrade(e.target.value)} />
            </div>
            <div className="copy-form-field">
              <label className="copy-form-label">Max Open Positions</label>
              <input className="copy-form-input" type="number" step="1" value={fMaxPos} onChange={(e) => setFMaxPos(e.target.value)} />
            </div>
            <div className="copy-form-field">
              <label className="copy-form-label">Max Trades/Hr</label>
              <input className="copy-form-input" type="number" step="1" value={fMaxPerHr} onChange={(e) => setFMaxPerHr(e.target.value)} />
            </div>
            <div className="copy-form-field">
              <label className="copy-form-label">Max Slippage (e.g. 0.03)</label>
              <input className="copy-form-input" type="number" step="0.001" value={fMaxSlippage} onChange={(e) => setFMaxSlippage(e.target.value)} />
            </div>
            <div className="copy-form-field">
              <label className="copy-form-label">Delay Seconds</label>
              <input className="copy-form-input" type="number" step="1" value={fDelay} onChange={(e) => setFDelay(e.target.value)} />
            </div>
          </div>
          <div className="copy-form-actions">
            <button className="copy-btn copy-btn-primary" type="submit" disabled={fSaving}>
              {fSaving ? 'Creating…' : 'Create Bot'}
            </button>
            {fError && <p className="copy-form-error">{fError}</p>}
            {fSuccess && <p className="copy-form-success">Bot created.</p>}
          </div>
        </form>
      )}

      {loading ? (
        <div className="copy-empty"><p>Loading bots…</p></div>
      ) : error ? (
        <div className="copy-empty"><p style={{ color: '#ef4444' }}>{error}</p></div>
      ) : bots.length === 0 ? (
        <div className="copy-empty">
          <p>No copy bots yet.</p>
          <p className="copy-empty-sub">Create a bot above to start copy-trading a tracked wallet.</p>
        </div>
      ) : (
        <div className="copy-table-wrap">
          <table className="copy-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Wallet</th>
                <th>Mode</th>
                <th>Enabled</th>
                <th>ARM LIVE</th>
                <th>Copy Mode</th>
                <th>Sizing</th>
                <th>Max Trade</th>
                <th>Max Pos</th>
                <th>Max/Hr</th>
                <th>Slippage</th>
                <th>Opens Only</th>
                <th>Delay (s)</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {bots.map((bot) => (
                <tr key={bot.id}>
                  <td style={{ fontWeight: 600 }}>{bot.name}</td>
                  <td><span className="copy-mono">{truncate(bot.wallet_address)}</span></td>
                  <td>{modeBadge(bot.mode)}</td>
                  <td>
                    <div className="toggle-switch" style={{ width: 36, height: 20 }}>
                      <input
                        type="checkbox"
                        checked={bot.is_enabled}
                        onChange={() => patchBot(bot.id, { is_enabled: !bot.is_enabled })}
                        disabled={togglingId === bot.id}
                        id={`bot-enabled-${bot.id}`}
                      />
                      <label className="toggle-slider" htmlFor={`bot-enabled-${bot.id}`} />
                    </div>
                  </td>
                  <td>
                    <div className="toggle-switch" style={{ width: 36, height: 20 }}>
                      <input
                        type="checkbox"
                        checked={bot.arm_live}
                        onChange={() => patchBot(bot.id, { arm_live: !bot.arm_live })}
                        disabled={togglingId === bot.id}
                        id={`bot-arm-${bot.id}`}
                      />
                      <label className="toggle-slider" htmlFor={`bot-arm-${bot.id}`} />
                    </div>
                  </td>
                  <td>
                    <span className="copy-badge copy-badge-gray" style={{ textTransform: 'capitalize' }}>
                      {bot.copy_mode}
                    </span>
                  </td>
                  <td>{bot.sizing_value}</td>
                  <td>${bot.max_trade_size}</td>
                  <td>{bot.max_open_positions}</td>
                  <td>{bot.max_trades_per_hour}</td>
                  <td>{(bot.max_slippage * 100).toFixed(1)}%</td>
                  <td>
                    <span className={`copy-badge ${bot.opens_only ? 'copy-badge-blue' : 'copy-badge-gray'}`}>
                      {bot.opens_only ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td>{bot.delay_seconds}s</td>
                  <td style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.72rem' }}>
                    {new Date(bot.updated_at).toLocaleString()}
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
