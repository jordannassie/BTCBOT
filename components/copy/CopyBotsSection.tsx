'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getPolymarketProfileUrl } from '@/lib/polymarketProfile';
import { shortenWallet } from '@/lib/copy/traderIdentity';
import SourceAvatar from '@/components/copy/SourceAvatar';
import { BOT_DEFAULTS, BOT_DEFAULTS_LS_KEY } from '@/lib/copy/botDefaults';
import { SELECTED_BOTS_LS_KEY } from '@/lib/copy/masterStrategy';

// ─── Types ────────────────────────────────────────────────────────────────────

type ExitMode = 'mirror_only' | 'auto_profit' | 'auto_profit_max_hold';

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
  // Exit settings (migration 0008)
  exit_mode: ExitMode;
  take_profit_pct: number;
  max_hold_minutes: number;
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
  // Exit settings
  exit_mode: ExitMode;
  take_profit_pct: string;
  max_hold_minutes: string;
};

// Bulk apply — each field has an "apply?" checkbox
// Note: 'mode' (PAPER/LIVE) is intentionally excluded — set per-bot via Edit.
type BulkFieldKey =
  | 'copy_mode' | 'sizing_value' | 'max_trade_size'
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
// fmtDate / fmtLimit retained in edit modal — removed from compact table

// Deterministic random name — same algorithm as TrackedWalletsSection so
// the same address always produces the same name across both pages.
const NAME_ADJ  = ['Shadow','Neon','Ghost','Iron','Silver','Dark','Swift','Bold','Quiet','Frost','Slick','Deep','Sharp','Wild','Jade','Steel','Copper','Golden','Crimson','Azure','Onyx','Ivory','Ember','Blind'];
const NAME_NOUN = ['Whale','Wolf','Eagle','Hawk','Shark','Bull','Bear','Fox','Lynx','Raven','Falcon','Viper','Orca','Jaguar','Titan','Phantom','Cipher','Scout','Drifter','Nomad','Ranger','Stalker','Pilgrim','Alpha'];

function generateWalletName(address: string): string {
  let h = 0;
  for (let i = 0; i < address.length; i++) h = Math.imul(h * 31 + address.charCodeAt(i), 1) >>> 0;
  return `${NAME_ADJ[h % NAME_ADJ.length]} ${NAME_NOUN[(h >>> 4) % NAME_NOUN.length]}`;
}

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
    exit_mode: bot.exit_mode ?? 'mirror_only',
    take_profit_pct: String(bot.take_profit_pct ?? 8),
    max_hold_minutes: String(bot.max_hold_minutes ?? 10),
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
    exit_mode: 'mirror_only',
    take_profit_pct: '8',
    max_hold_minutes: '10',
  };
}

// ─── Sub-components (badges, icons, empty state) ──────────────────────────────

// ReadinessBadge removed from compact table — still computed for summary stats above table

function ModeBadge({ mode }: { mode: 'PAPER' | 'LIVE' }) {
  return mode === 'LIVE'
    ? <span className="copy-badge copy-badge-live">LIVE</span>
    : <span className="copy-badge copy-badge-paper">PAPER</span>;
}

// ArmLiveBadge removed from compact table — ARM LIVE shown as toggle-only

// ── Exit-mode helpers ─────────────────────────────────────────────────────────

const EXIT_MODE_OPTIONS: { value: ExitMode; label: string; hint: string }[] = [
  { value: 'mirror_only',          label: 'Mirror Only',            hint: 'Close only when the source wallet closes' },
  { value: 'auto_profit',          label: 'Auto Profit',            hint: 'Close when profit ≥ take-profit %' },
  { value: 'auto_profit_max_hold', label: 'Auto Profit + Max Hold', hint: 'Auto-profit close OR time-based close' },
];

function ExitModeBadge({ mode }: { mode: ExitMode | undefined }) {
  const m = mode ?? 'mirror_only';
  if (m === 'auto_profit')          return <span className="copy-exit-badge copy-exit-badge-profit">AUTO PROFIT</span>;
  if (m === 'auto_profit_max_hold') return <span className="copy-exit-badge copy-exit-badge-maxhold">AUTO PROFIT + MAX HOLD</span>;
  return <span className="copy-exit-badge copy-exit-badge-mirror">MIRROR ONLY</span>;
}

function IconEdit()  { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>; }
function IconTrash() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>; }
function IconBulk()  { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>; }

