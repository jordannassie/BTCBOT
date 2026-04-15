'use client';

// Master Strategy — Settings tab section.
//
// Provides:
//   • Preset chips (Paper Test | Live Small | Conservative | Aggressive | % Compounding)
//   • Full bot-settings form (mode, copy_mode, sizing, limits, toggles, notes)
//   • Save Master Strategy → POST /api/copy/master-strategy {action:'save'}
//   • Use for New Bots toggle → POST /api/copy/master-strategy {action:'set_use_for_new_bots'}
//   • Apply to All Bots → POST /api/copy/master-strategy {action:'apply', target:'all'}
//   • Apply to Selected Bots → reads btcbot-selected-bot-ids from localStorage,
//       POST /api/copy/master-strategy {action:'apply', target:[...ids]}
//
// Existing per-bot overrides are untouched until the operator explicitly clicks Apply.

import { useCallback, useEffect, useState } from 'react';
import {
  MASTER_STRATEGY_PRESETS,
  MASTER_STRATEGY_DEFAULTS,
  SELECTED_BOTS_LS_KEY,
  type MasterStrategy,
} from '@/lib/copy/masterStrategy';

// ─── Types ────────────────────────────────────────────────────────────────────

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
type ApplyStatus = 'idle' | 'applying' | 'done' | 'error';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString() : 'never';

