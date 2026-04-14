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

type GlobalSettings = {
  live_on: boolean;
  emergency_stop: boolean;
};

type LiveReadiness = 'PAPER_ONLY' | 'LIVE_BLOCKED' | 'LIVE_READY' | 'LIVE_STOPPED';

const truncate = (addr: string) =>
  addr.length > 14 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr;
const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function getLiveReadiness(bot: CopyBot, gs: GlobalSettings | null): LiveReadiness {
  if (bot.mode !== 'LIVE') return 'PAPER_ONLY';
  if (gs?.emergency_stop) return 'LIVE_STOPPED';
  if (!bot.is_enabled || !bot.arm_live || !gs?.live_on) return 'LIVE_BLOCKED';
  return 'LIVE_READY';
}

function ReadinessBadge({ readiness }: { readiness: LiveReadiness }) {
  const map: Record<LiveReadiness, { cls: string; dot: string; label: string; title: string }> = {
    PAPER_ONLY:   { cls: 'copy-readiness-paper',   dot: 'copy-readiness-dot-paper',   label: 'Paper Only',    title: 'Bot is in PAPER mode — no real orders will be placed.' },
    LIVE_BLOCKED: { cls: 'copy-readiness-blocked',  dot: 'copy-readiness-dot-blocked', label: 'Live Blocked',  title: 'Bot is LIVE mode but one or more gates are off (is_enabled, arm_live, or global live_on).' },
    LIVE_READY:   { cls: 'copy-readiness-ready',    dot: 'copy-readiness-dot-ready',   label: 'Live Ready',    title: 'All gates are open — this bot CAN place live orders.' },
    LIVE_STOPPED: { cls: 'copy-readiness-stopped',  dot: 'copy-readiness-dot-stopped', label: 'Live Stopped',  title: 'Emergency stop is ACTIVE — all live execution is halted.' },
  };
  const { cls, dot, label, title } = map[readiness];
  return (
    <span className={`copy-readiness ${cls}`} title={title}>
      <span className={`copy-readiness-dot ${dot}`} />
      {label}
    </span>
  );
}

function ModeBadge({ mode }: { mode: 'PAPER' | 'LIVE' }) {
  return mode === 'LIVE'
    ? <span className="copy-badge copy-badge-live">LIVE</span>
    : <span className="copy-badge copy-badge-paper">PAPER</span>;
}

function ArmLiveBadge({ armed, mode }: { armed: boolean; mode: 'PAPER' | 'LIVE' }) {
  if (mode === 'PAPER') return <span className="copy-badge copy-badge-disabled" title="ARM LIVE has no effect in PAPER mode">—</span>;
  if (armed) return <span className="copy-badge copy-badge-arm-live" title="ARM LIVE is on — bot will attempt live orders when global gate opens">Armed</span>;
  return <span className="copy-badge copy-badge-disabled" title="ARM LIVE is off — bot will not place live orders even if global gate is on">Safe</span>;
}

function EmptyBots({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="copy-empty">
      <div className="copy-empty-icon">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/>
        </svg>
      </div>
      <p className="copy-empty-title">No copy bots yet</p>
      <p className="copy-empty-sub">Create a PAPER bot to test strategy before enabling live execution.</p>
      <button className="copy-btn copy-btn-primary" style={{ marginTop: '1rem' }} onClick={onAdd}>
        + Create Bot
      </button>
    </div>
  );
}

