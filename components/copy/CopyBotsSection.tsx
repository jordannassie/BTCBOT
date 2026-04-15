'use client';

import { useCallback, useEffect, useState } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

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
  notes: string | null;
  updated_at: string;
};

type TrackedWallet = { wallet_address: string; display_name: string | null };

type GlobalSettings = {
  live_on: boolean;
  emergency_stop: boolean;
};

type LiveReadiness = 'PAPER_ONLY' | 'LIVE_BLOCKED' | 'LIVE_READY' | 'LIVE_STOPPED';

// ─── Edit form state ──────────────────────────────────────────────────────────

type EditForm = {
  name: string;
  wallet_address: string;
  mode: 'PAPER' | 'LIVE';
  is_enabled: boolean;
  arm_live: boolean;
  copy_mode: string;
  sizing_value: string;
  max_trade_size: string;
  max_open_positions: string;
  max_trades_per_hour: string;
  max_slippage: string;
  delay_seconds: string;
  opens_only: boolean;
  copy_closes: boolean;
  notes: string;
};

function botToForm(bot: CopyBot): EditForm {
  return {
    name: bot.name,
    wallet_address: bot.wallet_address,
    mode: bot.mode,
    is_enabled: bot.is_enabled,
    arm_live: bot.arm_live,
    copy_mode: bot.copy_mode,
    sizing_value: String(bot.sizing_value),
    max_trade_size: String(bot.max_trade_size),
    max_open_positions: String(bot.max_open_positions),
    max_trades_per_hour: String(bot.max_trades_per_hour),
    max_slippage: String(bot.max_slippage),
    delay_seconds: String(bot.delay_seconds),
    opens_only: bot.opens_only ?? false,
    copy_closes: bot.copy_closes ?? true,
    notes: bot.notes ?? '',
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Sub-components ───────────────────────────────────────────────────────────

function ReadinessBadge({ readiness }: { readiness: LiveReadiness }) {
  const map: Record<LiveReadiness, { cls: string; dot: string; label: string; title: string }> = {
    PAPER_ONLY:   { cls: 'copy-readiness-paper',   dot: 'copy-readiness-dot-paper',   label: 'Paper Only',   title: 'Bot is in PAPER mode — no real orders.' },
    LIVE_BLOCKED: { cls: 'copy-readiness-blocked',  dot: 'copy-readiness-dot-blocked', label: 'Live Blocked', title: 'LIVE mode but one or more gates are off.' },
    LIVE_READY:   { cls: 'copy-readiness-ready',    dot: 'copy-readiness-dot-ready',   label: 'Live Ready',   title: 'All gates open — bot CAN place live orders.' },
    LIVE_STOPPED: { cls: 'copy-readiness-stopped',  dot: 'copy-readiness-dot-stopped', label: 'Live Stopped', title: 'Emergency stop is ACTIVE.' },
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
  if (armed) return <span className="copy-badge copy-badge-arm-live" title="ARM LIVE is on">Armed</span>;
  return <span className="copy-badge copy-badge-disabled" title="ARM LIVE is off">Safe</span>;
}

function IconEdit() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  );
}

function IconTrash() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6l-1 14H6L5 6"/>
      <path d="M10 11v6M14 11v6"/>
      <path d="M9 6V4h6v2"/>
    </svg>
  );
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

// ─── Edit Modal ───────────────────────────────────────────────────────────────

interface EditModalProps {
  bot: CopyBot;
  wallets: TrackedWallet[];
  onClose: () => void;
  onSaved: (updated: CopyBot) => void;
}

