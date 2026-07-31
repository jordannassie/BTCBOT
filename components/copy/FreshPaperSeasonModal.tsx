'use client';

// FreshPaperSeasonModal — Guarded "Replace Old Traders & Start Fresh Paper" workflow.
//
// Steps:
//   preview  → load safety check + leaderboard candidates
//   select   → user picks up to 10 traders
//   confirm  → review summary + type "START FRESH PAPER"
//   applying → sequential API call in progress
//   done     → show final result
//
// Read-only: does not change bots, wallets, or positions until the user
// types the exact confirmation phrase and presses the confirm button.
//
// Does NOT touch LIVE bots, ARM LIVE, or the global live gate.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getPolymarketProfileUrl } from '@/lib/polymarketProfile';

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = 'loading' | 'preview' | 'select' | 'confirm' | 'applying' | 'done' | 'error';

type Candidate = {
  wallet_address: string;
  display_name:   string | null;
  periods:        string[];
  best_rank:      number;
  best_pnl:       number | null;
  best_volume:    number | null;
  is_tracked:     boolean;
  is_blocked:     boolean;
};

type PreviewPayload = {
  ok:              boolean;
  safety: {
    live_on:              boolean;
    emergency_stop:       boolean;
    arm_live_bots:        number;   // blocking: enabled LIVE bots with arm_live
    stale_arm_live_bots:  number;   // informational: all stale arm_live flags
    open_live_positions:  number;
    all_clear:            boolean;
  };
  safety_blocks:   string[];
  cleanup_notes:   string[];        // informational items cleaned up by the reset
  current_state: {
    total_wallets:        number;
    total_bots:           number;
    enabled_bots:         number;
    arm_live_bots:        number;   // blocking count
    stale_arm_live_bots:  number;   // total stale flags
    live_bots:            number;
    open_paper_positions: number;
    open_live_positions:  number;
    paper_balance:        number;
    paper_default:        number;
  };
  candidates:          Candidate[];
  recommended_wallets: string[];
  leaderboard_error:   string | null;
  fetched_at:          string;
  error?:              string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const truncate = (addr: string) =>
  addr.length > 14 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr;

function fmtCompact(v: number | null | undefined): string {
  if (v == null) return '—';
  const abs = Math.abs(v);
  const prefix = v < 0 ? '-$' : '$';
  if (abs >= 1_000_000) return `${prefix}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `${prefix}${(abs / 1_000).toFixed(1)}K`;
  return `${prefix}${abs.toFixed(2)}`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.78rem', marginBottom: '0.25rem' }}>
      <span style={{ color: ok ? '#34d399' : '#f87171', fontWeight: 700, fontSize: '0.9rem', lineHeight: 1 }}>
        {ok ? '✓' : '✗'}
      </span>
      <span style={{ color: ok ? 'rgba(248,250,252,0.7)' : '#f87171' }}>{label}</span>
    </div>
  );
}

function StatRow({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', padding: '0.18rem 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <span style={{ color: 'rgba(248,250,252,0.45)' }}>{label}</span>
      <span style={{ color: warn ? '#fbbf24' : '#f8fafc', fontWeight: 600 }}>{value}</span>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface FreshPaperSeasonModalProps {
  onClose:   () => void;
  /** When true the modal adds traders without resetting existing bots or positions */
  addMode?:  boolean;
}

export default function FreshPaperSeasonModal({ onClose, addMode = false }: FreshPaperSeasonModalProps) {
  const [step,         setStep]        = useState<Step>('loading');
  const [preview,      setPreview]     = useState<PreviewPayload | null>(null);
  const [loadError,    setLoadError]   = useState<string | null>(null);
  const [selected,     setSelected]    = useState<Set<string>>(new Set());
  const [tradeAmount,  setTradeAmount] = useState('5');
  const [confirmText,  setConfirmText] = useState('');
  const [applying,     setApplying]    = useState(false);
  const [applyResult,  setApplyResult] = useState<Record<string, unknown> | null>(null);
  const [applyError,   setApplyError]  = useState<string | null>(null);
  const [applyStep,    setApplyStep]   = useState<string | null>(null);

  // ── Load preview ──────────────────────────────────────────────────────────

  const loadPreview = useCallback(async () => {
    setStep('loading');
    setLoadError(null);
    try {
      const res     = await fetch('/api/copy/fresh-paper-season/preview', { cache: 'no-store' });
      const payload = await res.json() as PreviewPayload;
      if (!payload.ok) {
        setLoadError(payload.error ?? 'Failed to load preview');
        setStep('error');
        return;
      }
      setPreview(payload);
      // Pre-select recommended wallets
      setSelected(new Set(payload.recommended_wallets));
      setStep('preview');
    } catch {
      setLoadError('Network error loading preview');
      setStep('error');
    }
  }, []);

  useEffect(() => { loadPreview(); }, [loadPreview]);

  // ── Selection helpers ─────────────────────────────────────────────────────

  const toggleSelect = (addr: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(addr)) {
        next.delete(addr);
      } else {
        next.add(addr);
      }
      return next;
    });
  };

  const selectedCandidates = useMemo(
    () => (preview?.candidates ?? []).filter((c) => selected.has(c.wallet_address)),
    [preview, selected]
  );

  // ── Apply ─────────────────────────────────────────────────────────────────

  const requiredPhrase = addMode ? 'ADD PAPER TRADERS' : 'START FRESH PAPER';

  const handleApply = async () => {
    if (confirmText !== requiredPhrase) return;
    if (selected.size === 0) return;

    const amount = parseFloat(tradeAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;

    setApplying(true);
    setApplyError(null);
    setApplyStep('Verifying safety…');
    setStep('applying');

    try {
      const wallets = (preview?.candidates ?? [])
        .filter((c) => selected.has(c.wallet_address))
        .map((c) => ({ wallet_address: c.wallet_address, display_name: c.display_name }));

      const res = await fetch('/api/copy/fresh-paper-season/apply', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          confirmation:     requiredPhrase,
          selected_wallets: wallets,
          trade_amount:     amount,
          mode:             addMode ? 'add' : 'replace',
        }),
        cache: 'no-store',
      });

      const payload = await res.json() as Record<string, unknown>;
      if (payload.ok === true) {
        setApplyResult(payload);
        setStep('done');
      } else {
        setApplyError(String(payload.error ?? 'Apply failed'));
        setApplyStep(String(payload.step ?? ''));
        setStep('confirm'); // return to confirm so user can see the error
      }
    } catch {
      setApplyError('Network error — check connection and retry');
      setStep('confirm');
    } finally {
      setApplying(false);
    }
  };

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (step === 'applying') return;
    if (e.target === e.currentTarget) onClose();
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="copy-modal-overlay" onClick={handleOverlayClick}
      style={{ alignItems: 'flex-start', paddingTop: '2rem', overflowY: 'auto' }}
    >
      <div
        className="copy-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Replace Old Traders & Start Fresh Paper"
        style={{ maxWidth: 780, width: '96vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
      >
        {/* ── Header ── */}
        <div className="copy-modal-header">
          <h3 className="copy-modal-title">
            {addMode ? 'Add More Paper Traders' : 'Replace Old Traders & Start Fresh Paper'}
          </h3>
          {step !== 'applying' && (
            <button className="copy-modal-close" onClick={onClose} type="button" aria-label="Close">×</button>
          )}
        </div>

        {/* ── Body ── */}
        <div className="copy-modal-body" style={{ overflowY: 'auto', flex: 1 }}>

          {/* ────────── LOADING ────────── */}
          {step === 'loading' && (
            <div className="copy-loading" style={{ padding: '2rem' }}>Loading safety check…</div>
          )}

          {/* ────────── ERROR ────────── */}
          {step === 'error' && (
            <div style={{ padding: '1rem' }}>
              <p style={{ color: '#f87171', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                ⚠ {loadError ?? 'Unknown error'}
              </p>
              <button className="copy-btn copy-btn-secondary copy-btn-sm" onClick={loadPreview}>
                Retry
              </button>
            </div>
          )}

          {/* ────────── PREVIEW ────────── */}
          {step === 'preview' && preview && (
            <div>
              {/* Safety checks */}
              <div className="copy-form-section-head">Safety Check</div>
              <div style={{ padding: '0.5rem 0 0.75rem' }}>
                <Check ok={!preview.safety.live_on}            label={`Global live trading: ${preview.safety.live_on ? 'ON ⚠' : 'OFF ✓'}`} />
                <Check ok={preview.safety.arm_live_bots === 0} label={`Enabled LIVE bots with ARM LIVE: ${preview.safety.arm_live_bots}`} />
                <Check ok={preview.safety.open_live_positions === 0} label={`Open LIVE positions: ${preview.safety.open_live_positions}`} />
              </div>

              {/* Blocking errors */}
              {preview.safety_blocks.length > 0 && (
                <div style={{ marginBottom: '0.75rem', padding: '0.65rem 0.9rem', background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '0.5rem' }}>
                  {preview.safety_blocks.map((b, i) => (
                    <div key={i} style={{ fontSize: '0.75rem', color: '#f87171', marginBottom: i < preview.safety_blocks.length - 1 ? '0.3rem' : 0 }}>
                      ✗ {b}
                    </div>
                  ))}
                </div>
              )}

              {/* Informational cleanup notes — not blockers */}
              {preview.safety.all_clear && (preview.cleanup_notes ?? []).length > 0 && (
                <div style={{ marginBottom: '0.75rem', padding: '0.5rem 0.85rem', background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.18)', borderRadius: '0.5rem' }}>
                  <div style={{ fontSize: '0.7rem', color: '#818cf8', marginBottom: '0.2rem', fontWeight: 600 }}>Automatic cleanup before fresh start:</div>
                  {(preview.cleanup_notes ?? []).map((n, i) => (
                    <div key={i} style={{ fontSize: '0.72rem', color: 'rgba(248,250,252,0.55)' }}>• {n}</div>
                  ))}
                </div>
              )}

              {/* Current state */}
              <div className="copy-form-section-head">Current State</div>
              <div style={{ marginBottom: '1rem' }}>
                <StatRow label="Tracked wallets"               value={preview.current_state.total_wallets} />
                <StatRow label="Total bots"                    value={preview.current_state.total_bots} />
                <StatRow label="Enabled bots"                  value={preview.current_state.enabled_bots} />
                <StatRow label="Old bots to disarm"            value={preview.current_state.stale_arm_live_bots ?? 0} />
                <StatRow label="LIVE-mode bots"                value={preview.current_state.live_bots} />
                <StatRow label="Old paper positions to archive" value={preview.current_state.open_paper_positions} />
                <StatRow label="Open LIVE positions"           value={preview.current_state.open_live_positions} warn={preview.current_state.open_live_positions > 0} />
                <StatRow label="Paper bankroll"                value={`$${preview.current_state.paper_balance.toLocaleString()}`} />
                <StatRow label="Paper reset default"           value={`$${preview.current_state.paper_default.toLocaleString()}`} />
              </div>

              {preview.leaderboard_error && (
                <div style={{ marginBottom: '0.75rem', padding: '0.4rem 0.75rem', background: 'rgba(234,179,8,0.06)', border: '1px solid rgba(234,179,8,0.2)', borderRadius: '0.4rem', fontSize: '0.72rem', color: '#fbbf24' }}>
                  ⚠ Leaderboard unavailable: {preview.leaderboard_error}. You can still proceed if candidates loaded.
                </div>
              )}

              <div style={{ fontSize: '0.72rem', color: 'rgba(248,250,252,0.35)', marginBottom: '0.5rem' }}>
                {preview.candidates.length} traders found on the Polymarket leaderboard.
                {preview.recommended_wallets.length > 0 && ` ${preview.recommended_wallets.length} pre-selected as recommended.`}
              </div>
            </div>
          )}

          {/* ────────── SELECT ────────── */}
          {step === 'select' && preview && (
            <div>
              <div className="copy-form-section-head">
                {addMode ? 'Select Traders to Add' : 'Select Fresh Traders'}
                <span style={{ fontWeight: 400, color: 'rgba(248,250,252,0.35)', fontSize: '0.7rem', marginLeft: '0.5rem' }}>
                  {selected.size} selected
                </span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="copy-table" style={{ minWidth: 560 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 32 }} />
                      <th>Trader</th>
                      <th style={{ minWidth: 100 }}>Periods</th>
                      <th style={{ minWidth: 60 }}>Rank</th>
                      <th style={{ minWidth: 80 }}>Best PnL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.candidates.map((c) => {
                      const isChecked = selected.has(c.wallet_address);
                      return (
                        <tr
                          key={c.wallet_address}
                          style={{ cursor: 'pointer' }}
                          onClick={() => toggleSelect(c.wallet_address)}
                        >
                          <td>
                            <input
                              type="checkbox"
                              className="copy-bulk-check"
                              checked={isChecked}
                              onChange={() => toggleSelect(c.wallet_address)}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </td>
                          <td>
                            <div style={{ fontWeight: 600, fontSize: '0.8rem' }}>
                              <a
                                href={getPolymarketProfileUrl(null, c.wallet_address) ?? '#'}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: 'inherit', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {c.display_name ?? <span className="copy-mono" style={{ fontSize: '0.72rem' }}>{truncate(c.wallet_address)}</span>}
                                <span style={{ fontSize: '0.55rem', opacity: 0.4 }}>↗</span>
                              </a>
                            </div>
                            <span className="copy-td-sub copy-mono">{truncate(c.wallet_address)}</span>
                            {c.is_tracked && (
                              <span style={{ fontSize: '0.6rem', color: '#818cf8', marginLeft: '0.35rem' }}>tracked</span>
                            )}
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                              {c.periods.map((p) => (
                                <span key={p} className="copy-badge" style={{ fontSize: '0.58rem', background: 'rgba(99,102,241,0.1)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.2)' }}>
                                  {p.charAt(0).toUpperCase()}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="copy-td-num copy-td-muted">#{c.best_rank}</td>
                          <td className={`copy-td-num ${(c.best_pnl ?? 0) >= 0 ? 'copy-num-pos' : 'copy-num-neg'}`}>
                            {fmtCompact(c.best_pnl)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Trade amount input */}
              <div className="copy-form-section-head" style={{ marginTop: '1rem' }}>Paper Trade Settings</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0' }}>
                <label style={{ fontSize: '0.78rem', color: 'rgba(248,250,252,0.6)' }}>
                  Fixed trade amount (USD):
                </label>
                <input
                  className="copy-form-input"
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  value={tradeAmount}
                  onChange={(e) => setTradeAmount(e.target.value)}
                  style={{ width: '5rem' }}
                />
                <span style={{ fontSize: '0.7rem', color: 'rgba(248,250,252,0.35)' }}>
                  Per trade per bot · PAPER only
                </span>
              </div>
              <div style={{ fontSize: '0.65rem', color: 'rgba(248,250,252,0.25)', marginTop: '0.25rem' }}>
                Mode: PAPER | Enabled: ON | New Entries: ON | Exit Monitor: ON | ARM LIVE: OFF
              </div>
            </div>
          )}

          {/* ────────── CONFIRM ────────── */}
          {step === 'confirm' && preview && (
            <div>
              <div className="copy-form-section-head">What Will Happen</div>
              <div style={{ marginBottom: '1rem' }}>
                {!addMode && (
                  <>
                    <StatRow label="Old bots to disable &amp; disarm" value={preview.current_state.total_bots} />
                    <StatRow label="Old paper positions to archive"    value={preview.current_state.open_paper_positions} />
                    <StatRow label="Paper bankroll will reset to"      value={`$${preview.current_state.paper_default.toLocaleString()}`} />
                  </>
                )}
                {addMode && (
                  <StatRow label="Existing paper bots"    value="unchanged (not disabled)" />
                )}
                <StatRow label="New PAPER bots to create/enable" value={selected.size} />
                <StatRow label="Fixed trade amount"       value={`$${parseFloat(tradeAmount) || 5}`} />
                <StatRow label="New Entries"              value="ON (all new)" />
                <StatRow label="Exit Monitoring"          value="ON (all new)" />
                <StatRow label="ARM LIVE"                 value="OFF (all)" />
                <StatRow label="LIVE bots created"        value="0" />
              </div>

              {/* Informational warning about trader count */}
              {selected.size > 5 && (
                <div style={{ marginBottom: '0.75rem', padding: '0.5rem 0.85rem', background: 'rgba(234,179,8,0.05)', border: '1px solid rgba(234,179,8,0.18)', borderRadius: '0.5rem', fontSize: '0.72rem', color: 'rgba(248,250,252,0.55)' }}>
                  ℹ {selected.size} traders selected · Each bot trades ${parseFloat(tradeAmount) || 5} per position · Paper exposure is governed by the existing paper max-exposure setting.
                </div>
              )}

              <div className="copy-form-section-head">Selected Traders</div>
              <div style={{ marginBottom: '1rem' }}>
                {selectedCandidates.map((c) => (
                  <div key={c.wallet_address} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.76rem', padding: '0.2rem 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <span style={{ color: '#34d399' }}>●</span>
                    <a
                      href={getPolymarketProfileUrl(null, c.wallet_address) ?? '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#f8fafc', textDecoration: 'none', fontWeight: 600 }}
                    >
                      {c.display_name ?? truncate(c.wallet_address)} ↗
                    </a>
                    <span className="copy-mono copy-td-muted" style={{ fontSize: '0.68rem' }}>{truncate(c.wallet_address)}</span>
                    <span style={{ color: '#818cf8', fontSize: '0.66rem', marginLeft: 'auto' }}>
                      #{c.best_rank} · {fmtCompact(c.best_pnl)}
                    </span>
                  </div>
                ))}
              </div>

              {applyError && (
                <div style={{ marginBottom: '0.75rem', padding: '0.6rem 0.9rem', background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '0.5rem', fontSize: '0.75rem', color: '#f87171' }}>
                  ✗ {applyError}
                  {applyStep && <span style={{ opacity: 0.6, marginLeft: '0.5rem' }}>(failed at: {applyStep})</span>}
                </div>
              )}

              <div className="copy-form-section-head">Confirmation Required</div>
              <div style={{ marginBottom: '0.75rem', fontSize: '0.78rem', color: 'rgba(248,250,252,0.55)' }}>
                Type <strong style={{ color: '#f8fafc' }}>{requiredPhrase}</strong> to confirm:
              </div>
              <input
                className="copy-form-input"
                type="text"
                placeholder={requiredPhrase}
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                disabled={applying}
                autoComplete="off"
                style={{ letterSpacing: '0.05em', fontWeight: 700, marginBottom: '0.25rem' }}
              />
              {confirmText && confirmText !== requiredPhrase && (
                <div style={{ fontSize: '0.68rem', color: '#f87171', marginBottom: '0.5rem' }}>
                  Phrase must match exactly
                </div>
              )}
            </div>
          )}

          {/* ────────── APPLYING ────────── */}
          {step === 'applying' && (
            <div style={{ padding: '1.5rem 0.5rem' }}>
              <div className="copy-loading" style={{ padding: 0, marginBottom: '0.75rem' }}>
                Applying changes…
              </div>
              {applyStep && (
                <div style={{ fontSize: '0.75rem', color: 'rgba(248,250,252,0.4)', textAlign: 'center' }}>
                  {applyStep}
                </div>
              )}
              <div style={{ marginTop: '1.5rem', fontSize: '0.7rem', color: 'rgba(248,250,252,0.25)', textAlign: 'center' }}>
                Do not close this window.
              </div>
            </div>
          )}

          {/* ────────── DONE ────────── */}
          {step === 'done' && applyResult && (
            <div>
              <div style={{ textAlign: 'center', padding: '0.75rem 0 1.25rem' }}>
                <div style={{ fontSize: '2rem', marginBottom: '0.25rem' }}>🎉</div>
                <div style={{ fontSize: '1rem', fontWeight: 700, color: '#34d399', marginBottom: '0.25rem' }}>
                  {applyResult.apply_mode === 'add' ? 'Paper Traders Added' : 'Fresh Paper Season Started'}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'rgba(248,250,252,0.35)' }}>
                  {String(applyResult.started_at ?? new Date().toISOString()).replace('T', ' ').slice(0, 19)} UTC
                </div>
              </div>

              <div className="copy-form-section-head">Results</div>
              <div style={{ marginBottom: '1rem' }}>
                {applyResult.apply_mode !== 'add' && (
                  <>
                    <StatRow label="Old bots disabled"      value={Number(applyResult.bots_disabled   ?? 0)} />
                    <StatRow label="Paper positions cleared" value={Number(applyResult.paper_positions_cleared ?? 0)} />
                    <StatRow label="Paper bankroll"         value={`$${Number(applyResult.paper_bankroll ?? 0).toLocaleString()}`} />
                  </>
                )}
                <StatRow label="Wallets upserted"           value={Number(applyResult.wallets_upserted ?? 0)} />
                <StatRow label="New PAPER bots created"     value={Number(applyResult.bots_created ?? 0)} />
                <StatRow label="Existing PAPER bots updated" value={Number(applyResult.bots_updated ?? 0)} />
              </div>

              {applyResult.final != null && typeof applyResult.final === 'object' && (() => {
                const f = applyResult.final as Record<string, number>;
                return (
                  <>
                    <div className="copy-form-section-head">Final State Verified</div>
                    <div style={{ marginBottom: '1rem' }}>
                      <StatRow label="Fresh bots total"         value={f.fresh_bots_total ?? 0} />
                      <StatRow label="Fresh bots enabled"       value={f.fresh_bots_enabled ?? 0} />
                      <StatRow label="New Entries ON"           value={f.fresh_bots_new_entries_on ?? 0} />
                      <StatRow label="Exit Monitoring ON"       value={f.fresh_bots_exit_monitor_on ?? 0} />
                      <StatRow label="ARM LIVE bots"            value={f.fresh_bots_arm_live ?? 0} warn={(f.fresh_bots_arm_live ?? 0) > 0} />
                      <StatRow label="LIVE-mode bots created"   value={f.fresh_bots_live_mode ?? 0} warn={(f.fresh_bots_live_mode ?? 0) > 0} />
                    </div>
                  </>
                );
              })()}

              <div style={{ fontSize: '0.68rem', color: 'rgba(248,250,252,0.25)', marginTop: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.5rem' }}>
                Historical bot records, attempts, trades, and wallet metrics were preserved.
                New paper bots will only copy source activity detected after this activation timestamp.
              </div>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="copy-modal-footer" style={{ flexShrink: 0 }}>
          {step === 'loading' && (
            <button className="copy-btn copy-btn-secondary" onClick={onClose}>Cancel</button>
          )}

          {step === 'error' && (
            <>
              <button className="copy-btn copy-btn-secondary" onClick={onClose}>Close</button>
              <button className="copy-btn copy-btn-primary" onClick={loadPreview}>Retry</button>
            </>
          )}

          {step === 'preview' && (
            <>
              <button className="copy-btn copy-btn-secondary" onClick={onClose}>Cancel</button>
              {preview && (
                <button
                  className="copy-btn copy-btn-primary"
                  onClick={() => setStep('select')}
                  disabled={!preview.safety.all_clear || preview.candidates.length === 0}
                  title={!preview.safety.all_clear ? 'Fix safety issues before proceeding' : undefined}
                >
                  {preview.safety.all_clear ? 'Select Traders →' : 'Safety Issues Must Be Resolved'}
                </button>
              )}
            </>
          )}

          {step === 'select' && (
            <>
              <button className="copy-btn copy-btn-secondary" onClick={() => setStep('preview')}>← Back</button>
              <button
                className="copy-btn copy-btn-primary"
                onClick={() => setStep('confirm')}
                disabled={selected.size === 0}
              >
                Review &amp; Confirm ({selected.size} traders) →
              </button>
            </>
          )}

          {step === 'confirm' && (
            <>
              <button className="copy-btn copy-btn-secondary" onClick={() => { setApplyError(null); setStep('select'); }} disabled={applying}>
                ← Back
              </button>
              <button
                className="copy-btn copy-btn-primary"
                onClick={handleApply}
                disabled={applying || confirmText !== requiredPhrase || selected.size === 0}
              >
                {applying ? 'Applying…' : addMode
                  ? `Add ${selected.size} Paper Trader${selected.size !== 1 ? 's' : ''}`
                  : `Start Fresh Paper (${selected.size} traders)`
                }
              </button>
            </>
          )}

          {step === 'applying' && (
            <button className="copy-btn copy-btn-secondary" disabled>Please wait…</button>
          )}

          {step === 'done' && (
            <>
              <button className="copy-btn copy-btn-secondary" onClick={onClose}>
                Close
              </button>
              <button className="copy-btn copy-btn-primary" onClick={onClose}>
                View Active Bots
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