// ─── Bot status (simplified) ──────────────────────────────────────────────────
// A bot is ACTIVE when is_enabled=true, INACTIVE when is_enabled=false.
// opens_only and copy_closes are written atomically by handleBotStatusToggle
// but are not shown as separate controls in the UI.

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
  // Exit-mode section is toggled as a single unit (mode + TP% + max hold)
  const [applyExitMode, setApplyExitMode] = useState(false);

  const [saveAsDefault, setSaveAsDefault] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const anyApplied = useMemo(
    () => Object.values(apply).some(Boolean) || applyExitMode,
    [apply, applyExitMode]
  );
  const targetCount = target === 'all' ? bots.length : selectedIds.size;

  const toggleApply = (key: BulkFieldKey) =>
    setApply((prev) => ({ ...prev, [key]: !prev[key] }));

  const setField = (key: keyof BulkForm, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const selectAll = () => {
    setApply(Object.fromEntries(BULK_FIELDS.map((f) => [f.key, true])) as BulkApply);
    setApplyExitMode(true);
  };
  const clearAll = () => {
    setApply(Object.fromEntries(BULK_FIELDS.map((f) => [f.key, false])) as BulkApply);
    setApplyExitMode(false);
  };

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

    // Exit settings applied as an atomic group
    if (applyExitMode) {
      fields.exit_mode = form.exit_mode;
      if (form.exit_mode !== 'mirror_only') {
        fields.take_profit_pct = parseFloat(form.take_profit_pct) || 8;
      }
      if (form.exit_mode === 'auto_profit_max_hold') {
        fields.max_hold_minutes = parseInt(form.max_hold_minutes, 10) || 10;
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
          if (applyExitMode) {
            toSave.exit_mode = form.exit_mode;
            toSave.take_profit_pct = form.take_profit_pct;
            toSave.max_hold_minutes = form.max_hold_minutes;
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

          {/* ── Exit Settings section ── */}
          <div className="copy-form-section-head" style={{ marginTop: '0.75rem' }}>Exit Settings</div>
          <div className={`copy-bulk-row${applyExitMode ? ' copy-bulk-row-active' : ''}`} style={{ alignItems: 'flex-start' }}>
            <input
              type="checkbox"
              className="copy-bulk-check"
              id="bulk-apply-exit"
              checked={applyExitMode}
              onChange={() => setApplyExitMode((v) => !v)}
              style={{ marginTop: '0.15rem' }}
            />
            <label className="copy-bulk-row-label" htmlFor="bulk-apply-exit" style={{ paddingTop: '0.05rem' }}>
              Exit Mode
            </label>
            <div className={`copy-bulk-row-control${!applyExitMode ? ' copy-bulk-row-disabled' : ''}`}>
              <select
                className="copy-form-select"
                value={form.exit_mode}
                onChange={(e) => setField('exit_mode', e.target.value as ExitMode)}
                disabled={!applyExitMode}
              >
                {EXIT_MODE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <span className="copy-form-hint">
                {EXIT_MODE_OPTIONS.find((o) => o.value === form.exit_mode)?.hint}
              </span>

              {/* Take Profit % — shown when auto_profit or auto_profit_max_hold */}
              {applyExitMode && (form.exit_mode === 'auto_profit' || form.exit_mode === 'auto_profit_max_hold') && (
                <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <label style={{ fontSize: '0.75rem', color: 'rgba(248,250,252,0.55)', flexShrink: 0 }}>
                    Take Profit %
                  </label>
                  <input
                    className="copy-form-input"
                    type="number"
                    step="0.5"
                    min="0.5"
                    max="100"
                    value={form.take_profit_pct}
                    onChange={(e) => setField('take_profit_pct', e.target.value)}
                    style={{ width: '5rem' }}
                  />
                  <span className="copy-form-hint">e.g. 8 = close at +8%</span>
                </div>
              )}

              {/* Max Hold Minutes — shown only for auto_profit_max_hold */}
              {applyExitMode && form.exit_mode === 'auto_profit_max_hold' && (
                <div style={{ marginTop: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <label style={{ fontSize: '0.75rem', color: 'rgba(248,250,252,0.55)', flexShrink: 0 }}>
                    Max Hold (min)
                  </label>
                  <input
                    className="copy-form-input"
                    type="number"
                    step="1"
                    min="1"
                    value={form.max_hold_minutes}
                    onChange={(e) => setField('max_hold_minutes', e.target.value)}
                    style={{ width: '5rem' }}
                  />
                  <span className="copy-form-hint">Time-based close regardless of P/L</span>
                </div>
              )}
            </div>
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
          // Exit settings
          exit_mode: form.exit_mode,
          take_profit_pct: parseFloat(form.take_profit_pct) || 8,
          max_hold_minutes: parseInt(form.max_hold_minutes, 10) || 10,
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

          {/* ── Basic Settings ────────────────────────────────────────────── */}
          <div className="copy-form-section-head">Basic Settings</div>
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
              <label className="copy-form-label">Copy Closes</label>
              <div className="toggle-switch" style={{ width: 36, height: 20 }}><input type="checkbox" id="edit-copy-closes" checked={form.copy_closes} onChange={(e) => set('copy_closes', e.target.checked)} /><label className="toggle-slider" htmlFor="edit-copy-closes" /></div>
              <span className="copy-form-hint" style={{ marginLeft: 0 }}>Mirror source wallet exits</span>
            </div>
          </div>

          {/* ── Risk / Limits ─────────────────────────────────────────────── */}
          <div className="copy-form-section-head">Risk / Limits</div>
          <div className="copy-form-grid">
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
          </div>

          {/* ── Exit Settings ─────────────────────────────────────────────── */}
          <div className="copy-form-section-head">Exit Settings</div>
          <div className="copy-form-grid">
            <div className="copy-form-field copy-form-grid-wide">
              <label className="copy-form-label">Exit Mode</label>
              <select
                className="copy-form-select"
                value={form.exit_mode}
                onChange={(e) => set('exit_mode', e.target.value as ExitMode)}
              >
                {EXIT_MODE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <span className="copy-form-hint">
                {EXIT_MODE_OPTIONS.find((o) => o.value === form.exit_mode)?.hint}
              </span>
            </div>
            {(form.exit_mode === 'auto_profit' || form.exit_mode === 'auto_profit_max_hold') && (
              <div className="copy-form-field">
                <label className="copy-form-label">Take Profit %</label>
                <input
                  className="copy-form-input"
                  type="number"
                  step="0.5"
                  min="0.5"
                  max="100"
                  value={form.take_profit_pct}
                  onChange={(e) => set('take_profit_pct', e.target.value)}
                />
                <span className="copy-form-hint">e.g. 8 = close at +8% P/L</span>
              </div>
            )}
            {form.exit_mode === 'auto_profit_max_hold' && (
              <div className="copy-form-field">
                <label className="copy-form-label">Max Hold (minutes)</label>
                <input
                  className="copy-form-input"
                  type="number"
                  step="1"
                  min="1"
                  value={form.max_hold_minutes}
                  onChange={(e) => set('max_hold_minutes', e.target.value)}
                />
                <span className="copy-form-hint">Close after this many minutes regardless of P/L</span>
              </div>
            )}
          </div>

          {/* ── Advanced ──────────────────────────────────────────────────── */}
          <div className="copy-form-section-head copy-form-section-head-muted">Advanced</div>
          <div className="copy-form-grid">
            <div className="copy-form-field copy-form-toggle-row">
              <label className="copy-form-label copy-form-label-muted">Opens Only</label>
              <div className="toggle-switch" style={{ width: 36, height: 20 }}><input type="checkbox" id="edit-opens-only" checked={form.opens_only} onChange={(e) => set('opens_only', e.target.checked)} /><label className="toggle-slider" htmlFor="edit-opens-only" /></div>
              <span className="copy-form-hint" style={{ marginLeft: 0 }}>Copy opening trades only</span>
            </div>
            <div className="copy-form-field copy-form-grid-wide">
              <label className="copy-form-label copy-form-label-muted">Notes</label>
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

  // Open position counts per bot (bot ID → count)
  const [openPositionCounts, setOpenPositionCounts] = useState<Map<string, number>>(new Map());
  // Per-bot trade statistics — keyed by copy_bots.id — from /api/copy/bot-stats
  type BotStatRow = { today: number; total: number; open: number; closed: number; wins: number; losses: number; pushes: number; pnl: number };
  const [botStats, setBotStats] = useState<Map<string, BotStatRow>>(new Map());
  // Bot status filter — Active (is_enabled=true) / Inactive (is_enabled=false)
  const [monitorFilter, setMonitorFilter] = useState<'all' | 'active' | 'inactive'>('all');
  // BOT STATUS confirmation modal
  const [confirmBotStatus, setConfirmBotStatus] = useState<{ bot: CopyBot; desired: 'active' | 'inactive' } | null>(null);
  // BOT STATUS success feedback (bot id → message, auto-clears)
  const [botStatusDone, setBotStatusDone] = useState<{ id: string; msg: string } | null>(null);

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

  // Sync trader names
  type SyncResult = {
    total_bots_checked:          number;
    total_wallets_checked:       number;
    verified_names_found:        number;
    bot_names_updated:           number;
    wallet_names_updated:        number;
    custom_names_preserved:      number;
    unmatched_wallets:           number;
    conflicting_wallets:         number;
    duplicate_wallet_records_found: number;
    manual_review:               { wallet_address: string; current_bot_name: string | null; current_wallet_name: string | null; reason: string }[];
  };
  const [syncBusy,          setSyncBusy]          = useState(false);
  const [syncResult,        setSyncResult]        = useState<SyncResult | null>(null);
  const [syncError,         setSyncError]         = useState<string | null>(null);
  const [showSyncConfirm,   setShowSyncConfirm]   = useState(false);
  const [showSyncReview,    setShowSyncReview]    = useState(false);

  async function handleSyncNames() {
    setSyncBusy(true);
    setSyncResult(null);
    setSyncError(null);
    setShowSyncConfirm(false);
    try {
      const res = await fetch('/api/copy/sync-trader-names', { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store' });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Sync failed');
      setSyncResult({
        total_bots_checked:          json.total_bots_checked          ?? 0,
        total_wallets_checked:       json.total_wallets_checked       ?? 0,
        verified_names_found:        json.verified_names_found        ?? 0,
        bot_names_updated:           json.bot_names_updated           ?? 0,
        wallet_names_updated:        json.wallet_names_updated        ?? 0,
        custom_names_preserved:      json.custom_names_preserved      ?? 0,
        unmatched_wallets:           json.unmatched_wallets           ?? 0,
        conflicting_wallets:         json.conflicting_wallets         ?? 0,
        duplicate_wallet_records_found: json.duplicate_wallet_records_found ?? 0,
        manual_review:               json.manual_review               ?? [],
      });
      await load(); // refresh bots to show updated names
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setSyncBusy(false);
    }
  }

  // Bulk paper trade size
  const [paperSizeAmount,       setPaperSizeAmount]       = useState('1');
  const [showPaperSizeModal,    setShowPaperSizeModal]    = useState(false);
  const [paperSizePreview,      setPaperSizePreview]      = useState<{ count: number; sizes: string } | null>(null);
  const [paperSizeLoading,      setPaperSizeLoading]      = useState(false);
  const [paperSizeApplying,     setPaperSizeApplying]     = useState(false);
  const [paperSizeResult,       setPaperSizeResult]       = useState<string | null>(null);
  const [paperSizeError,        setPaperSizeError]        = useState<string | null>(null);

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
      const [botsRes, settingsRes, positionsRes, statsRes] = await Promise.all([
        fetch('/api/copy/bots', { cache: 'no-store' }),
        fetch('/api/copy/settings', { cache: 'no-store' }),
        fetch('/api/copy/positions?status=OPEN&limit=500', { cache: 'no-store' }),
        fetch('/api/copy/bot-stats', { cache: 'no-store' }),
      ]);
      const botsPayload     = await botsRes.json();
      const settingsPayload = await settingsRes.json();
      if (botsPayload.ok)      setBots(botsPayload.rows ?? []);
      else                     setError(botsPayload.error ?? 'Failed to load bots');
      if (settingsPayload.ok && settingsPayload.settings) {
        setGlobalSettings({ live_on: settingsPayload.settings.live_on, emergency_stop: settingsPayload.settings.emergency_stop });
      }
      // Build per-bot open position count map for safety guard
      try {
        const posPayload = await positionsRes.json();
        if (posPayload.ok) {
          const countMap = new Map<string, number>();
          for (const pos of (posPayload.rows ?? []) as { copy_bot_id: string }[]) {
            countMap.set(pos.copy_bot_id, (countMap.get(pos.copy_bot_id) ?? 0) + 1);
          }
          setOpenPositionCounts(countMap);
        }
      } catch { /* positions fetch is best-effort */ }
      // Load per-bot trade statistics
      try {
        const statsPayload = await statsRes.json();
        if (statsPayload.ok && statsPayload.copy_bot_stats) {
          const statsMap = new Map<string, BotStatRow>();
          for (const [id, stat] of Object.entries(statsPayload.copy_bot_stats as Record<string, BotStatRow>)) {
            statsMap.set(id, stat);
          }
          setBotStats(statsMap);
        }
      } catch { /* stats are best-effort */ }
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

  // BOT STATUS toggle — writes is_enabled + opens_only + copy_closes atomically.
  // Active:   is_enabled=true,  opens_only=false, copy_closes=true
  // Inactive: is_enabled=false, opens_only=false, copy_closes=false
  // Existing open positions are NOT closed — they remain until they resolve naturally.
  const handleBotStatusToggle = useCallback(async (bot: CopyBot, desired: 'active' | 'inactive') => {
    const updates = desired === 'active'
      ? { is_enabled: true,  opens_only: false, copy_closes: true  }
      : { is_enabled: false, opens_only: false, copy_closes: false };
    await patchBot(bot.id, updates);
    setBotStatusDone({ id: bot.id, msg: desired === 'active' ? 'Bot activated' : 'Bot deactivated' });
    setTimeout(() => setBotStatusDone(null), 3_500);
  }, [patchBot]);

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

  // ── Bulk paper trade size handlers ───────────────────────────────────────────
  const handleOpenPaperSizeModal = async () => {
    setPaperSizeError(null);
    setPaperSizeResult(null);
    const amount = parseFloat(paperSizeAmount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000) {
      setPaperSizeError('Enter a valid amount between $0.01 and $1000');
      return;
    }
    setPaperSizeLoading(true);
    try {
      const res     = await fetch('/api/copy/bots/paper-size', { cache: 'no-store' });
      const payload = await res.json() as { ok: boolean; count: number; bots: { sizing_value: number | null; max_trade_size: number | null }[]; error?: string };
      if (!payload.ok) { setPaperSizeError(payload.error ?? 'Failed to load preview'); return; }
      const sizes = [...new Set(
        payload.bots.map((b) => b.sizing_value != null ? `$${b.sizing_value}` : '—')
      )].join(', ') || '—';
      setPaperSizePreview({ count: payload.count, sizes });
      setShowPaperSizeModal(true);
    } catch { setPaperSizeError('Network error'); }
    finally { setPaperSizeLoading(false); }
  };

  const handleApplyPaperSize = async () => {
    const amount = parseFloat(paperSizeAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    setPaperSizeApplying(true);
    setPaperSizeError(null);
    try {
      const res     = await fetch('/api/copy/bots/paper-size', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount_usd: amount }), cache: 'no-store',
      });
      const payload = await res.json() as { ok: boolean; updated_count?: number; error?: string };
      if (!payload.ok) { setPaperSizeError(payload.error ?? 'Update failed'); return; }
      setShowPaperSizeModal(false);
      const n = payload.updated_count ?? 0;
      setPaperSizeResult(`Updated ${n} active PAPER bot${n !== 1 ? 's' : ''} to $${amount} per trade.`);
      setTimeout(() => setPaperSizeResult(null), 8000);
      await load(); // refresh table so sizing displays update
    } catch { setPaperSizeError('Network error'); }
    finally { setPaperSizeApplying(false); }
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

  // Filter bots by status — reads is_enabled directly, never inferred from copy_closes/opens_only
  const filteredBots = useMemo(() => {
    if (monitorFilter === 'all')      return sortedBots;
    if (monitorFilter === 'active')   return sortedBots.filter((bot) => bot.is_enabled);
    if (monitorFilter === 'inactive') return sortedBots.filter((bot) => !bot.is_enabled);
    return sortedBots;
  }, [sortedBots, monitorFilter]);

  // Fast wallet-address → display label lookup used in the bot name cell
  const walletNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of wallets) {
      m.set(w.wallet_address, w.display_name || generateWalletName(w.wallet_address));
    }
    return m;
  }, [wallets]);

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

      {/* ── Bulk paper size confirmation modal ── */}
      {showPaperSizeModal && paperSizePreview && (
        <div className="copy-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowPaperSizeModal(false); }}>
          <div className="copy-modal" role="dialog" aria-modal="true" aria-label="Bulk paper trade size" style={{ maxWidth: 420 }}>
            <div className="copy-modal-header">
              <h3 className="copy-modal-title">Confirm Bulk Paper Size Update</h3>
              <button className="copy-modal-close" onClick={() => setShowPaperSizeModal(false)} type="button">×</button>
            </div>
            <div className="copy-modal-body">
              <p style={{ fontSize: '0.85rem', marginBottom: '1rem', color: 'rgba(248,250,252,0.75)' }}>
                Set all active PAPER bots to <strong style={{ color: '#f8fafc' }}>${parseFloat(paperSizeAmount) || 1}</strong> per trade?
              </p>
              <div style={{ marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', padding: '0.2rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <span style={{ color: 'rgba(248,250,252,0.45)' }}>Active PAPER bots</span>
                  <span style={{ fontWeight: 600 }}>{paperSizePreview.count}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', padding: '0.2rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <span style={{ color: 'rgba(248,250,252,0.45)' }}>Current sizes</span>
                  <span style={{ fontWeight: 600 }}>{paperSizePreview.sizes}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', padding: '0.2rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <span style={{ color: 'rgba(248,250,252,0.45)' }}>New size</span>
                  <span style={{ fontWeight: 600, color: '#34d399' }}>${parseFloat(paperSizeAmount) || 1}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', padding: '0.2rem 0' }}>
                  <span style={{ color: 'rgba(248,250,252,0.45)' }}>LIVE bots changed</span>
                  <span style={{ fontWeight: 600 }}>0</span>
                </div>
              </div>
              {paperSizeError && (
                <div style={{ fontSize: '0.75rem', color: '#f87171', marginTop: '0.5rem' }}>✗ {paperSizeError}</div>
              )}
            </div>
            <div className="copy-modal-footer">
              <button className="copy-btn copy-btn-secondary" onClick={() => setShowPaperSizeModal(false)} disabled={paperSizeApplying}>Cancel</button>
              <button
                className="copy-btn copy-btn-primary"
                onClick={handleApplyPaperSize}
                disabled={paperSizeApplying || paperSizePreview.count === 0}
              >
                {paperSizeApplying ? 'Updating…' : `UPDATE ${paperSizePreview.count} PAPER BOT${paperSizePreview.count !== 1 ? 'S' : ''}`}
              </button>
            </div>
          </div>
        </div>
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
            <button className="copy-btn copy-btn-secondary copy-btn-sm" onClick={() => setShowSyncConfirm(true)} disabled={syncBusy} title="Replace bot names with verified Polymarket usernames">
              {syncBusy ? 'Refreshing…' : '⟳ Refresh Actual Usernames'}
            </button>
            <button className="copy-btn copy-btn-secondary copy-btn-sm" onClick={handleBackfill} disabled={backfilling} title="Create default bots for wallets missing one">
              {backfilling ? 'Backfilling…' : '⊕ Backfill'}
            </button>
            <button className="copy-btn copy-btn-secondary copy-btn-sm" onClick={load} disabled={loading} title="Refresh">↻</button>
            <button className={`copy-btn copy-btn-sm ${showForm ? 'copy-btn-secondary' : 'copy-btn-primary'}`} onClick={() => setShowForm((v) => !v)}>
              {showForm ? 'Cancel' : '+ Add Bot'}
            </button>
          </div>
        </div>

        {/* ── Sync confirm modal ── */}
        {showSyncConfirm && (
          <div className="copy-modal-backdrop" onClick={() => setShowSyncConfirm(false)}>
            <div className="copy-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
              <h3 className="copy-modal-title">Refresh Actual Usernames</h3>
              <p style={{ fontSize: '0.82rem', color: 'rgba(248,250,252,0.6)', marginBottom: '1rem', lineHeight: 1.5 }}>
                Replace bot labels with the verified Polymarket usernames connected to each wallet?
                <br /><br />
                Checks Daily, Weekly, Monthly, and All-Time leaderboards. Verified usernames
                override any existing name — whether blank, auto-generated, or a previous custom label.
                <br /><br />
                <strong style={{ color: '#f8fafc' }}>This changes names only.</strong>{' '}
                Trading states and settings will not change.
              </p>
              <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
                <button className="copy-btn copy-btn-secondary copy-btn-sm" onClick={() => setShowSyncConfirm(false)}>Cancel</button>
                <button className="copy-btn copy-btn-primary copy-btn-sm" onClick={handleSyncNames}>Refresh Actual Usernames</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Sync result banner + manual review modal ── */}
        {syncResult && (
          <>
            <div className="copy-backfill-result" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.4rem' }}>
              <span>
                ✓ Checked {syncResult.total_bots_checked} bot{syncResult.total_bots_checked !== 1 ? 's' : ''} · {syncResult.verified_names_found} verified username{syncResult.verified_names_found !== 1 ? 's' : ''} found ·{' '}
                Corrected {syncResult.bot_names_updated} bot{syncResult.bot_names_updated !== 1 ? 's' : ''} + {syncResult.wallet_names_updated} wallet{syncResult.wallet_names_updated !== 1 ? 's' : ''}.
                {syncResult.unmatched_wallets > 0 && ` ${syncResult.unmatched_wallets} unmatched.`}
                {syncResult.conflicting_wallets > 0 && ` ${syncResult.conflicting_wallets} conflict${syncResult.conflicting_wallets !== 1 ? 's' : ''} (applied highest-confidence name).`}
                {syncResult.duplicate_wallet_records_found > 0 && ` ⚠ ${syncResult.duplicate_wallet_records_found} duplicate wallet record${syncResult.duplicate_wallet_records_found !== 1 ? 's' : ''}.`}
              </span>
              {syncResult.manual_review.length > 0 && (
                <button className="copy-btn copy-btn-secondary copy-btn-sm" style={{ fontSize: '0.68rem' }} onClick={() => setShowSyncReview(true)}>
                  Review {syncResult.manual_review.length} item{syncResult.manual_review.length !== 1 ? 's' : ''}
                </button>
              )}
            </div>

            {/* Manual review modal */}
            {showSyncReview && (
              <div className="copy-modal-backdrop" onClick={() => setShowSyncReview(false)}>
                <div className="copy-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 700, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
                  <h3 className="copy-modal-title">Manual Review — {syncResult.manual_review.length} item{syncResult.manual_review.length !== 1 ? 's' : ''}</h3>
                  <p style={{ fontSize: '0.76rem', color: 'rgba(248,250,252,0.45)', marginBottom: '0.6rem' }}>
                    Wallets not automatically renamed. No changes were made to these.
                  </p>
                  {/* Copyable text area */}
                  <textarea
                    readOnly
                    value={syncResult.manual_review.map((r) =>
                      `${r.wallet_address}\tbot: ${r.current_bot_name ?? '—'}\twallet: ${r.current_wallet_name ?? '—'}\treason: ${r.reason}`
                    ).join('\n')}
                    style={{ fontFamily: 'monospace', fontSize: '0.68rem', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.4rem', color: 'rgba(248,250,252,0.6)', padding: '0.6rem', resize: 'vertical', minHeight: 120, flexShrink: 0 }}
                  />
                  {/* Table view */}
                  <div style={{ overflowY: 'auto', flex: 1, marginTop: '0.6rem' }}>
                    <table className="copy-table" style={{ fontSize: '0.72rem' }}>
                      <thead>
                        <tr>
                          <th>Wallet</th>
                          <th>Bot Name</th>
                          <th>Wallet Name</th>
                          <th>Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {syncResult.manual_review.map((r, i) => (
                          <tr key={i}>
                            <td className="copy-mono" style={{ fontSize: '0.66rem' }}>{r.wallet_address.slice(0, 10)}…{r.wallet_address.slice(-6)}</td>
                            <td>{r.current_bot_name ?? <span className="copy-td-muted">—</span>}</td>
                            <td>{r.current_wallet_name ?? <span className="copy-td-muted">—</span>}</td>
                            <td className="copy-td-muted">{r.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.8rem' }}>
                    <button className="copy-btn copy-btn-secondary copy-btn-sm" onClick={() => setShowSyncReview(false)}>Close</button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        {syncError && (
          <div className="copy-backfill-result" style={{ color: '#f87171' }}>✗ Sync failed: {syncError}</div>
        )}

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

        {/* ── Bulk paper trade size result ── */}
        {paperSizeResult && (
          <div className="copy-backfill-result">✓ {paperSizeResult}</div>
        )}

        {/* ── Bulk paper trade size control ── */}
        {!loading && bots.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.55rem 1.5rem', borderBottom: '1px solid rgba(255,255,255,0.04)', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.72rem', color: 'rgba(248,250,252,0.4)', fontWeight: 600, letterSpacing: '0.03em', textTransform: 'uppercase' }}>Bulk Paper Trade Size</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <span style={{ fontSize: '0.75rem', color: 'rgba(248,250,252,0.5)' }}>$</span>
              <input
                className="copy-form-input"
                type="number"
                min="0.01"
                max="1000"
                step="0.01"
                value={paperSizeAmount}
                onChange={(e) => { setPaperSizeAmount(e.target.value); setPaperSizeError(null); }}
                style={{ width: '4.5rem', padding: '0.2rem 0.4rem', fontSize: '0.78rem' }}
                placeholder="1"
              />
            </div>
            <button
              className="copy-btn copy-btn-secondary copy-btn-sm"
              onClick={handleOpenPaperSizeModal}
              disabled={paperSizeLoading}
              title="Update sizing_value and max_trade_size for all enabled PAPER bots. LIVE bots are never changed."
            >
              {paperSizeLoading ? 'Loading…' : 'Update All Active Paper Bots'}
            </button>
            {paperSizeError && !showPaperSizeModal && (
              <span style={{ fontSize: '0.72rem', color: '#f87171' }}>⚠ {paperSizeError}</span>
            )}
            <span style={{ fontSize: '0.65rem', color: 'rgba(248,250,252,0.22)', marginLeft: 'auto' }}>
              Updates fixed trade size for enabled PAPER bots only. LIVE bots are never changed.
            </span>
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

        {/* ── Bot status filter — reads is_enabled directly ── */}
        {!loading && bots.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1.5rem', borderBottom: '1px solid rgba(255,255,255,0.04)', flexWrap: 'wrap' }}>
            {(['all', 'active', 'inactive'] as const).map((f) => {
              const labels: Record<typeof f, string> = { all: 'All', active: 'Active', inactive: 'Inactive' };
              const counts: Record<typeof f, number> = {
                all:      bots.length,
                active:   bots.filter((b) => b.is_enabled).length,
                inactive: bots.filter((b) => !b.is_enabled).length,
              };
              return (
                <button
                  key={f}
                  onClick={() => setMonitorFilter(f)}
                  className={`copy-btn copy-btn-sm ${monitorFilter === f ? 'copy-btn-primary' : 'copy-btn-secondary'}`}
                  style={{ fontSize: '0.72rem', padding: '0.2rem 0.7rem' }}
                >
                  {labels[f]}
                  {counts[f] > 0 && (
                    <span style={{ marginLeft: '0.35rem', opacity: 0.65, fontWeight: 400 }}>({counts[f]})</span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* BOT STATUS success feedback — auto-clears after 3.5 s */}
        {botStatusDone && (
          <div style={{ margin: '0.5rem 1.5rem', padding: '0.55rem 1rem', background: 'rgba(52,211,153,0.07)', border: '1px solid rgba(52,211,153,0.2)', borderRadius: '0.5rem', fontSize: '0.78rem', color: '#34d399', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            ✓ {botStatusDone.msg}
          </div>
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
            {/* 8 columns — fits desktop without horizontal scrolling */}
            <table className="copy-table copy-bots-table">
              <thead>
                <tr>
                  <th className="col-select">
                    <input type="checkbox" className="copy-bulk-check" checked={allSelected} onChange={toggleSelectAll}
                      ref={(el) => { if (el) el.indeterminate = someSelected; }} title={allSelected ? 'Deselect all' : 'Select all'} />
                  </th>
                  <th className="col-trader">Trader</th>
                  <th className="col-wallet" title="Shortened wallet address — hover or copy for full">Wallet</th>
                  <th className="col-mode">Mode</th>
                  <th className="col-status" title="Active: copies new entries and monitors exits. Inactive: bot stopped.">Status</th>
                  <th className="col-size" title="Max trade size per copy">Size</th>
                  <th className="col-arm" title="ARM LIVE: secondary safety gate">ARM LIVE</th>
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredBots.map((bot) => {
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
                        {/* Select */}
                        <td className="col-select">
                          <input type="checkbox" className="copy-bulk-check" checked={isSelected} onChange={() => toggleSelect(bot.id)} />
                        </td>

                        {/* Trader — avatar + name + profile link + shortened wallet + exit badge */}
                        <td className="col-trader">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                            <SourceAvatar sourceType="COPY_TRADER" name={walletNameMap.get(bot.wallet_address) ?? bot.name} size={28} />
                            <div style={{ minWidth: 0 }}>
                          <a
                            href={getPolymarketProfileUrl(null, bot.wallet_address) ?? '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="View on Polymarket"
                            className="copy-td-name"
                            style={{ textDecoration: 'none', color: 'inherit', display: 'inline-flex', alignItems: 'center', gap: '0.22rem', maxWidth: '100%', overflow: 'hidden' }}
                          >
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {walletNameMap.get(bot.wallet_address) ?? bot.name}
                            </span>
                            <span style={{ fontSize: '0.58rem', opacity: 0.35, flexShrink: 0 }}>↗</span>
                          </a>
                          {/* Secondary: shortened wallet + exit badge */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginTop: '0.12rem', flexWrap: 'wrap' }}>
                            <span className="copy-mono" style={{ fontSize: '0.63rem', color: 'rgba(248,250,252,0.28)' }}>
                              {shortenWallet(bot.wallet_address)}
                            </span>
                            <ExitModeBadge mode={bot.exit_mode} />
                          </div>
                          {/* Per-bot trade statistics — compact second line */}
                          {(() => {
                            const s = botStats.get(bot.id);
                            if (!s) return null;
                            const pnlColor = s.pnl > 0 ? '#34d399' : s.pnl < 0 ? '#f87171' : 'rgba(248,250,252,0.35)';
                            const pnlStr   = s.pnl === 0 ? '$0.00' : `${s.pnl > 0 ? '+' : ''}$${Math.abs(s.pnl).toFixed(2)}`;
                            return (
                              <div style={{ marginTop: '0.18rem', fontSize: '0.62rem', color: 'rgba(248,250,252,0.4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                <span title={`Opened today: ${s.today}`}>Today {s.today}</span>
                                <span style={{ opacity: 0.4, margin: '0 0.2rem' }}>·</span>
                                <span title={`Open positions: ${s.open}`}>Open {s.open}</span>
                                <span style={{ opacity: 0.4, margin: '0 0.2rem' }}>·</span>
                                <span title={`Closed positions: ${s.closed}`}>Closed {s.closed}</span>
                                {s.closed > 0 && (<>
                                  <span style={{ opacity: 0.4, margin: '0 0.2rem' }}>·</span>
                                  <span title={`Wins: ${s.wins}, Losses: ${s.losses}`}>W/L {s.wins}-{s.losses}</span>
                                  <span style={{ opacity: 0.4, margin: '0 0.2rem' }}>·</span>
                                  <span style={{ color: pnlColor, fontWeight: 600 }} title={`Closed P/L: ${pnlStr}`}>{pnlStr}</span>
                                </>)}
                              </div>
                            );
                          })()}
                            </div>{/* end inner div */}
                          </div>{/* end avatar+name flex row */}
                        </td>

                        {/* Wallet — shortened with copy button; full address in title tooltip */}
                        <td className="col-wallet">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.15rem' }}>
                            <span
                              className="copy-mono"
                              title={bot.wallet_address}
                              style={{ fontSize: '0.72rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 'calc(100% - 20px)' }}
                            >
                              {shortenWallet(bot.wallet_address)}
                            </span>
                            <button
                              className="copy-wallet-copy-btn"
                              title={`Copy: ${bot.wallet_address}`}
                              onClick={() => navigator.clipboard.writeText(bot.wallet_address)}
                            >
                              ⧉
                            </button>
                          </div>
                        </td>

                        {/* Mode */}
                        <td className="col-mode"><ModeBadge mode={bot.mode} /></td>

                        {/* Status — compact horizontal badge + toggle */}
                        <td className="col-status">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                            {bot.is_enabled ? (
                              <span className="copy-badge copy-badge-enabled" style={{ fontSize: '0.62rem' }}>ACTIVE</span>
                            ) : (
                              <span className="copy-badge copy-badge-disabled" style={{ fontSize: '0.62rem' }}>INACTIVE</span>
                            )}
                            {(openPositionCounts.get(bot.id) ?? 0) > 0 && (
                              <span style={{ fontSize: '0.56rem', color: '#fbbf24', fontWeight: 600 }}>
                                {openPositionCounts.get(bot.id)}p
                              </span>
                            )}
                            <button
                              className={`copy-btn copy-btn-sm ${bot.is_enabled ? 'copy-btn-secondary' : 'copy-btn-primary'}`}
                              style={{ fontSize: '0.62rem', padding: '0.12rem 0.5rem' }}
                              disabled={togglingId === bot.id}
                              onClick={() => setConfirmBotStatus({ bot, desired: bot.is_enabled ? 'inactive' : 'active' })}
                            >
                              {togglingId === bot.id ? '…' : bot.is_enabled ? 'Deactivate' : 'Activate'}
                            </button>
                          </div>
                        </td>

                        {/* Trade Size */}
                        <td className="col-size copy-td-num" title="Max trade size — edit via ✏ to change">
                          ${bot.max_trade_size}
                        </td>

                        {/* ARM LIVE — toggle only, no badge text */}
                        <td className="col-arm">
                          <div className="toggle-switch" style={{ width: 32, height: 18 }}>
                            <input
                              type="checkbox"
                              checked={bot.arm_live}
                              onChange={() => patchBot(bot.id, { arm_live: !bot.arm_live })}
                              disabled={togglingId === bot.id || bot.mode === 'PAPER'}
                              id={`bot-arm-${bot.id}`}
                              title={bot.mode === 'PAPER' ? 'ARM LIVE disabled for PAPER bots' : bot.arm_live ? 'Armed — click to disarm' : 'Disarmed — click to arm'}
                            />
                            <label className="toggle-slider" htmlFor={`bot-arm-${bot.id}`} />
                          </div>
                        </td>

                        {/* Actions */}
                        <td className="col-actions">
                          <div className="copy-bot-actions">
                            <button className="copy-bot-action-btn copy-bot-action-edit" onClick={() => setEditingBot(bot)} title="Edit settings" disabled={isDeleting}><IconEdit /></button>
                            <button className="copy-bot-action-btn copy-bot-action-delete" onClick={() => handleDelete(bot)} title="Delete bot" disabled={isDeleting || togglingId === bot.id}><IconTrash /></button>
                          </div>
                        </td>
                      </tr>
                      {rowDeleteErr && (
                        <tr key={`${bot.id}-err`}>
                          <td colSpan={8} style={{ padding: '0 1.25rem 0.6rem' }}>
                            <div className="copy-bot-delete-error">
                              <span>{rowDeleteErr.msg}</span>
                              {rowDeleteErr.isFk && (
                                <button className="copy-btn copy-btn-secondary copy-btn-sm" style={{ marginLeft: '0.75rem' }}
                                  onClick={() => { setDeleteError(null); handleBotStatusToggle(bot, 'inactive'); }}>
                                  Deactivate instead
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

      {/* ── BOT STATUS confirmation modal ── */}
      {confirmBotStatus && (
        <div className="copy-modal-backdrop" onClick={() => setConfirmBotStatus(null)}>
          <div className="copy-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <h3 className="copy-modal-title">
              {confirmBotStatus.desired === 'active' ? 'Activate this bot?' : 'Deactivate this bot?'}
            </h3>
            <p style={{ fontSize: '0.82rem', color: 'rgba(248,250,252,0.6)', marginBottom: '1rem', lineHeight: 1.55 }}>
              {confirmBotStatus.desired === 'active' ? (
                <>It will copy new entries and monitor exits.</>
              ) : (
                <>It will stop copying new entries and stop exit monitoring. <strong style={{ color: '#f8fafc' }}>Existing positions will not be closed.</strong></>
              )}
            </p>
            <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
              <button
                className="copy-btn copy-btn-secondary copy-btn-sm"
                onClick={() => setConfirmBotStatus(null)}
              >
                Cancel
              </button>
              <button
                className={`copy-btn copy-btn-sm ${confirmBotStatus.desired === 'active' ? 'copy-btn-primary' : 'copy-btn-secondary'}`}
                style={confirmBotStatus.desired === 'inactive' ? { borderColor: 'rgba(248,113,113,0.4)', color: '#f87171' } : {}}
                disabled={togglingId === confirmBotStatus.bot.id}
                onClick={async () => {
                  const { bot, desired } = confirmBotStatus;
                  setConfirmBotStatus(null);
                  await handleBotStatusToggle(bot, desired);
                }}
              >
                {confirmBotStatus.desired === 'active' ? 'Activate' : 'Deactivate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