export default function CopyBotsSection() {
  const [bots, setBots] = useState<CopyBot[]>([]);
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [wallets, setWallets] = useState<TrackedWallet[]>([]);

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
      const [botsRes, settingsRes] = await Promise.all([
        fetch('/api/copy/bots', { cache: 'no-store' }),
        fetch('/api/copy/settings', { cache: 'no-store' }),
      ]);
      const botsPayload = await botsRes.json();
      const settingsPayload = await settingsRes.json();
      if (botsPayload.ok) setBots(botsPayload.rows ?? []);
      else setError(botsPayload.error ?? 'Failed to load bots');
      if (settingsPayload.ok && settingsPayload.settings) {
        setGlobalSettings({
          live_on: settingsPayload.settings.live_on,
          emergency_stop: settingsPayload.settings.emergency_stop,
        });
      }
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
    if (!fName.trim()) { setFError('Bot name is required'); return; }
    if (!fWallet.trim()) { setFError('Source wallet is required'); return; }
    setFSaving(true);
    try {
      const res = await fetch('/api/copy/bots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: fName.trim(), wallet_address: fWallet.trim(), mode: fMode,
          copy_mode: fCopyMode, sizing_value: parseFloat(fSizingValue) || 1,
          max_trade_size: parseFloat(fMaxTrade) || 25,
          max_open_positions: parseInt(fMaxPos, 10) || 10,
          max_trades_per_hour: parseInt(fMaxPerHr, 10) || 20,
          max_slippage: parseFloat(fMaxSlippage) || 0.03,
          delay_seconds: parseInt(fDelay, 10) || 0,
        }),
        cache: 'no-store',
      });
      const payload = await res.json();
      if (!payload.ok) { setFError(payload.error ?? 'Failed to create bot'); return; }
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

  // Derive live summary counts
  const liveReady   = bots.filter((b) => getLiveReadiness(b, globalSettings) === 'LIVE_READY').length;
  const liveBlocked = bots.filter((b) => getLiveReadiness(b, globalSettings) === 'LIVE_BLOCKED').length;
  const liveStopped = bots.filter((b) => getLiveReadiness(b, globalSettings) === 'LIVE_STOPPED').length;
  const paperOnly   = bots.filter((b) => getLiveReadiness(b, globalSettings) === 'PAPER_ONLY').length;

  return (
    <div className="copy-section">
      <div className="copy-section-head">
        <div className="copy-section-title-row">
          <h2 className="copy-section-title">Copy Bots</h2>
          {!loading && bots.length > 0 && (
            <span className="copy-section-count">{bots.length}</span>
          )}
        </div>
        <div className="copy-section-actions">
          <button className="copy-btn copy-btn-secondary copy-btn-sm" onClick={load} disabled={loading} title="Refresh">
            ↻
          </button>
          <button
            className={`copy-btn copy-btn-sm ${showForm ? 'copy-btn-secondary' : 'copy-btn-primary'}`}
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? 'Cancel' : '+ Add Bot'}
          </button>
        </div>
      </div>

      {/* Live summary bar */}
      {!loading && bots.length > 0 && (
        <div className="copy-live-summary">
          <div className="copy-live-summary-item">
            <span className="copy-live-summary-value copy-live-summary-value-green">{liveReady}</span>
            <span>Live Ready</span>
          </div>
          <div className="copy-live-summary-sep" />
          <div className="copy-live-summary-item">
            <span className="copy-live-summary-value copy-live-summary-value-yellow">{liveBlocked}</span>
            <span>Live Blocked</span>
          </div>
          {liveStopped > 0 && (
            <>
              <div className="copy-live-summary-sep" />
              <div className="copy-live-summary-item">
                <span className="copy-live-summary-value copy-live-summary-value-red">{liveStopped}</span>
                <span>Stopped</span>
              </div>
            </>
          )}
          <div className="copy-live-summary-sep" />
          <div className="copy-live-summary-item">
            <span className="copy-live-summary-value copy-live-summary-value-gray">{paperOnly}</span>
            <span>Paper Only</span>
          </div>
          {globalSettings && (
            <>
              <div className="copy-live-summary-sep" />
              <div className="copy-live-summary-item">
                {globalSettings.emergency_stop ? (
                  <span style={{ color: '#f87171', fontWeight: 700, fontSize: '0.72rem' }}>⛔ Emergency Stop Active</span>
                ) : globalSettings.live_on ? (
                  <span style={{ color: '#34d399', fontWeight: 700, fontSize: '0.72rem' }}>● Gate Open</span>
                ) : (
                  <span style={{ color: 'rgba(248,250,252,0.35)', fontSize: '0.72rem' }}>Gate Closed</span>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {showForm && (
        <form className="copy-add-form" onSubmit={handleAddBot}>
          <div className="copy-form-title">Create Copy Bot</div>
          <div className="copy-form-grid">
            <div className="copy-form-field">
              <label className="copy-form-label">Bot Name <span style={{ color: '#f87171' }}>*</span></label>
              <input className="copy-form-input" value={fName} onChange={(e) => setFName(e.target.value)} placeholder="e.g. Copy — Whale A" />
            </div>
            <div className="copy-form-field">
              <label className="copy-form-label">Source Wallet <span style={{ color: '#f87171' }}>*</span></label>
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
                <option value="PAPER">PAPER — simulated (safe default)</option>
                <option value="LIVE">LIVE — real orders (use with care)</option>
              </select>
              <span className="copy-form-hint">Start with PAPER to validate before going live</span>
            </div>
            <div className="copy-form-field">
              <label className="copy-form-label">Copy Mode</label>
              <select className="copy-form-select" value={fCopyMode} onChange={(e) => setFCopyMode(e.target.value)}>
                <option value="scaled">Scaled — multiplier of source size</option>
                <option value="exact">Exact — fixed USD per trade</option>
                <option value="percent">Percent — % of bankroll</option>
              </select>
            </div>
            <div className="copy-form-field">
              <label className="copy-form-label">Sizing Value</label>
              <input className="copy-form-input" type="number" step="0.01" value={fSizingValue} onChange={(e) => setFSizingValue(e.target.value)} />
              <span className="copy-form-hint">Multiplier, USD, or % depending on mode</span>
            </div>
            <div className="copy-form-field">
              <label className="copy-form-label">Max Trade Size ($)</label>
              <input className="copy-form-input" type="number" step="1" min="0" value={fMaxTrade} onChange={(e) => setFMaxTrade(e.target.value)} />
              <span className="copy-form-hint">Hard cap per individual trade in USD</span>
            </div>
            <div className="copy-form-field">
              <label className="copy-form-label">Max Open Positions</label>
              <input className="copy-form-input" type="number" step="1" min="0" value={fMaxPos} onChange={(e) => setFMaxPos(e.target.value)} />
            </div>
            <div className="copy-form-field">
              <label className="copy-form-label">Max Trades / Hour</label>
              <input className="copy-form-input" type="number" step="1" min="0" value={fMaxPerHr} onChange={(e) => setFMaxPerHr(e.target.value)} />
            </div>
            <div className="copy-form-field">
              <label className="copy-form-label">Max Slippage</label>
              <input className="copy-form-input" type="number" step="0.001" min="0" max="1" value={fMaxSlippage} onChange={(e) => setFMaxSlippage(e.target.value)} />
              <span className="copy-form-hint">e.g. 0.03 = 3% tolerance</span>
            </div>
            <div className="copy-form-field">
              <label className="copy-form-label">Delay Seconds</label>
              <input className="copy-form-input" type="number" step="1" min="0" value={fDelay} onChange={(e) => setFDelay(e.target.value)} />
              <span className="copy-form-hint">Intentional lag after source trade is observed</span>
            </div>
          </div>
          <div className="copy-form-actions">
            <button className="copy-btn copy-btn-primary" type="submit" disabled={fSaving}>
              {fSaving ? 'Creating…' : 'Create Bot'}
            </button>
            {fError && <span className="copy-form-msg copy-form-error">{fError}</span>}
            {fSuccess && <span className="copy-form-msg copy-form-success">Bot created successfully.</span>}
          </div>
        </form>
      )}

      {loading ? (
        <div className="copy-loading">Loading bots…</div>
      ) : error ? (
        <div className="copy-empty">
          <p className="copy-empty-title" style={{ color: '#f87171' }}>{error}</p>
        </div>
      ) : bots.length === 0 ? (
        <EmptyBots onAdd={() => setShowForm(true)} />
      ) : (
        <div className="copy-table-wrap">
          <table className="copy-table">
            <thead>
              <tr>
                <th>Bot</th>
                <th>Wallet</th>
                <th>Mode</th>
                <th>Enabled</th>
                <th title="ARM LIVE: secondary safety gate — must be on for live orders">Arm Live</th>
                <th title="Derived readiness status based on mode, gates, and global settings">Live Status</th>
                <th>Copy Mode</th>
                <th>Sizing</th>
                <th>Max $</th>
                <th>Max Pos</th>
                <th>/Hr</th>
                <th>Slip.</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {bots.map((bot) => {
                const readiness = getLiveReadiness(bot, globalSettings);
                return (
                  <tr key={bot.id}>
                    <td>
                      <span className="copy-td-name">{bot.name}</span>
                    </td>
                    <td>
                      <span className="copy-mono" title={bot.wallet_address}>{truncate(bot.wallet_address)}</span>
                    </td>
                    <td><ModeBadge mode={bot.mode} /></td>
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
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
                        <ArmLiveBadge armed={bot.arm_live} mode={bot.mode} />
                      </div>
                    </td>
                    <td>
                      <ReadinessBadge readiness={readiness} />
                    </td>
                    <td>
                      <span className="copy-badge copy-badge-blue" style={{ textTransform: 'capitalize' }}>
                        {bot.copy_mode}
                      </span>
                    </td>
                    <td className="copy-td-num">{bot.sizing_value}</td>
                    <td className="copy-td-num">${bot.max_trade_size}</td>
                    <td className="copy-td-num">{bot.max_open_positions}</td>
                    <td className="copy-td-num">{bot.max_trades_per_hour}</td>
                    <td className="copy-td-num">{(bot.max_slippage * 100).toFixed(1)}%</td>
                    <td className="copy-td-muted" style={{ fontSize: '0.72rem' }}>{fmtDate(bot.updated_at)}</td>
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