function EditModal({ bot, wallets, onClose, onSaved }: EditModalProps) {
  const [form, setForm] = useState<EditForm>(botToForm(bot));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof EditForm, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Bot name is required'); return; }
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/copy/bots/${bot.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          wallet_address: form.wallet_address.trim(),
          mode: form.mode,
          is_enabled: form.is_enabled,
          arm_live: form.arm_live,
          copy_mode: form.copy_mode,
          sizing_value: parseFloat(form.sizing_value) || 1,
          max_trade_size: parseFloat(form.max_trade_size) || 25,
          max_open_positions: parseInt(form.max_open_positions, 10) || 10,
          max_trades_per_hour: parseInt(form.max_trades_per_hour, 10) || 20,
          max_slippage: parseFloat(form.max_slippage) || 0.03,
          delay_seconds: parseInt(form.delay_seconds, 10) || 0,
          opens_only: form.opens_only,
          copy_closes: form.copy_closes,
          notes: form.notes.trim() || null,
        }),
        cache: 'no-store',
      });
      const payload = await res.json();
      if (!payload.ok) { setError(payload.error ?? 'Save failed'); return; }
      onSaved(payload.row);
    } catch {
      setError('Network error saving bot');
    } finally {
      setSaving(false);
    }
  };

  // Close on overlay click
  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="copy-modal-overlay" onClick={handleOverlayClick}>
      <div className="copy-modal" role="dialog" aria-modal="true" aria-label="Edit Copy Bot">
        <div className="copy-modal-header">
          <h3 className="copy-modal-title">Edit Copy Bot</h3>
          <button className="copy-modal-close" onClick={onClose} type="button" aria-label="Close">×</button>
        </div>

        <form className="copy-modal-body" onSubmit={handleSubmit}>
          <div className="copy-form-grid">

            {/* Bot name */}
            <div className="copy-form-field">
              <label className="copy-form-label">Bot Name <span style={{ color: '#f87171' }}>*</span></label>
              <input className="copy-form-input" value={form.name} onChange={(e) => set('name', e.target.value)} />
            </div>

            {/* Wallet */}
            <div className="copy-form-field">
              <label className="copy-form-label">Source Wallet</label>
              {wallets.length > 0 ? (
                <select className="copy-form-select" value={form.wallet_address} onChange={(e) => set('wallet_address', e.target.value)}>
                  {wallets.map((w) => (
                    <option key={w.wallet_address} value={w.wallet_address}>
                      {w.display_name ? `${w.display_name} (${truncate(w.wallet_address)})` : truncate(w.wallet_address)}
                    </option>
                  ))}
                </select>
              ) : (
                <input className="copy-form-input" value={form.wallet_address} onChange={(e) => set('wallet_address', e.target.value)} />
              )}
            </div>

            {/* Mode */}
            <div className="copy-form-field">
              <label className="copy-form-label">Mode</label>
              <select className="copy-form-select" value={form.mode} onChange={(e) => set('mode', e.target.value as 'PAPER' | 'LIVE')}>
                <option value="PAPER">PAPER — simulated (safe default)</option>
                <option value="LIVE">LIVE — real orders (use with care)</option>
              </select>
            </div>

            {/* Copy mode */}
            <div className="copy-form-field">
              <label className="copy-form-label">Copy Mode</label>
              <select className="copy-form-select" value={form.copy_mode} onChange={(e) => set('copy_mode', e.target.value)}>
                <option value="scaled">Scaled — multiplier of source size</option>
                <option value="exact">Exact — fixed USD per trade</option>
                <option value="percent">Percent — % of bankroll</option>
              </select>
            </div>

            {/* Sizing */}
            <div className="copy-form-field">
              <label className="copy-form-label">Sizing Value</label>
              <input className="copy-form-input" type="number" step="0.01" value={form.sizing_value} onChange={(e) => set('sizing_value', e.target.value)} />
              <span className="copy-form-hint">Multiplier, USD, or % depending on copy mode</span>
            </div>

            {/* Max trade size */}
            <div className="copy-form-field">
              <label className="copy-form-label">Max Trade Size ($)</label>
              <input className="copy-form-input" type="number" step="1" min="0" value={form.max_trade_size} onChange={(e) => set('max_trade_size', e.target.value)} />
            </div>

            {/* Max open positions */}
            <div className="copy-form-field">
              <label className="copy-form-label">Max Open Positions</label>
              <input className="copy-form-input" type="number" step="1" min="0" value={form.max_open_positions} onChange={(e) => set('max_open_positions', e.target.value)} />
            </div>

            {/* Max trades per hour */}
            <div className="copy-form-field">
              <label className="copy-form-label">Max Trades / Hour</label>
              <input className="copy-form-input" type="number" step="1" min="0" value={form.max_trades_per_hour} onChange={(e) => set('max_trades_per_hour', e.target.value)} />
            </div>

            {/* Max slippage */}
            <div className="copy-form-field">
              <label className="copy-form-label">Max Slippage</label>
              <input className="copy-form-input" type="number" step="0.001" min="0" max="1" value={form.max_slippage} onChange={(e) => set('max_slippage', e.target.value)} />
              <span className="copy-form-hint">e.g. 0.03 = 3%</span>
            </div>

            {/* Delay */}
            <div className="copy-form-field">
              <label className="copy-form-label">Delay Seconds</label>
              <input className="copy-form-input" type="number" step="1" min="0" value={form.delay_seconds} onChange={(e) => set('delay_seconds', e.target.value)} />
            </div>

            {/* Toggle row */}
            <div className="copy-form-field copy-form-toggle-row">
              <label className="copy-form-label">Enabled</label>
              <div className="toggle-switch" style={{ width: 36, height: 20 }}>
                <input type="checkbox" id="edit-is-enabled" checked={form.is_enabled} onChange={(e) => set('is_enabled', e.target.checked)} />
                <label className="toggle-slider" htmlFor="edit-is-enabled" />
              </div>
            </div>

            <div className="copy-form-field copy-form-toggle-row">
              <label className="copy-form-label">ARM LIVE</label>
              <div className="toggle-switch" style={{ width: 36, height: 20 }}>
                <input type="checkbox" id="edit-arm-live" checked={form.arm_live} onChange={(e) => set('arm_live', e.target.checked)} />
                <label className="toggle-slider" htmlFor="edit-arm-live" />
              </div>
              <span className="copy-form-hint" style={{ marginLeft: 0 }}>Secondary gate for live orders</span>
            </div>

            <div className="copy-form-field copy-form-toggle-row">
              <label className="copy-form-label">Opens Only</label>
              <div className="toggle-switch" style={{ width: 36, height: 20 }}>
                <input type="checkbox" id="edit-opens-only" checked={form.opens_only} onChange={(e) => set('opens_only', e.target.checked)} />
                <label className="toggle-slider" htmlFor="edit-opens-only" />
              </div>
              <span className="copy-form-hint" style={{ marginLeft: 0 }}>Only copy opening trades</span>
            </div>

            <div className="copy-form-field copy-form-toggle-row">
              <label className="copy-form-label">Copy Closes</label>
              <div className="toggle-switch" style={{ width: 36, height: 20 }}>
                <input type="checkbox" id="edit-copy-closes" checked={form.copy_closes} onChange={(e) => set('copy_closes', e.target.checked)} />
                <label className="toggle-slider" htmlFor="edit-copy-closes" />
              </div>
              <span className="copy-form-hint" style={{ marginLeft: 0 }}>Mirror source wallet exits</span>
            </div>

            {/* Notes — full width */}
            <div className="copy-form-field copy-form-grid-wide">
              <label className="copy-form-label">Notes</label>
              <input className="copy-form-input" value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Optional operator notes" />
            </div>
          </div>

          {error && <p className="copy-form-msg copy-form-error" style={{ marginTop: '0.5rem' }}>{error}</p>}

          <div className="copy-modal-footer">
            <button type="button" className="copy-btn copy-btn-secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="copy-btn copy-btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CopyBotsSection() {
  const [bots, setBots] = useState<CopyBot[]>([]);
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [wallets, setWallets] = useState<TrackedWallet[]>([]);

  // Edit modal
  const [editingBot, setEditingBot] = useState<CopyBot | null>(null);

  // Delete
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<{ id: string; msg: string; isFk: boolean } | null>(null);

  // Backfill
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<{ created: number; scanned: number; existing: number } | null>(null);

  // Add-bot form
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
    if (showForm || editingBot) loadWallets();
  }, [showForm, editingBot, loadWallets]);

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

  const handleDelete = async (bot: CopyBot) => {
    if (deletingId === bot.id) return;
    const confirmed = window.confirm(
      `Delete "${bot.name}"?\n\n` +
      'The bot configuration will be removed.\n' +
      'All copy history (attempts, positions) is preserved.\n' +
      'The tracked wallet is NOT deleted.\n\n' +
      'This cannot be undone.'
    );
    if (!confirmed) return;

    setDeletingId(bot.id);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/copy/bots/${bot.id}`, {
        method: 'DELETE',
        cache: 'no-store',
      });
      const payload = await res.json();
      if (payload.ok) {
        setBots((prev) => prev.filter((b) => b.id !== bot.id));
      } else {
        setDeleteError({
          id: bot.id,
          msg: payload.error ?? 'Delete failed',
          isFk: payload.fk_violation === true,
        });
      }
    } catch {
      setDeleteError({ id: bot.id, msg: 'Network error during delete', isFk: false });
    } finally {
      setDeletingId(null);
    }
  };

  const handleBackfill = async () => {
    setBackfilling(true);
    setBackfillResult(null);
    try {
      const res = await fetch('/api/copy/bots/backfill', {
        method: 'POST',
        cache: 'no-store',
      });
      const payload = await res.json();
      if (payload.ok !== false) {
        setBackfillResult({ created: payload.created, scanned: payload.scanned, existing: payload.existing });
        if (payload.created > 0) await load();
        setTimeout(() => setBackfillResult(null), 6000);
      }
    } catch {}
    finally { setBackfilling(false); }
  };

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

  // Derived live summary counts
  const liveReady   = bots.filter((b) => getLiveReadiness(b, globalSettings) === 'LIVE_READY').length;
  const liveBlocked = bots.filter((b) => getLiveReadiness(b, globalSettings) === 'LIVE_BLOCKED').length;
  const liveStopped = bots.filter((b) => getLiveReadiness(b, globalSettings) === 'LIVE_STOPPED').length;
  const paperOnly   = bots.filter((b) => getLiveReadiness(b, globalSettings) === 'PAPER_ONLY').length;

  return (
    <>
      {/* Edit Modal — rendered outside the section card to avoid z-index issues */}
      {editingBot && (
        <EditModal
          bot={editingBot}
          wallets={wallets}
          onClose={() => setEditingBot(null)}
          onSaved={(updated) => {
            setBots((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
            setEditingBot(null);
          }}
        />
      )}

      <div className="copy-section">
        {/* ── Section header ── */}
        <div className="copy-section-head">
          <div className="copy-section-title-row">
            <h2 className="copy-section-title">Copy Bots</h2>
            {!loading && bots.length > 0 && (
              <span className="copy-section-count">{bots.length}</span>
            )}
          </div>
          <div className="copy-section-actions">
            {/* Backfill — creates bots for any tracked wallets that are missing one */}
            <button
              className="copy-btn copy-btn-secondary copy-btn-sm"
              onClick={handleBackfill}
              disabled={backfilling}
              title="Create default PAPER bots for any tracked wallets that don't have one yet"
            >
              {backfilling ? 'Backfilling…' : '⊕ Backfill'}
            </button>
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

        {/* Backfill result message */}
        {backfillResult && (
          <div className="copy-backfill-result">
            {backfillResult.created > 0
              ? `✓ Created ${backfillResult.created} bot${backfillResult.created !== 1 ? 's' : ''} for wallets missing one (${backfillResult.existing} already had bots, ${backfillResult.scanned} wallets scanned).`
              : `All ${backfillResult.scanned} tracked wallets already have at least one bot. Nothing to backfill.`}
          </div>
        )}

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

        {/* Add bot form */}
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
              </div>
              <div className="copy-form-field">
                <label className="copy-form-label">Max Trade Size ($)</label>
                <input className="copy-form-input" type="number" step="1" min="0" value={fMaxTrade} onChange={(e) => setFMaxTrade(e.target.value)} />
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

        {/* ── Main content ── */}
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
                  <th title="ARM LIVE: secondary safety gate">Arm Live</th>
                  <th title="Derived readiness from mode, gates, and global settings">Live Status</th>
                  <th>Copy Mode</th>
                  <th>Sizing</th>
                  <th>Max $</th>
                  <th>Max Pos</th>
                  <th>/Hr</th>
                  <th>Slip.</th>
                  <th>Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {bots.map((bot) => {
                  const readiness = getLiveReadiness(bot, globalSettings);
                  const isDeleting = deletingId === bot.id;
                  const rowDeleteError = deleteError?.id === bot.id ? deleteError : null;

                  return (
                    <>
                      <tr key={bot.id} style={isDeleting ? { opacity: 0.5 } : undefined}>
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
                        <td><ReadinessBadge readiness={readiness} /></td>
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
                        <td>
                          <div className="copy-bot-actions">
                            <button
                              className="copy-bot-action-btn copy-bot-action-edit"
                              onClick={() => setEditingBot(bot)}
                              title="Edit bot settings"
                              disabled={isDeleting}
                            >
                              <IconEdit />
                            </button>
                            <button
                              className="copy-bot-action-btn copy-bot-action-delete"
                              onClick={() => handleDelete(bot)}
                              title="Delete this bot"
                              disabled={isDeleting || togglingId === bot.id}
                            >
                              <IconTrash />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {/* Inline delete error shown directly below the affected row */}
                      {rowDeleteError && (
                        <tr key={`${bot.id}-err`}>
                          <td colSpan={14} style={{ padding: '0 1.5rem 0.6rem' }}>
                            <div className="copy-bot-delete-error">
                              <span>{rowDeleteError.msg}</span>
                              {rowDeleteError.isFk && (
                                <button
                                  className="copy-btn copy-btn-secondary copy-btn-sm"
                                  style={{ marginLeft: '0.75rem' }}
                                  onClick={() => {
                                    setDeleteError(null);
                                    patchBot(bot.id, { is_enabled: false });
                                  }}
                                >
                                  Disable instead
                                </button>
                              )}
                              <button
                                className="copy-bot-delete-error-dismiss"
                                onClick={() => setDeleteError(null)}
                                title="Dismiss"
                              >
                                ×
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