function readSelectedIds(): string[] {
  try {
    const raw = localStorage.getItem(SELECTED_BOTS_LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MasterStrategySection() {
  // ── Remote state ────────────────────────────────────────────────────────────
  const [savedStrategy, setSavedStrategy] = useState<MasterStrategy | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── "Use for new bots" is persisted remotely ─────────────────────────────
  const [useForNewBots, setUseForNewBots] = useState(false);
  const [toggleSaving, setToggleSaving] = useState(false);
  const [toggleMsg, setToggleMsg] = useState<{ text: string; ok: boolean } | null>(null);

  // ── Form state (mirrors MasterStrategy fields) ───────────────────────────
  const [form, setForm] = useState<MasterStrategy>(MASTER_STRATEGY_DEFAULTS);

  // ── Save / Apply status ──────────────────────────────────────────────────
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveMsg, setSaveMsg] = useState('');
  const [applyStatus, setApplyStatus] = useState<ApplyStatus>('idle');
  const [applyMsg, setApplyMsg] = useState('');

  // ── Selected bots (read from localStorage, updated on focus) ────────────
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const refreshSelectedIds = useCallback(() => {
    setSelectedIds(readSelectedIds());
  }, []);

  // ─── Load from API ─────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/copy/master-strategy', { cache: 'no-store' });
      const p   = await res.json();
      if (p.ok) {
        setUseForNewBots(p.use_for_new_bots ?? false);
        setSavedAt(p.saved_at);
        if (p.strategy) {
          setSavedStrategy(p.strategy as MasterStrategy);
          setForm(p.strategy as MasterStrategy);
        }
      } else {
        setLoadError(p.error ?? 'Failed to load');
      }
    } catch {
      setLoadError('Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    refreshSelectedIds();

    // Re-read selected bots when the operator switches back to this tab
    const onVisible = () => { if (!document.hidden) refreshSelectedIds(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', refreshSelectedIds);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', refreshSelectedIds);
    };
  }, [load, refreshSelectedIds]);

  // ─── Preset loader ─────────────────────────────────────────────────────────

  const loadPreset = (name: string) => {
    const preset = MASTER_STRATEGY_PRESETS[name];
    if (!preset) return;
    setForm((f) => ({ ...f, ...preset }));
  };

  // ─── Form setters ──────────────────────────────────────────────────────────

  const setField = <K extends keyof MasterStrategy>(key: K, value: MasterStrategy[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const numField = (key: keyof MasterStrategy, raw: string) => {
    const n = parseFloat(raw);
    if (Number.isFinite(n) && n >= 0) setField(key, n as never);
  };

  // ─── Save ──────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    setSaveStatus('saving');
    setSaveMsg('');
    try {
      const res = await fetch('/api/copy/master-strategy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', strategy: form }),
      });
      const p = await res.json();
      if (p.ok) {
        setSavedStrategy(form);
        setSavedAt(new Date().toISOString());
        setSaveStatus('saved');
        setSaveMsg('Master Strategy saved.');
      } else {
        setSaveStatus('error');
        setSaveMsg(p.error ?? 'Save failed');
      }
    } catch {
      setSaveStatus('error');
      setSaveMsg('Network error');
    }
    setTimeout(() => { setSaveStatus('idle'); setSaveMsg(''); }, 3000);
  };

  // ─── Use for New Bots toggle ───────────────────────────────────────────────

  const handleToggleUseForNew = async (value: boolean) => {
    if (!savedStrategy && value) {
      setToggleMsg({ text: 'Save a Master Strategy first.', ok: false });
      setTimeout(() => setToggleMsg(null), 3000);
      return;
    }
    setToggleSaving(true);
    setToggleMsg(null);
    try {
      const res = await fetch('/api/copy/master-strategy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_use_for_new_bots', value }),
      });
      const p = await res.json();
      if (p.ok) {
        setUseForNewBots(value);
        setToggleMsg({
          text: value ? 'New bots will inherit this strategy.' : 'New bots will use default settings.',
          ok: true,
        });
      } else {
        setToggleMsg({ text: p.error ?? 'Toggle failed', ok: false });
      }
    } catch {
      setToggleMsg({ text: 'Network error', ok: false });
    } finally {
      setToggleSaving(false);
      setTimeout(() => setToggleMsg(null), 3500);
    }
  };

  // ─── Apply ─────────────────────────────────────────────────────────────────

  const doApply = async (target: 'all' | string[]) => {
    if (!savedStrategy) {
      setApplyStatus('error');
      setApplyMsg('No strategy saved. Click "Save Master Strategy" first.');
      setTimeout(() => { setApplyStatus('idle'); setApplyMsg(''); }, 4000);
      return;
    }

    const noun =
      target === 'all'
        ? 'ALL bots'
        : `${(target as string[]).length} selected bot${(target as string[]).length !== 1 ? 's' : ''}`;

    if (!window.confirm(`Apply the saved Master Strategy to ${noun}?\n\nThis will overwrite each bot's mode, sizing, and limits immediately.`)) {
      return;
    }

    setApplyStatus('applying');
    setApplyMsg('');
    try {
      const res = await fetch('/api/copy/master-strategy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'apply', target }),
      });
      const p = await res.json();
      if (p.ok) {
        setApplyStatus('done');
        setApplyMsg(`Strategy applied to ${p.updated} bot${p.updated !== 1 ? 's' : ''}.`);
      } else {
        setApplyStatus('error');
        setApplyMsg(p.error ?? 'Apply failed');
      }
    } catch {
      setApplyStatus('error');
      setApplyMsg('Network error');
    }
    setTimeout(() => { setApplyStatus('idle'); setApplyMsg(''); }, 5000);
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="copy-section copy-master-section">
        <div className="copy-section-head">
          <div className="copy-section-title-row">
            <h2 className="copy-section-title">Master Strategy</h2>
          </div>
        </div>
        <div className="copy-loading">Loading…</div>
      </div>
    );
  }

  const isSaving   = saveStatus  === 'saving';
  const isApplying = applyStatus === 'applying';

  return (
    <div className="copy-section copy-master-section">

      {/* ── Header ── */}
      <div className="copy-section-head">
        <div className="copy-section-title-row">
          <h2 className="copy-section-title">Master Strategy</h2>
          <span className="copy-section-subtitle">Set once. Push to all bots.</span>
        </div>
        <div className="copy-master-meta">
          {savedStrategy
            ? <span className="copy-master-saved-badge">Saved {fmtDate(savedAt)}</span>
            : <span className="copy-master-unsaved-badge">No strategy saved yet</span>}
        </div>
      </div>

      {loadError && (
        <div className="copy-master-banner copy-master-banner--error">{loadError}</div>
      )}

      {/* ── Preset chips ── */}
      <div className="copy-master-presets-row">
        <span className="copy-master-presets-label">Quick Preset:</span>
        {Object.keys(MASTER_STRATEGY_PRESETS).map((name) => (
          <button
            key={name}
            className="copy-master-preset-btn"
            onClick={() => loadPreset(name)}
            title={`Load ${name} preset (does not save)`}
          >
            {name}
          </button>
        ))}
      </div>

      {/* ── Form ── */}
      <div className="copy-master-form">

        {/* Row 1 — Mode + Copy Mode */}
        <div className="copy-settings-field-row">
          <div className="copy-form-field">
            <label className="copy-form-label">Mode</label>
            <select
              className="copy-form-input"
              value={form.mode}
              onChange={(e) => setField('mode', e.target.value as 'PAPER' | 'LIVE')}
            >
              <option value="PAPER">PAPER</option>
              <option value="LIVE">LIVE</option>
            </select>
          </div>
          <div className="copy-form-field">
            <label className="copy-form-label">Copy Mode</label>
            <select
              className="copy-form-input"
              value={form.copy_mode}
              onChange={(e) => setField('copy_mode', e.target.value as 'exact' | 'scaled' | 'percent')}
            >
              <option value="exact">Exact (fixed USD)</option>
              <option value="scaled">Scaled (proportional)</option>
              <option value="percent">Percent of Bankroll</option>
            </select>
            <span className="copy-form-hint">
              {form.copy_mode === 'percent'
                ? 'Sizing Value = % of paper/live bankroll per trade'
                : form.copy_mode === 'exact'
                ? 'Sizing Value = fixed USD per trade'
                : 'Sizing Value = multiplier applied to source trade size'}
            </span>
          </div>
        </div>

        {/* Row 2 — Sizing Value + Max Trade Size */}
        <div className="copy-settings-field-row">
          <div className="copy-form-field">
            <label className="copy-form-label">
              {form.copy_mode === 'percent' ? 'Trade Size %' : 'Sizing Value'}
            </label>
            <input
              className="copy-form-input"
              type="number"
              step={form.copy_mode === 'percent' ? '0.5' : '0.1'}
              min="0"
              value={form.sizing_value}
              onChange={(e) => numField('sizing_value', e.target.value)}
            />
            <span className="copy-form-hint">
              {form.copy_mode === 'percent'
                ? 'e.g. 5 = 5% of bankroll per trade'
                : form.copy_mode === 'exact'
                ? 'Fixed USD amount per copied trade'
                : 'Multiplier on source trade size'}
            </span>
          </div>
          <div className="copy-form-field">
            <label className="copy-form-label">Max Trade Size USD</label>
            <input
              className="copy-form-input"
              type="number"
              step="1"
              min="0"
              value={form.max_trade_size}
              onChange={(e) => numField('max_trade_size', e.target.value)}
            />
            <span className="copy-form-hint">Cap per trade. Applies to all copy modes.</span>
          </div>
        </div>

        {/* Row 3 — Position limits */}
        <div className="copy-settings-field-row">
          <div className="copy-form-field">
            <label className="copy-form-label">Max Open Positions</label>
            <input
              className="copy-form-input"
              type="number"
              step="1"
              min="0"
              value={form.max_open_positions}
              onChange={(e) => numField('max_open_positions', e.target.value)}
            />
            <span className="copy-form-hint">0 = unlimited</span>
          </div>
          <div className="copy-form-field">
            <label className="copy-form-label">Max Trades / Hour</label>
            <input
              className="copy-form-input"
              type="number"
              step="1"
              min="0"
              value={form.max_trades_per_hour}
              onChange={(e) => numField('max_trades_per_hour', e.target.value)}
            />
            <span className="copy-form-hint">0 = unlimited</span>
          </div>
        </div>

        {/* Row 4 — Slippage + Delay */}
        <div className="copy-settings-field-row">
          <div className="copy-form-field">
            <label className="copy-form-label">Max Slippage</label>
            <input
              className="copy-form-input"
              type="number"
              step="0.001"
              min="0"
              max="1"
              value={form.max_slippage}
              onChange={(e) => numField('max_slippage', e.target.value)}
            />
            <span className="copy-form-hint">e.g. 0.03 = 3%</span>
          </div>
          <div className="copy-form-field">
            <label className="copy-form-label">Delay Seconds</label>
            <input
              className="copy-form-input"
              type="number"
              step="1"
              min="0"
              value={form.delay_seconds}
              onChange={(e) => numField('delay_seconds', e.target.value)}
            />
            <span className="copy-form-hint">Wait before placing order</span>
          </div>
        </div>

        {/* Row 5 — Toggles */}
        <div className="copy-master-toggle-grid">
          {([
            ['is_enabled',  'Enabled by default',    'New bots start enabled'],
            ['arm_live',    'ARM LIVE by default',    'Secondary gate for live orders'],
            ['opens_only',  'Opens Only',             'Copy opening trades only'],
            ['copy_closes', 'Copy Closes',            'Mirror source exits'],
          ] as [keyof MasterStrategy, string, string][]).map(([key, label, hint]) => (
            <div key={key} className="copy-form-field copy-form-toggle-row copy-master-toggle-field">
              <label className="copy-form-label">{label}</label>
              <div className="copy-master-toggle-row-inner">
                <div className="toggle-switch" style={{ width: 36, height: 20 }}>
                  <input
                    type="checkbox"
                    id={`ms-${key}`}
                    checked={form[key] as boolean}
                    onChange={(e) => setField(key, e.target.checked as never)}
                  />
                  <label className="toggle-slider" htmlFor={`ms-${key}`} />
                </div>
                <span className="copy-form-hint" style={{ marginLeft: 0 }}>{hint}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Notes */}
        <div className="copy-form-field copy-master-notes-field">
          <label className="copy-form-label">Notes (optional)</label>
          <textarea
            className="copy-form-input copy-master-textarea"
            value={form.notes ?? ''}
            onChange={(e) => setField('notes', e.target.value || null)}
            placeholder="Describe this strategy…"
            rows={2}
          />
        </div>

      </div>

      {/* ── Save status ── */}
      {saveMsg && (
        <div className={`copy-master-banner ${saveStatus === 'error' ? 'copy-master-banner--error' : 'copy-master-banner--ok'}`}>
          {saveMsg}
        </div>
      )}

      {/* ── Save button ── */}
      <div className="copy-master-save-row">
        <button
          className="copy-btn copy-btn-primary"
          onClick={handleSave}
          disabled={isSaving || isApplying}
        >
          {isSaving ? 'Saving…' : 'Save Master Strategy'}
        </button>
        {savedStrategy && (
          <button
            className="copy-btn copy-btn-secondary copy-btn-sm"
            onClick={() => setForm(savedStrategy)}
            disabled={isSaving}
            title="Revert form to the last saved strategy"
          >
            Revert to Saved
          </button>
        )}
      </div>

      {/* ── Divider ── */}
      <div className="copy-master-divider" />

      {/* ── Use for New Bots toggle ── */}
      <div className="copy-master-use-new-row">
        <div className="copy-master-use-new-text">
          <span className="copy-master-use-new-label">Use for new bots</span>
          <span className="copy-master-use-new-hint">
            When ON, any new bot created via Add Wallet, Create Bot, or Backfill will inherit the
            saved Master Strategy instead of the system defaults.
          </span>
        </div>
        <div className="copy-master-use-new-control">
          <div className="toggle-switch">
            <input
              type="checkbox"
              id="ms-use-for-new"
              checked={useForNewBots}
              onChange={(e) => handleToggleUseForNew(e.target.checked)}
              disabled={toggleSaving}
            />
            <label className="toggle-slider" htmlFor="ms-use-for-new" />
          </div>
          {useForNewBots && (
            <span className="copy-master-use-new-on-badge">ON</span>
          )}
        </div>
      </div>
      {toggleMsg && (
        <div className={`copy-master-banner ${toggleMsg.ok ? 'copy-master-banner--ok' : 'copy-master-banner--error'}`}>
          {toggleMsg.text}
        </div>
      )}

      {/* ── Divider ── */}
      <div className="copy-master-divider" />

      {/* ── Apply section ── */}
      <div className="copy-master-apply-section">
        <div className="copy-master-apply-head">
          <span className="copy-master-apply-title">Apply saved strategy to bots</span>
          <span className="copy-master-apply-hint">
            Overwrites the target bots immediately. Per-bot editing still works after apply.
          </span>
        </div>

        <div className="copy-master-apply-btns">
          <button
            className="copy-btn copy-btn-secondary"
            onClick={() => doApply('all')}
            disabled={!savedStrategy || isApplying || isSaving}
            title="Apply saved strategy to every bot"
          >
            {isApplying ? 'Applying…' : 'Apply to All Bots'}
          </button>

          <button
            className={`copy-btn copy-btn-secondary${selectedIds.length === 0 ? ' copy-btn-disabled' : ''}`}
            onClick={() => {
              const ids = readSelectedIds();
              if (ids.length === 0) {
                setApplyStatus('error');
                setApplyMsg('No bots selected. Go to the Bots tab and check rows first.');
                setTimeout(() => { setApplyStatus('idle'); setApplyMsg(''); }, 4000);
                return;
              }
              doApply(ids);
            }}
            disabled={!savedStrategy || isApplying || isSaving || selectedIds.length === 0}
            title={
              selectedIds.length > 0
                ? `Apply to ${selectedIds.length} selected bot${selectedIds.length !== 1 ? 's' : ''}`
                : 'Select bots in the Bots tab first'
            }
          >
            Apply to{' '}
            {selectedIds.length > 0
              ? `${selectedIds.length} Selected Bot${selectedIds.length !== 1 ? 's' : ''}`
              : 'Selected Bots'}
          </button>

          {selectedIds.length === 0 && (
            <span className="copy-master-apply-select-hint">
              ← Select bot rows in the Bots tab, then return here
            </span>
          )}
        </div>

        {applyMsg && (
          <div className={`copy-master-banner ${applyStatus === 'error' || applyStatus === 'idle' && applyMsg.startsWith('No') ? 'copy-master-banner--error' : 'copy-master-banner--ok'}`}>
            {applyMsg}
          </div>
        )}
      </div>

      {/* ── Relationship note ── */}
      <div className="copy-master-rel-note">
        <strong>Master Strategy</strong> = saved template, applied on demand. &nbsp;
        <strong>Bulk Apply</strong> (Bots tab) = ad-hoc field update. &nbsp;
        <strong>Bot Edit</strong> = one bot at a time.
      </div>

    </div>
  );
}
