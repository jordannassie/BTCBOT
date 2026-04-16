'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BOT_DEFAULTS, BOT_DEFAULTS_LS_KEY } from '@/lib/copy/botDefaults';
import { SELECTED_BOTS_LS_KEY } from '@/lib/copy/masterStrategy';

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
type GlobalSettings = { live_on: boolean; emergency_stop: boolean };
type LiveReadiness = 'PAPER_ONLY' | 'LIVE_BLOCKED' | 'LIVE_READY' | 'LIVE_STOPPED';

type EditForm = {
  name: string; wallet_address: string; mode: 'PAPER' | 'LIVE';
  is_enabled: boolean; arm_live: boolean; copy_mode: string;
  sizing_value: string; max_trade_size: string; max_open_positions: string;
  max_trades_per_hour: string; max_slippage: string; delay_seconds: string;
  opens_only: boolean; copy_closes: boolean; notes: string;
};

// Bulk apply — each field has an "apply?" checkbox
type BulkFieldKey =
  | 'mode' | 'copy_mode' | 'sizing_value' | 'max_trade_size'
  | 'max_open_positions' | 'max_trades_per_hour' | 'max_slippage'
  | 'delay_seconds' | 'is_enabled' | 'arm_live' | 'opens_only'
  | 'copy_closes' | 'notes';

type BulkApply = Record<BulkFieldKey, boolean>;
type BulkForm  = EditForm; // same shape, reuse type

// ─── Field definitions for BulkEditModal ──────────────────────────────────────

type FieldDef =
  | { key: BulkFieldKey; label: string; type: 'select'; options: string[]; hint?: string }
  | { key: BulkFieldKey; label: string; type: 'number'; step?: string; min?: string; hint?: string }
  | { key: BulkFieldKey; label: string; type: 'toggle'; hint?: string }
  | { key: BulkFieldKey; label: string; type: 'text'; hint?: string };

const BULK_FIELDS: FieldDef[] = [
  { key: 'mode',               label: 'Mode',               type: 'select',  options: ['PAPER', 'LIVE'] },
  { key: 'copy_mode',          label: 'Copy Mode',          type: 'select',  options: ['scaled', 'exact', 'percent'] },
  { key: 'sizing_value',       label: 'Sizing Value',       type: 'number',  step: '0.01', min: '0', hint: 'multiplier, fixed USD, or % of bankroll' },
  { key: 'max_trade_size',     label: 'Max Trade Size ($)', type: 'number',  step: '1',    min: '0', hint: 'hard cap per individual trade' },
  { key: 'max_open_positions', label: 'Max Open Positions', type: 'number',  step: '1',    min: '0', hint: '0 = unlimited' },
  { key: 'max_trades_per_hour',label: 'Max Trades / Hour',  type: 'number',  step: '1',    min: '0', hint: '0 = unlimited' },
  { key: 'max_slippage',       label: 'Max Slippage',       type: 'number',  step: '0.001',min: '0', hint: 'e.g. 0.03 = 3% tolerance' },
  { key: 'delay_seconds',      label: 'Delay Seconds',      type: 'number',  step: '1',    min: '0', hint: 'intentional lag after source trade' },
  { key: 'is_enabled',         label: 'Enabled',            type: 'toggle' },
  { key: 'arm_live',           label: 'ARM LIVE',           type: 'toggle',  hint: 'secondary gate for live orders' },
  { key: 'opens_only',         label: 'Opens Only',         type: 'toggle',  hint: 'only copy opening trades' },
  { key: 'copy_closes',        label: 'Copy Closes',        type: 'toggle',  hint: 'mirror source wallet exits' },
  { key: 'notes',              label: 'Notes',              type: 'text',    hint: 'operator notes (optional)' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const truncate  = (addr: string) => addr.length > 14 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr;
const fmtDate   = (d: string)    => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtLimit  = (n: number)    => n === 0 ? <span title="Unlimited" style={{ opacity: 0.5 }}>∞</span> : n;

function getLiveReadiness(bot: CopyBot, gs: GlobalSettings | null): LiveReadiness {
  if (bot.mode !== 'LIVE') return 'PAPER_ONLY';
  if (gs?.emergency_stop) return 'LIVE_STOPPED';
  if (!bot.is_enabled || !bot.arm_live || !gs?.live_on) return 'LIVE_BLOCKED';
  return 'LIVE_READY';
}

function botToForm(bot: CopyBot): EditForm {
  return {
    name: bot.name, wallet_address: bot.wallet_address, mode: bot.mode,
    is_enabled: bot.is_enabled, arm_live: bot.arm_live, copy_mode: bot.copy_mode,
    sizing_value: String(bot.sizing_value), max_trade_size: String(bot.max_trade_size),
    max_open_positions: String(bot.max_open_positions),
    max_trades_per_hour: String(bot.max_trades_per_hour),
    max_slippage: String(bot.max_slippage), delay_seconds: String(bot.delay_seconds),
    opens_only: bot.opens_only ?? false, copy_closes: bot.copy_closes ?? true,
    notes: bot.notes ?? '',
  };
}

function defaultForm(): EditForm {
  return {
    name: '', wallet_address: '',
    mode: BOT_DEFAULTS.mode,
    is_enabled: BOT_DEFAULTS.is_enabled,
    arm_live: BOT_DEFAULTS.arm_live,
    copy_mode: BOT_DEFAULTS.copy_mode,
    sizing_value: String(BOT_DEFAULTS.sizing_value),
    max_trade_size: String(BOT_DEFAULTS.max_trade_size),
    max_open_positions: String(BOT_DEFAULTS.max_open_positions),
    max_trades_per_hour: String(BOT_DEFAULTS.max_trades_per_hour),
    max_slippage: String(BOT_DEFAULTS.max_slippage),
    delay_seconds: String(BOT_DEFAULTS.delay_seconds),
    opens_only: BOT_DEFAULTS.opens_only,
    copy_closes: BOT_DEFAULTS.copy_closes,
    notes: '',
  };
}

// ─── Sub-components (badges, icons, empty state) ──────────────────────────────

function ReadinessBadge({ readiness }: { readiness: LiveReadiness }) {
  const map: Record<LiveReadiness, { cls: string; dot: string; label: string; title: string }> = {
    PAPER_ONLY:   { cls: 'copy-readiness-paper',   dot: 'copy-readiness-dot-paper',   label: 'Paper Only',   title: 'Bot is in PAPER mode — no real orders.' },
    LIVE_BLOCKED: { cls: 'copy-readiness-blocked',  dot: 'copy-readiness-dot-blocked', label: 'Live Blocked', title: 'LIVE mode but one or more gates are off.' },
    LIVE_READY:   { cls: 'copy-readiness-ready',    dot: 'copy-readiness-dot-ready',   label: 'Live Ready',   title: 'All gates open — bot CAN place live orders.' },
    LIVE_STOPPED: { cls: 'copy-readiness-stopped',  dot: 'copy-readiness-dot-stopped', label: 'Live Stopped', title: 'Emergency stop is ACTIVE.' },
  };
  const { cls, dot, label, title } = map[readiness];
  return <span className={`copy-readiness ${cls}`} title={title}><span className={`copy-readiness-dot ${dot}`} />{label}</span>;
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

function IconEdit()  { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>; }
function IconTrash() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>; }
function IconBulk()  { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>; }

function EmptyBots({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="copy-empty">
      <div className="copy-empty-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/></svg></div>
      <p className="copy-empty-title">No copy bots yet</p>
      <p className="copy-empty-sub">Create a PAPER bot to test strategy before enabling live execution.</p>
      <button className="copy-btn copy-btn-primary" style={{ marginTop: '1rem' }} onClick={onAdd}>+ Create Bot</button>
    </div>
  );
}

// ─── BulkEditModal ─────────────────────────────────────────────────────────────

interface BulkEditModalProps {
  bots: CopyBot[];
  selectedIds: Set<string>;
  onClose: () => void;
  onApplied: (updatedIds: string[], fields: Record<string, unknown>) => void;
}

function BulkEditModal({ bots, selectedIds, onClose, onApplied }: BulkEditModalProps) {
  const [target, setTarget] = useState<'selected' | 'all'>(selectedIds.size > 0 ? 'selected' : 'all');
  const [apply, setApply] = useState<BulkApply>(() =>
    Object.fromEntries(BULK_FIELDS.map((f) => [f.key, false])) as BulkApply
  );
  const [form, setForm] = useState<BulkForm>(() => {
    // Start with canonical defaults; merge any operator-saved overrides
    const base = defaultForm();
    try {
      const saved = localStorage.getItem(BOT_DEFAULTS_LS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<BulkForm>;
        return { ...base, ...parsed };
      }
    } catch {}
    return base;
  });
  const [saveAsDefault, setSaveAsDefault] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const anyApplied = useMemo(() => Object.values(apply).some(Boolean), [apply]);
  const targetCount = target === 'all' ? bots.length : selectedIds.size;

  const toggleApply = (key: BulkFieldKey) =>
    setApply((prev) => ({ ...prev, [key]: !prev[key] }));

  const setField = (key: keyof BulkForm, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const selectAll = () => setApply(Object.fromEntries(BULK_FIELDS.map((f) => [f.key, true])) as BulkApply);
  const clearAll  = () => setApply(Object.fromEntries(BULK_FIELDS.map((f) => [f.key, false])) as BulkApply);

  const handleApply = async () => {
    if (!anyApplied) { setError('Select at least one field to apply'); return; }

    const fields: Record<string, unknown> = {};
    for (const f of BULK_FIELDS) {
      if (!apply[f.key]) continue;
      if (f.type === 'number') {
        const n = parseFloat(form[f.key] as string);
        fields[f.key] = Number.isFinite(n) ? Math.max(0, n) : 0;
      } else if (f.type === 'toggle') {
        fields[f.key] = form[f.key];
      } else if (f.type === 'select') {
        fields[f.key] = form[f.key];
      } else {
        fields[f.key] = (form[f.key] as string).trim() || null;
      }
    }

    const noun = target === 'all'
      ? `ALL ${bots.length} bots`
      : `${selectedIds.size} selected bot${selectedIds.size !== 1 ? 's' : ''}`;
    const fieldCount = Object.keys(fields).length;

    if (!window.confirm(
      `Apply ${fieldCount} field${fieldCount !== 1 ? 's' : ''} to ${noun}?\n\n` +
      `Fields: ${Object.keys(fields).join(', ')}`
    )) return;

    setApplying(true);
    setError(null);
    try {
      const apiTarget = target === 'all' ? 'all' : Array.from(selectedIds);
      const res = await fetch('/api/copy/bots/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: apiTarget, fields }),
        cache: 'no-store',
      });
      const payload = await res.json();
      if (!payload.ok) { setError(payload.error ?? 'Bulk apply failed'); return; }

      // Persist as future defaults if requested
      if (saveAsDefault) {
        try {
          const existing = JSON.parse(localStorage.getItem(BOT_DEFAULTS_LS_KEY) ?? '{}') as Record<string, unknown>;
          const toSave: Record<string, unknown> = {};
          for (const f of BULK_FIELDS) {
            if (apply[f.key]) toSave[f.key] = form[f.key];
          }
          localStorage.setItem(BOT_DEFAULTS_LS_KEY, JSON.stringify({ ...existing, ...toSave }));
        } catch {}
      }

      const affectedIds = target === 'all' ? bots.map((b) => b.id) : Array.from(selectedIds);
      onApplied(affectedIds, fields);
    } catch {
      setError('Network error during bulk apply');
    } finally {
      setApplying(false);
    }
  };

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="copy-modal-overlay" onClick={handleOverlayClick}>
      <div className="copy-modal copy-bulk-modal" role="dialog" aria-modal="true" aria-label="Bulk Apply Settings">
        <div className="copy-modal-header">
          <h3 className="copy-modal-title">Bulk Apply Settings</h3>
          <button className="copy-modal-close" onClick={onClose} type="button" aria-label="Close">×</button>
        </div>

        <div className="copy-modal-body">
          {/* Target selector */}
          <div className="copy-bulk-target-row">
            <span className="copy-bulk-target-label">Apply to:</span>
            <div className="copy-bulk-target-btns">
              {selectedIds.size > 0 && (
                <button
                  className={`copy-bulk-target-btn${target === 'selected' ? ' active' : ''}`}
                  onClick={() => setTarget('selected')}
                >
                  {selectedIds.size} selected bot{selectedIds.size !== 1 ? 's' : ''}
                </button>
              )}
              <button
                className={`copy-bulk-target-btn${target === 'all' ? ' active' : ''}`}
                onClick={() => setTarget('all')}
              >
                All {bots.length} bots
              </button>
            </div>
          </div>

          {/* Field select-all / clear */}
          <div className="copy-bulk-field-actions">
            <span className="copy-bulk-field-label">Fields to apply:</span>
            <button className="copy-btn copy-btn-secondary copy-btn-sm" onClick={selectAll} type="button">Select all</button>
            <button className="copy-btn copy-btn-secondary copy-btn-sm" onClick={clearAll}  type="button">Clear</button>
          </div>

          {/* Fields grid — each row: [checkbox] [label + input] [hint] */}
          <div className="copy-bulk-fields">
            {BULK_FIELDS.map((f) => {
              const isApplied = apply[f.key];
              return (
                <div
                  key={f.key}
                  className={`copy-bulk-row${isApplied ? ' copy-bulk-row-active' : ''}`}
                >
                  {/* Apply checkbox */}
                  <input
                    type="checkbox"
                    className="copy-bulk-check"
                    id={`bulk-apply-${f.key}`}
                    checked={isApplied}
                    onChange={() => toggleApply(f.key)}
                  />

                  {/* Label */}
                  <label className="copy-bulk-row-label" htmlFor={`bulk-apply-${f.key}`}>
                    {f.label}
                  </label>

                  {/* Input */}
                  <div className={`copy-bulk-row-control${!isApplied ? ' copy-bulk-row-disabled' : ''}`}>
                    {f.type === 'select' && (
                      <select
                        className="copy-form-select"
                        value={form[f.key] as string}
                        onChange={(e) => setField(f.key, e.target.value)}
                        disabled={!isApplied}
                        style={{ textTransform: 'capitalize' }}
                      >
                        {f.options.map((o) => (
                          <option key={o} value={o}>{o}</option>
                        ))}
                      </select>
                    )}
                    {f.type === 'number' && (
                      <input
                        className="copy-form-input"
                        type="number"
                        step={f.step ?? '1'}
                        min={f.min ?? '0'}
                        value={form[f.key] as string}
                        onChange={(e) => setField(f.key, e.target.value)}
                        disabled={!isApplied}
                      />
                    )}
                    {f.type === 'toggle' && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <div className="toggle-switch" style={{ width: 36, height: 20, opacity: isApplied ? 1 : 0.3 }}>
                          <input
                            type="checkbox"
                            id={`bulk-val-${f.key}`}
                            checked={form[f.key] as boolean}
                            onChange={(e) => setField(f.key, e.target.checked)}
                            disabled={!isApplied}
                          />
                          <label className="toggle-slider" htmlFor={`bulk-val-${f.key}`} />
                        </div>
                        <span style={{ fontSize: '0.75rem', color: 'rgba(248,250,252,0.5)' }}>
                          {(form[f.key] as boolean) ? 'ON' : 'OFF'}
                        </span>
                      </div>
                    )}
                    {f.type === 'text' && (
                      <input
                        className="copy-form-input"
                        type="text"
                        value={form[f.key] as string}
                        onChange={(e) => setField(f.key, e.target.value)}
                        disabled={!isApplied}
                        placeholder="Optional"
                      />
                    )}
                    {f.hint && <span className="copy-form-hint">{f.hint}</span>}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Save as future default */}
          <div className="copy-bulk-save-default-row">
            <input
              type="checkbox"
              id="bulk-save-default"
              checked={saveAsDefault}
              onChange={(e) => setSaveAsDefault(e.target.checked)}
              className="copy-bulk-check"
            />
            <label htmlFor="bulk-save-default" className="copy-bulk-save-default-label">
              Also save checked field values as defaults for new bots
            </label>
          </div>

          {error && <p className="copy-form-msg copy-form-error">{error}</p>}
        </div>

        <div className="copy-modal-footer">
          <button type="button" className="copy-btn copy-btn-secondary" onClick={onClose} disabled={applying}>
            Cancel
          </button>
          <button
            type="button"
            className="copy-btn copy-btn-primary"
            onClick={handleApply}
            disabled={applying || !anyApplied}
          >
            {applying
              ? 'Applying…'
              : `Apply to ${targetCount} bot${targetCount !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── EditModal (single bot) ────────────────────────────────────────────────────

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
  const set = (key: keyof EditForm, value: string | boolean) => setForm((p) => ({ ...p, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Bot name is required'); return; }
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/copy/bots/${bot.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(), wallet_address: form.wallet_address.trim(),
          mode: form.mode, is_enabled: form.is_enabled, arm_live: form.arm_live,
          copy_mode: form.copy_mode,
          sizing_value: parseFloat(form.sizing_value) || 1,
          max_trade_size: parseFloat(form.max_trade_size) || 0,
          max_open_positions: parseInt(form.max_open_positions, 10) || 0,
          max_trades_per_hour: parseInt(form.max_trades_per_hour, 10) || 0,
          max_slippage: parseFloat(form.max_slippage) || 0.03,
          delay_seconds: parseInt(form.delay_seconds, 10) || 0,
          opens_only: form.opens_only, copy_closes: form.copy_closes,
          notes: form.notes.trim() || null,
        }),
        cache: 'no-store',
      });
      const payload = await res.json();
      if (!payload.ok) { setError(payload.error ?? 'Save failed'); return; }
      onSaved(payload.row);
    } catch { setError('Network error'); }
    finally { setSaving(false); }
  };

  return (
    <div className="copy-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="copy-modal" role="dialog" aria-modal="true" aria-label="Edit Copy Bot">
        <div className="copy-modal-header">
          <h3 className="copy-modal-title">Edit Copy Bot</h3>
          <button className="copy-modal-close" onClick={onClose} type="button" aria-label="Close">×</button>
        </div>
        <form className="copy-modal-body" onSubmit={handleSubmit}>
          <div className="copy-form-grid">
            <div className="copy-form-field">
              <label className="copy-form-label">Bot Name <span style={{ color: '#f87171' }}>*</span></label>
              <input className="copy-form-input" value={form.name} onChange={(e) => set('name', e.target.value)} />
            </div>
            <div className="copy-form-field">
              <label className="copy-form-label">Source Wallet</label>
              {wallets.length > 0 ? (
                <select className="copy-form-select" value={form.wallet_address} onChange={(e) => set('wallet_address', e.target.value)}>
                  {wallets.map((w) => (<option key={w.wallet_address} value={w.wallet_address}>{w.display_name ? `${w.display_name} (${truncate(w.wallet_address)})` : truncate(w.wallet_address)}</option>))}
                </select>
              ) : (
                <input className="copy-form-input" value={form.wallet_address} onChange={(e) => set('wallet_address', e.target.value)} />
              )}
            </div>
            <div className="copy-form-field">
              <label className="copy-form-label">Mode</label>
              <select className="copy-form-select" value={form.mode} onChange={(e) => set('mode', e.target.value as 'PAPER' | 'LIVE')}>
                <option value="PAPER">PAPER — simulated (safe default)</option>
                <option value="LIVE">LIVE — real orders (use with care)</option>
              </select>
            </div>
            <div className="copy-form-field">
              <label className="copy-form-label">Copy Mode</label>
              <select className="copy-form-select" value={form.copy_mode} onChange={(e) => set('copy_mode', e.target.value)}>
                <option value="scaled">Scaled — multiplier of source size</option>
                <option value="exact">Exact — fixed USD per trade</option>
                <option value="percent">Percent — % of bankroll</option>
              </select>
            </div>
            <div className="copy-form-field">
              <label className="copy-form-label">Sizing Value</label>
              <input className="copy-form-input" type="number" step="0.01" value={form.sizing_value} onChange={(e) => set('sizing_value', e.target.value)} />
            </div>
            <div className="copy-form-field">
              <label className="copy-form-label">Max Trade Size ($)</label>
              <input className="copy-form-input" type="number" step="1" min="0" value={form.max_trade_size} onChange={(e) => set('max_trade_size', e.target.value)} />
            </div>
            <div className="copy-form-field">
              <label className="copy-form-label">Max Open Positions</label>
              <input className="copy-form-input" type="number" step="1" min="0" value={form.max_open_positions} onChange={(e) => set('max_open_positions', e.target.value)} />
              <span className="copy-form-hint">0 = unlimited</span>
            </div>
            <div className="copy-form-field">
              <label className="copy-form-label">Max Trades / Hour</label>
              <input className="copy-form-input" type="number" step="1" min="0" value={form.max_trades_per_hour} onChange={(e) => set('max_trades_per_hour', e.target.value)} />
              <span className="copy-form-hint">0 = unlimited</span>
            </div>
            <div className="copy-form-field">
              <label className="copy-form-label">Max Slippage</label>
              <input className="copy-form-input" type="number" step="0.001" min="0" max="1" value={form.max_slippage} onChange={(e) => set('max_slippage', e.target.value)} />
              <span className="copy-form-hint">e.g. 0.03 = 3%</span>
            </div>
            <div className="copy-form-field">
              <label className="copy-form-label">Delay Seconds</label>
              <input className="copy-form-input" type="number" step="1" min="0" value={form.delay_seconds} onChange={(e) => set('delay_seconds', e.target.value)} />
            </div>
            <div className="copy-form-field copy-form-toggle-row">
              <label className="copy-form-label">Enabled</label>
              <div className="toggle-switch" style={{ width: 36, height: 20 }}><input type="checkbox" id="edit-is-enabled" checked={form.is_enabled} onChange={(e) => set('is_enabled', e.target.checked)} /><label className="toggle-slider" htmlFor="edit-is-enabled" /></div>
            </div>
            <div className="copy-form-field copy-form-toggle-row">
              <label className="copy-form-label">ARM LIVE</label>
              <div className="toggle-switch" style={{ width: 36, height: 20 }}><input type="checkbox" id="edit-arm-live" checked={form.arm_live} onChange={(e) => set('arm_live', e.target.checked)} /><label className="toggle-slider" htmlFor="edit-arm-live" /></div>
              <span className="copy-form-hint" style={{ marginLeft: 0 }}>Secondary gate for live orders</span>
            </div>
            <div className="copy-form-field copy-form-toggle-row">
              <label className="copy-form-label">Opens Only</label>
              <div className="toggle-switch" style={{ width: 36, height: 20 }}><input type="checkbox" id="edit-opens-only" checked={form.opens_only} onChange={(e) => set('opens_only', e.target.checked)} /><label className="toggle-slider" htmlFor="edit-opens-only" /></div>
            </div>
            <div className="copy-form-field copy-form-toggle-row">
              <label className="copy-form-label">Copy Closes</label>
              <div className="toggle-switch" style={{ width: 36, height: 20 }}><input type="checkbox" id="edit-copy-closes" checked={form.copy_closes} onChange={(e) => set('copy_closes', e.target.checked)} /><label className="toggle-slider" htmlFor="edit-copy-closes" /></div>
            </div>
            <div className="copy-form-field copy-form-grid-wide">
              <label className="copy-form-label">Notes</label>
              <input className="copy-form-input" value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Optional operator notes" />
            </div>
          </div>
          {error && <p className="copy-form-msg copy-form-error" style={{ marginTop: '0.5rem' }}>{error}</p>}
          <div className="copy-modal-footer">
            <button type="button" className="copy-btn copy-btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="copy-btn copy-btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
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

  // Single-bot edit
  const [editingBot, setEditingBot] = useState<CopyBot | null>(null);

  // Delete
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<{ id: string; msg: string; isFk: boolean } | null>(null);

  // Backfill
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<{ created: number; scanned: number; existing: number } | null>(null);

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ updated: number } | null>(null);

  // Persist selected IDs to localStorage so MasterStrategySection can read them
  // for "Apply to Selected Bots" even when the operator switches tabs.
  useEffect(() => {
    try {
      localStorage.setItem(SELECTED_BOTS_LS_KEY, JSON.stringify(Array.from(selectedIds)));
    } catch {}
  }, [selectedIds]);

  // Create-bot form — load operator-saved defaults from localStorage
  const [fName, setFName] = useState('');
  const [fWallet, setFWallet] = useState('');
  const [fMode, setFMode] = useState<'PAPER' | 'LIVE'>(BOT_DEFAULTS.mode);
  const [fCopyMode, setFCopyMode] = useState<string>(BOT_DEFAULTS.copy_mode);
  const [fSizingValue, setFSizingValue] = useState(String(BOT_DEFAULTS.sizing_value));
  const [fMaxTrade, setFMaxTrade] = useState(String(BOT_DEFAULTS.max_trade_size));
  const [fMaxPos, setFMaxPos] = useState(String(BOT_DEFAULTS.max_open_positions));
  const [fMaxPerHr, setFMaxPerHr] = useState(String(BOT_DEFAULTS.max_trades_per_hour));
  const [fMaxSlippage, setFMaxSlippage] = useState(String(BOT_DEFAULTS.max_slippage));
  const [fDelay, setFDelay] = useState(String(BOT_DEFAULTS.delay_seconds));
  const [fOpensOnly, setFOpensOnly] = useState<boolean>(BOT_DEFAULTS.opens_only);
  const [fCopyCloses, setFCopyCloses] = useState<boolean>(BOT_DEFAULTS.copy_closes);
  const [fSaving, setFSaving] = useState(false);
  const [fError, setFError] = useState<string | null>(null);
  const [fSuccess, setFSuccess] = useState(false);

  // Apply operator-saved defaults on mount (client-only)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(BOT_DEFAULTS_LS_KEY);
      if (!saved) return;
      const d = JSON.parse(saved) as Partial<BulkForm>;
      if (d.mode && (d.mode === 'PAPER' || d.mode === 'LIVE')) setFMode(d.mode);
      if (d.copy_mode) setFCopyMode(d.copy_mode as string);
      if (d.sizing_value != null)       setFSizingValue(String(d.sizing_value));
      if (d.max_trade_size != null)     setFMaxTrade(String(d.max_trade_size));
      if (d.max_open_positions != null) setFMaxPos(String(d.max_open_positions));
      if (d.max_trades_per_hour != null)setFMaxPerHr(String(d.max_trades_per_hour));
      if (d.max_slippage != null)       setFMaxSlippage(String(d.max_slippage));
      if (d.delay_seconds != null)      setFDelay(String(d.delay_seconds));
      if (typeof d.opens_only === 'boolean') setFOpensOnly(d.opens_only);
      if (typeof d.copy_closes === 'boolean') setFCopyCloses(d.copy_closes);
    } catch {}
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [botsRes, settingsRes] = await Promise.all([
        fetch('/api/copy/bots', { cache: 'no-store' }),
        fetch('/api/copy/settings', { cache: 'no-store' }),
      ]);
      const botsPayload     = await botsRes.json();
      const settingsPayload = await settingsRes.json();
      if (botsPayload.ok)      setBots(botsPayload.rows ?? []);
      else                     setError(botsPayload.error ?? 'Failed to load bots');
      if (settingsPayload.ok && settingsPayload.settings) {
        setGlobalSettings({ live_on: settingsPayload.settings.live_on, emergency_stop: settingsPayload.settings.emergency_stop });
      }
    } catch { setError('Network error loading bots'); }
    finally  { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadWallets = useCallback(async () => {
    try {
      const res = await fetch('/api/copy/wallets', { cache: 'no-store' });
      const payload = await res.json();
      if (payload.ok) setWallets(payload.rows ?? []);
    } catch {}
  }, []);

  useEffect(() => { if (showForm || editingBot) loadWallets(); }, [showForm, editingBot, loadWallets]);

  const patchBot = useCallback(async (id: string, updates: Record<string, unknown>) => {
    setTogglingId(id);
    try {
      const res = await fetch(`/api/copy/bots/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates), cache: 'no-store',
      });
      const payload = await res.json();
      if (payload.ok && payload.row) {
        setBots((prev) => prev.map((b) => (b.id === id ? { ...b, ...payload.row } : b)));
      }
    } finally { setTogglingId(null); }
  }, []);

  const handleDelete = async (bot: CopyBot) => {
    if (deletingId === bot.id) return;
    if (!window.confirm(
      `Delete "${bot.name}"?\n\nThe bot config will be removed.\nHistory (attempts, positions) and the tracked wallet are preserved.\n\nThis cannot be undone.`
    )) return;

    setDeletingId(bot.id); setDeleteError(null);
    try {
      const res = await fetch(`/api/copy/bots/${bot.id}`, { method: 'DELETE', cache: 'no-store' });
      const payload = await res.json();
      if (payload.ok) {
        setBots((prev) => prev.filter((b) => b.id !== bot.id));
        setSelectedIds((prev) => { const s = new Set(prev); s.delete(bot.id); return s; });
      } else {
        setDeleteError({ id: bot.id, msg: payload.error ?? 'Delete failed', isFk: payload.fk_violation === true });
      }
    } catch {
      setDeleteError({ id: bot.id, msg: 'Network error during delete', isFk: false });
    } finally { setDeletingId(null); }
  };

  const handleBackfill = async () => {
    setBackfilling(true); setBackfillResult(null);
    try {
      const res = await fetch('/api/copy/bots/backfill', { method: 'POST', cache: 'no-store' });
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
    e.preventDefault(); setFError(null); setFSuccess(false);
    if (!fName.trim()) { setFError('Bot name is required'); return; }
    if (!fWallet.trim()) { setFError('Source wallet is required'); return; }
    setFSaving(true);
    try {
      const res = await fetch('/api/copy/bots', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: fName.trim(), wallet_address: fWallet.trim(), mode: fMode,
          copy_mode: fCopyMode, sizing_value: parseFloat(fSizingValue) || 1,
          max_trade_size: parseFloat(fMaxTrade) || 0,
          max_open_positions: parseInt(fMaxPos, 10) || 0,
          max_trades_per_hour: parseInt(fMaxPerHr, 10) || 0,
          max_slippage: parseFloat(fMaxSlippage) || 0.03,
          delay_seconds: parseInt(fDelay, 10) || 0,
          opens_only: fOpensOnly, copy_closes: fCopyCloses,
        }),
        cache: 'no-store',
      });
      const payload = await res.json();
      if (!payload.ok) { setFError(payload.error ?? 'Failed to create bot'); return; }
      setFName(''); setFWallet('');
      setFSuccess(true); await load();
      setTimeout(() => setFSuccess(false), 2500);
    } finally { setFSaving(false); }
  };

  // ── Selection helpers ──────────────────────────────────────────────────────
  const allSelected = bots.length > 0 && selectedIds.size === bots.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const toggleSelectAll = () =>
    setSelectedIds(allSelected ? new Set() : new Set(bots.map((b) => b.id)));

  const clearSelection = () => setSelectedIds(new Set());

  // ── Live summary counts ────────────────────────────────────────────────────
  const liveReady   = bots.filter((b) => getLiveReadiness(b, globalSettings) === 'LIVE_READY').length;
  const liveBlocked = bots.filter((b) => getLiveReadiness(b, globalSettings) === 'LIVE_BLOCKED').length;
  const liveStopped = bots.filter((b) => getLiveReadiness(b, globalSettings) === 'LIVE_STOPPED').length;
  const paperOnly   = bots.filter((b) => getLiveReadiness(b, globalSettings) === 'PAPER_ONLY').length;

  // Enabled bots always float above disabled ones; within each tier preserve API order
  const sortedBots = useMemo(
    () => [...bots].sort((a, b) => (b.is_enabled ? 1 : 0) - (a.is_enabled ? 1 : 0)),
    [bots]
  );

  return (
    <>
      {/* Edit modal (single bot) */}
      {editingBot && (
        <EditModal
          bot={editingBot} wallets={wallets}
          onClose={() => setEditingBot(null)}
          onSaved={(updated) => { setBots((prev) => prev.map((b) => (b.id === updated.id ? updated : b))); setEditingBot(null); }}
        />
      )}

      {/* Bulk apply modal */}
      {showBulkModal && (
        <BulkEditModal
          bots={bots}
          selectedIds={selectedIds}
          onClose={() => setShowBulkModal(false)}
          onApplied={(affectedIds, fields) => {
            setBots((prev) =>
              prev.map((b) =>
                affectedIds.includes(b.id)
                  ? { ...b, ...(fields as Partial<CopyBot>), updated_at: new Date().toISOString() }
                  : b
              )
            );
            setBulkResult({ updated: affectedIds.length });
            setShowBulkModal(false);
            clearSelection();
            setTimeout(() => setBulkResult(null), 5000);
          }}
        />
      )}

      <div className="copy-section">
        {/* ── Section header ── */}
        <div className="copy-section-head">
          <div className="copy-section-title-row">
            <h2 className="copy-section-title">Copy Bots</h2>
            {!loading && bots.length > 0 && <span className="copy-section-count">{bots.length}</span>}
          </div>
          <div className="copy-section-actions">
            <button className="copy-btn copy-btn-secondary copy-btn-sm" onClick={handleBackfill} disabled={backfilling} title="Create default bots for wallets missing one">
              {backfilling ? 'Backfilling…' : '⊕ Backfill'}
            </button>
            <button className="copy-btn copy-btn-secondary copy-btn-sm" onClick={load} disabled={loading} title="Refresh">↻</button>
            <button className={`copy-btn copy-btn-sm ${showForm ? 'copy-btn-secondary' : 'copy-btn-primary'}`} onClick={() => setShowForm((v) => !v)}>
              {showForm ? 'Cancel' : '+ Add Bot'}
            </button>
          </div>
        </div>

        {/* Backfill result */}
        {backfillResult && (
          <div className="copy-backfill-result">
            {backfillResult.created > 0
              ? `✓ Created ${backfillResult.created} bot${backfillResult.created !== 1 ? 's' : ''} (${backfillResult.existing} already existed, ${backfillResult.scanned} wallets scanned).`
              : `All ${backfillResult.scanned} tracked wallets already have a bot.`}
          </div>
        )}

        {/* Bulk apply result */}
        {bulkResult && (
          <div className="copy-backfill-result">
            ✓ Settings applied to {bulkResult.updated} bot{bulkResult.updated !== 1 ? 's' : ''}.
          </div>
        )}

        {/* ── Bulk selection action bar ── */}
        {!loading && bots.length > 0 && (
          <div className="copy-bulk-bar">
            {/* Select all checkbox */}
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
              </>
            )}

            <button
              className="copy-btn copy-btn-primary copy-btn-sm"
              onClick={() => setShowBulkModal(true)}
              style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginLeft: 'auto' }}
            >
              <IconBulk />
              {selectedIds.size > 0 ? `Bulk Apply (${selectedIds.size})` : 'Bulk Apply All'}
            </button>
          </div>
        )}

        {/* Live summary bar */}
        {!loading && bots.length > 0 && (
          <div className="copy-live-summary">
            <div className="copy-live-summary-item"><span className="copy-live-summary-value copy-live-summary-value-green">{liveReady}</span><span>Live Ready</span></div>
            <div className="copy-live-summary-sep" />
            <div className="copy-live-summary-item"><span className="copy-live-summary-value copy-live-summary-value-yellow">{liveBlocked}</span><span>Live Blocked</span></div>
            {liveStopped > 0 && (<><div className="copy-live-summary-sep" /><div className="copy-live-summary-item"><span className="copy-live-summary-value copy-live-summary-value-red">{liveStopped}</span><span>Stopped</span></div></>)}
            <div className="copy-live-summary-sep" />
            <div className="copy-live-summary-item"><span className="copy-live-summary-value copy-live-summary-value-gray">{paperOnly}</span><span>Paper Only</span></div>
            {globalSettings && (<><div className="copy-live-summary-sep" />
              <div className="copy-live-summary-item">
                {globalSettings.emergency_stop
                  ? <span style={{ color: '#f87171', fontWeight: 700, fontSize: '0.72rem' }}>⛔ Emergency Stop Active</span>
                  : globalSettings.live_on
                    ? <span style={{ color: '#34d399', fontWeight: 700, fontSize: '0.72rem' }}>● Gate Open</span>
                    : <span style={{ color: 'rgba(248,250,252,0.35)', fontSize: '0.72rem' }}>Gate Closed</span>}
              </div>
            </>)}
          </div>
        )}

        {/* Add bot form */}
        {showForm && (
          <form className="copy-add-form" onSubmit={handleAddBot}>
            <div className="copy-form-title">Create Copy Bot</div>
            <div className="copy-form-grid">
              <div className="copy-form-field"><label className="copy-form-label">Bot Name <span style={{ color: '#f87171' }}>*</span></label><input className="copy-form-input" value={fName} onChange={(e) => setFName(e.target.value)} placeholder="e.g. Copy — Whale A" /></div>
              <div className="copy-form-field"><label className="copy-form-label">Source Wallet <span style={{ color: '#f87171' }}>*</span></label>
                {wallets.length > 0 ? (
                  <select className="copy-form-select" value={fWallet} onChange={(e) => setFWallet(e.target.value)}><option value="">— Select wallet —</option>{wallets.map((w) => (<option key={w.wallet_address} value={w.wallet_address}>{w.display_name ? `${w.display_name} (${truncate(w.wallet_address)})` : truncate(w.wallet_address)}</option>))}</select>
                ) : (<input className="copy-form-input" value={fWallet} onChange={(e) => setFWallet(e.target.value)} placeholder="0x… (add wallets first)" />)}
              </div>
              <div className="copy-form-field"><label className="copy-form-label">Mode</label><select className="copy-form-select" value={fMode} onChange={(e) => setFMode(e.target.value as 'PAPER' | 'LIVE')}><option value="PAPER">PAPER — simulated (safe default)</option><option value="LIVE">LIVE — real orders (use with care)</option></select></div>
              <div className="copy-form-field"><label className="copy-form-label">Copy Mode</label><select className="copy-form-select" value={fCopyMode} onChange={(e) => setFCopyMode(e.target.value)}><option value="scaled">Scaled</option><option value="exact">Exact</option><option value="percent">Percent</option></select></div>
              <div className="copy-form-field"><label className="copy-form-label">Sizing Value</label><input className="copy-form-input" type="number" step="0.01" value={fSizingValue} onChange={(e) => setFSizingValue(e.target.value)} /></div>
              <div className="copy-form-field"><label className="copy-form-label">Max Trade Size ($)</label><input className="copy-form-input" type="number" step="1" min="0" value={fMaxTrade} onChange={(e) => setFMaxTrade(e.target.value)} /></div>
              <div className="copy-form-field"><label className="copy-form-label">Max Open Positions</label><input className="copy-form-input" type="number" step="1" min="0" value={fMaxPos} onChange={(e) => setFMaxPos(e.target.value)} /><span className="copy-form-hint">0 = unlimited</span></div>
              <div className="copy-form-field"><label className="copy-form-label">Max Trades / Hour</label><input className="copy-form-input" type="number" step="1" min="0" value={fMaxPerHr} onChange={(e) => setFMaxPerHr(e.target.value)} /><span className="copy-form-hint">0 = unlimited</span></div>
              <div className="copy-form-field"><label className="copy-form-label">Max Slippage</label><input className="copy-form-input" type="number" step="0.001" min="0" max="1" value={fMaxSlippage} onChange={(e) => setFMaxSlippage(e.target.value)} /><span className="copy-form-hint">e.g. 0.03 = 3%</span></div>
              <div className="copy-form-field"><label className="copy-form-label">Delay Seconds</label><input className="copy-form-input" type="number" step="1" min="0" value={fDelay} onChange={(e) => setFDelay(e.target.value)} /></div>
              <div className="copy-form-field copy-form-toggle-row"><label className="copy-form-label">Opens Only</label><div className="toggle-switch" style={{ width: 36, height: 20 }}><input type="checkbox" id="f-opens-only" checked={fOpensOnly} onChange={(e) => setFOpensOnly(e.target.checked)} /><label className="toggle-slider" htmlFor="f-opens-only" /></div><span className="copy-form-hint" style={{ marginLeft: 0 }}>Copy opening trades only</span></div>
              <div className="copy-form-field copy-form-toggle-row"><label className="copy-form-label">Copy Closes</label><div className="toggle-switch" style={{ width: 36, height: 20 }}><input type="checkbox" id="f-copy-closes" checked={fCopyCloses} onChange={(e) => setFCopyCloses(e.target.checked)} /><label className="toggle-slider" htmlFor="f-copy-closes" /></div><span className="copy-form-hint" style={{ marginLeft: 0 }}>Mirror source exits</span></div>
            </div>
            <div className="copy-form-actions">
              <button className="copy-btn copy-btn-primary" type="submit" disabled={fSaving}>{fSaving ? 'Creating…' : 'Create Bot'}</button>
              {fError && <span className="copy-form-msg copy-form-error">{fError}</span>}
              {fSuccess && <span className="copy-form-msg copy-form-success">Bot created.</span>}
            </div>
          </form>
        )}

        {/* ── Table / states ── */}
        {loading ? (
          <div className="copy-loading">Loading bots…</div>
        ) : error ? (
          <div className="copy-empty"><p className="copy-empty-title" style={{ color: '#f87171' }}>{error}</p></div>
        ) : bots.length === 0 ? (
          <EmptyBots onAdd={() => setShowForm(true)} />
        ) : (
          <div className="copy-table-wrap">
            <table className="copy-table" style={{ minWidth: '1150px' }}>
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input type="checkbox" className="copy-bulk-check" checked={allSelected} onChange={toggleSelectAll}
                      ref={(el) => { if (el) el.indeterminate = someSelected; }} title={allSelected ? 'Deselect all' : 'Select all'} />
                  </th>
                  <th>Bot</th>
                  <th>Wallet</th>
                  <th>Mode</th>
                  <th>Enabled</th>
                  <th title="ARM LIVE: secondary safety gate">Arm Live</th>
                  <th title="Derived readiness status">Live Status</th>
                  <th>Copy Mode</th>
                  <th>Sizing</th>
                  <th>Max $</th>
                  <th title="0 = unlimited">Max Pos</th>
                  <th title="0 = unlimited">/Hr</th>
                  <th>Slip.</th>
                  <th>Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedBots.map((bot) => {
                  const readiness    = getLiveReadiness(bot, globalSettings);
                  const isDeleting   = deletingId === bot.id;
                  const isSelected   = selectedIds.has(bot.id);
                  const rowDeleteErr = deleteError?.id === bot.id ? deleteError : null;

                  return (
                    <>
                      <tr
                        key={bot.id}
                        className={isSelected ? 'copy-row-selected' : ''}
                        style={isDeleting ? { opacity: 0.4 } : undefined}
                      >
                        {/* Row checkbox */}
                        <td>
                          <input type="checkbox" className="copy-bulk-check" checked={isSelected} onChange={() => toggleSelect(bot.id)} />
                        </td>
                        <td><span className="copy-td-name">{bot.name}</span></td>
                        <td><span className="copy-mono" title={bot.wallet_address}>{truncate(bot.wallet_address)}</span></td>
                        <td><ModeBadge mode={bot.mode} /></td>
                        <td>
                          <div className="toggle-switch" style={{ width: 36, height: 20 }}>
                            <input type="checkbox" checked={bot.is_enabled} onChange={() => patchBot(bot.id, { is_enabled: !bot.is_enabled })} disabled={togglingId === bot.id} id={`bot-en-${bot.id}`} />
                            <label className="toggle-slider" htmlFor={`bot-en-${bot.id}`} />
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <div className="toggle-switch" style={{ width: 36, height: 20 }}>
                              <input type="checkbox" checked={bot.arm_live} onChange={() => patchBot(bot.id, { arm_live: !bot.arm_live })} disabled={togglingId === bot.id} id={`bot-arm-${bot.id}`} />
                              <label className="toggle-slider" htmlFor={`bot-arm-${bot.id}`} />
                            </div>
                            <ArmLiveBadge armed={bot.arm_live} mode={bot.mode} />
                          </div>
                        </td>
                        <td><ReadinessBadge readiness={readiness} /></td>
                        <td><span className="copy-badge copy-badge-blue" style={{ textTransform: 'capitalize' }}>{bot.copy_mode}</span></td>
                        <td className="copy-td-num">{bot.sizing_value}</td>
                        <td className="copy-td-num">${bot.max_trade_size}</td>
                        <td className="copy-td-num">{fmtLimit(bot.max_open_positions)}</td>
                        <td className="copy-td-num">{fmtLimit(bot.max_trades_per_hour)}</td>
                        <td className="copy-td-num">{(bot.max_slippage * 100).toFixed(1)}%</td>
                        <td className="copy-td-muted" style={{ fontSize: '0.72rem' }}>{fmtDate(bot.updated_at)}</td>
                        <td>
                          <div className="copy-bot-actions">
                            <button className="copy-bot-action-btn copy-bot-action-edit" onClick={() => setEditingBot(bot)} title="Edit" disabled={isDeleting}><IconEdit /></button>
                            <button className="copy-bot-action-btn copy-bot-action-delete" onClick={() => handleDelete(bot)} title="Delete" disabled={isDeleting || togglingId === bot.id}><IconTrash /></button>
                          </div>
                        </td>
                      </tr>
                      {rowDeleteErr && (
                        <tr key={`${bot.id}-err`}>
                          <td colSpan={15} style={{ padding: '0 1.5rem 0.6rem' }}>
                            <div className="copy-bot-delete-error">
                              <span>{rowDeleteErr.msg}</span>
                              {rowDeleteErr.isFk && (
                                <button className="copy-btn copy-btn-secondary copy-btn-sm" style={{ marginLeft: '0.75rem' }}
                                  onClick={() => { setDeleteError(null); patchBot(bot.id, { is_enabled: false }); }}>
                                  Disable instead
                                </button>
                              )}
                              <button className="copy-bot-delete-error-dismiss" onClick={() => setDeleteError(null)} title="Dismiss">×</button>
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
