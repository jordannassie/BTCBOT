'use client';

// CopyTradingStatusPanel — Single compact status row replacing the four
// separate banners/cards previously rendered by CopyPauseControl and
// PaperCopyMasterControl.
//
// Fetches from both existing APIs:
//   GET /api/copy/bots/pause     — copy-entry pause state
//   GET /api/copy/bots/paper-off — paper bot on/off state
//
// All existing POST actions are preserved unchanged:
//   Resume Copy Entries  → POST /api/copy/bots/pause    { action: 'resume' }
//   Pause Copy Entries   → POST /api/copy/bots/pause    { action: 'pause'  }
//   Turn On Paper Bots   → POST /api/copy/bots/paper-off { action: 'on'    }
//   Turn Off Paper Bots  → POST /api/copy/bots/paper-off { action: 'off'   }
//
// No bot state is changed on render.

import { useCallback, useEffect, useState } from 'react';

// ─── Types ─────────────────────────────────────────────────────────────────────

type PauseStatus = {
  ok:                  boolean;
  paused:              boolean;
  paused_at:           string | null;
  active_before_pause: string[];
  enabled_bots:        number;
  active_bots:         number;
  open_positions:      number;
  error?:              string;
};

type PaperStatus = {
  ok:                 boolean;
  paper_off:          boolean;
  turned_off_at:      string | null;
  prev_enabled_count: number;
  total_paper_bots:   number;
  enabled_paper_bots: number;
  error?:             string;
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return iso; }
}

// ─── Metric pill ──────────────────────────────────────────────────────────────

function Metric({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.05rem' }}>
      <span style={{ fontSize: '0.6rem', color: 'rgba(248,250,252,0.3)', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ fontSize: '0.8rem', fontWeight: 700, color: color ?? '#f8fafc' }}>{value}</span>
    </div>
  );
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function CopyTradingStatusPanel() {
  const [pause,    setPause]    = useState<PauseStatus | null>(null);
  const [paper,    setPaper]    = useState<PaperStatus | null>(null);
  const [loading,  setLoading]  = useState(true);

  // Modal states — covers all four existing confirmation dialogs
  const [pauseModal,  setPauseModal]  = useState<'pause' | 'resume' | null>(null);
  const [paperModal,  setPaperModal]  = useState<'off' | 'on' | null>(null);
  const [applying,    setApplying]    = useState(false);
  const [applyErr,    setApplyErr]    = useState<string | null>(null);
  const [flashMsg,    setFlashMsg]    = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [pauseRes, paperRes] = await Promise.all([
        fetch('/api/copy/bots/pause',    { cache: 'no-store' }),
        fetch('/api/copy/bots/paper-off', { cache: 'no-store' }),
      ]);
      const p = await pauseRes.json() as PauseStatus;
      const q = await paperRes.json() as PaperStatus;
      if (p.ok) setPause(p);
      if (q.ok) setPaper(q);
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Pause / resume copy entries ──────────────────────────────────────────────
  const applyPause = async (action: 'pause' | 'resume') => {
    setApplying(true); setApplyErr(null);
    try {
      const res  = await fetch('/api/copy/bots/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
        cache: 'no-store',
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (data.ok) {
        setPauseModal(null);
        setFlashMsg(action === 'resume' ? '✓ Copy entries resumed' : '✓ Copy entries paused');
        setTimeout(() => setFlashMsg(null), 4000);
        await load();
      } else { setApplyErr(data.error ?? 'Action failed'); }
    } catch { setApplyErr('Network error'); }
    finally { setApplying(false); }
  };

  // ── Turn paper bots on / off ─────────────────────────────────────────────────
  const applyPaper = async (action: 'off' | 'on') => {
    setApplying(true); setApplyErr(null);
    try {
      const res  = await fetch('/api/copy/bots/paper-off', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
        cache: 'no-store',
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (data.ok) {
        setPaperModal(null);
        setFlashMsg(action === 'on' ? '✓ Paper bots restored' : '✓ Paper bots turned off');
        setTimeout(() => setFlashMsg(null), 4000);
        await load();
      } else { setApplyErr(data.error ?? 'Action failed'); }
    } catch { setApplyErr('Network error'); }
    finally { setApplying(false); }
  };

  if (loading) return null;

  // ── Computed display values ───────────────────────────────────────────────────
  const isPaused     = pause?.paused       ?? false;
  const isPaperOff   = paper?.paper_off    ?? false;
  const enabledBots  = pause?.enabled_bots ?? 0;
  const newEntries   = pause?.active_bots  ?? 0;
  const openPos      = pause?.open_positions ?? 0;
  const resumeCount  = pause?.active_before_pause?.length ?? 0;
  const restoreCount = paper?.prev_enabled_count ?? 0;
  const paperBots    = paper?.enabled_paper_bots ?? 0;

  const copyStatus      = isPaused ? 'EXIT MONITOR ONLY' : 'ACTIVE';
  const copyStatusColor = isPaused ? '#fbbf24' : '#34d399';
  const panelBorder     = isPaused ? 'rgba(234,179,8,0.2)' : 'rgba(255,255,255,0.06)';

  return (
    <>
      {/* ── Compact status panel ─────────────────────────────────────────────── */}
      <div style={{
        margin: '0.75rem 0 0',
        padding: '0.6rem 1rem',
        background: 'rgba(15,17,26,0.75)',
        border: `1px solid ${panelBorder}`,
        borderRadius: '0.65rem',
        display: 'flex',
        alignItems: 'center',
        gap: '1rem',
        flexWrap: 'wrap',
      }}>

        {/* Left: title + status badge */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', flexShrink: 0 }}>
          <span style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'rgba(248,250,252,0.32)' }}>
            Copy Trading
          </span>
          <span style={{
            fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.04em',
            color: copyStatusColor,
          }}>
            {copyStatus}
          </span>
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 32, background: 'rgba(255,255,255,0.08)', flexShrink: 0 }} />

        {/* Metrics */}
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <Metric label="Enabled Bots"  value={enabledBots} />
          <Metric label="New Entries"   value={newEntries}  color={isPaused ? '#fbbf24' : '#34d399'} />
          <Metric label="Open Positions" value={openPos} />
          <Metric
            label="Paper Bots"
            value={isPaperOff ? 'OFF' : `${paperBots} on`}
            color={isPaperOff ? '#f87171' : '#34d399'}
          />
        </div>

        {/* Right: flash message + primary action */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          {flashMsg && (
            <span style={{ fontSize: '0.68rem', color: '#34d399' }}>{flashMsg}</span>
          )}

          {/* Secondary: paper restore (subtle, only when paper is off and has restore data) */}
          {isPaperOff && restoreCount > 0 && (
            <button
              className="copy-btn copy-btn-secondary copy-btn-sm"
              style={{ fontSize: '0.65rem' }}
              onClick={() => { setApplyErr(null); setPaperModal('on'); }}
            >
              Restore Paper Bots
            </button>
          )}

          {/* Primary: resume / pause copy entries */}
          {isPaused ? (
            <button
              className="copy-btn copy-btn-primary copy-btn-sm"
              onClick={() => { setApplyErr(null); setPauseModal('resume'); }}
            >
              Resume Copy Entries
            </button>
          ) : (
            <button
              className="copy-btn copy-btn-secondary copy-btn-sm"
              style={{ borderColor: 'rgba(234,179,8,0.3)', color: '#fbbf24' }}
              onClick={() => { setApplyErr(null); setPauseModal('pause'); }}
            >
              ⏸ Pause Copy Entries
            </button>
          )}
        </div>
      </div>

      {/* Subtext */}
      {isPaused && (
        <p style={{ margin: '0.3rem 0 0 0.2rem', fontSize: '0.65rem', color: 'rgba(248,250,252,0.28)' }}>
          New entries are paused. Existing positions will continue to close or settle.
        </p>
      )}

      {/* ── Modals ─────────────────────────────────────────────────────────────── */}

      {/* Pause modal */}
      {pauseModal === 'pause' && (
        <div className="copy-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !applying) setPauseModal(null); }}>
          <div className="copy-modal" role="dialog" aria-modal="true" style={{ maxWidth: 440 }}>
            <div className="copy-modal-header">
              <h3 className="copy-modal-title">Pause All New Copy-Trading Entries?</h3>
              <button className="copy-modal-close" onClick={() => setPauseModal(null)} disabled={applying}>×</button>
            </div>
            <div className="copy-modal-body">
              {[
                ['Active copy bots affected', `${newEntries}`],
                ['Current open positions',    `${openPos}`],
                ['New entries will stop',     'Yes'],
                ['Exit monitoring',           'Remains active'],
                ['Existing positions',        'Remain open'],
                ['LIVE / ARM LIVE',           'Unchanged'],
              ].map(([label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', padding: '0.2rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <span style={{ color: 'rgba(248,250,252,0.45)' }}>{label}</span>
                  <span style={{ fontWeight: 600 }}>{value}</span>
                </div>
              ))}
              {applyErr && <div style={{ fontSize: '0.75rem', color: '#f87171', marginTop: '0.5rem' }}>✗ {applyErr}</div>}
            </div>
            <div className="copy-modal-footer">
              <button className="copy-btn copy-btn-secondary" onClick={() => setPauseModal(null)} disabled={applying}>Cancel</button>
              <button className="copy-btn copy-btn-primary" onClick={() => applyPause('pause')} disabled={applying}
                style={{ background: 'rgba(234,179,8,0.15)', borderColor: 'rgba(234,179,8,0.4)', color: '#fbbf24' }}>
                {applying ? 'Pausing…' : 'PAUSE NEW ENTRIES'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resume modal */}
      {pauseModal === 'resume' && (
        <div className="copy-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !applying) setPauseModal(null); }}>
          <div className="copy-modal" role="dialog" aria-modal="true" style={{ maxWidth: 440 }}>
            <div className="copy-modal-header">
              <h3 className="copy-modal-title">Resume New Copy-Trading Entries?</h3>
              <button className="copy-modal-close" onClick={() => setPauseModal(null)} disabled={applying}>×</button>
            </div>
            <div className="copy-modal-body">
              <p style={{ fontSize: '0.8rem', color: 'rgba(248,250,252,0.65)', marginBottom: '1rem' }}>
                New entries will be restored for <strong style={{ color: '#f8fafc' }}>{resumeCount} previously active bot{resumeCount !== 1 ? 's' : ''}</strong>.
                Bots that were already off before the pause will remain off.
              </p>
              {[
                ['Bots to restore', `${resumeCount}`],
                ['Paused since',    fmtTime(pause?.paused_at ?? null)],
                ['Exit monitoring', 'Remains active'],
              ].map(([label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', padding: '0.2rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <span style={{ color: 'rgba(248,250,252,0.45)' }}>{label}</span>
                  <span style={{ fontWeight: 600 }}>{value}</span>
                </div>
              ))}
              {applyErr && <div style={{ fontSize: '0.75rem', color: '#f87171', marginTop: '0.5rem' }}>✗ {applyErr}</div>}
            </div>
            <div className="copy-modal-footer">
              <button className="copy-btn copy-btn-secondary" onClick={() => setPauseModal(null)} disabled={applying}>Cancel</button>
              <button className="copy-btn copy-btn-primary" onClick={() => applyPause('resume')} disabled={applying}>
                {applying ? 'Resuming…' : 'RESUME COPY ENTRIES'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Paper off modal */}
      {paperModal === 'off' && (
        <div className="copy-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !applying) setPaperModal(null); }}>
          <div className="copy-modal" role="dialog" aria-modal="true" style={{ maxWidth: 440 }}>
            <div className="copy-modal-header">
              <h3 className="copy-modal-title">Turn Off All PAPER Copy Bots?</h3>
              <button className="copy-modal-close" onClick={() => setPaperModal(null)} disabled={applying}>×</button>
            </div>
            <div className="copy-modal-body">
              <p style={{ fontSize: '0.8rem', color: 'rgba(248,250,252,0.65)', marginBottom: '1rem' }}>
                This stops all new paper copy trading. Previously-enabled bots are saved so they can be restored later.
              </p>
              {[
                ['Paper bots to disable', `${paperBots}`],
                ['LIVE bots affected',    '0 — unchanged'],
                ['Live execution',        'Unchanged'],
                ['Historical records',    'Preserved'],
              ].map(([label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', padding: '0.2rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <span style={{ color: 'rgba(248,250,252,0.45)' }}>{label}</span>
                  <span style={{ fontWeight: 600 }}>{value}</span>
                </div>
              ))}
              {applyErr && <div style={{ fontSize: '0.75rem', color: '#f87171', marginTop: '0.5rem' }}>✗ {applyErr}</div>}
            </div>
            <div className="copy-modal-footer">
              <button className="copy-btn copy-btn-secondary" onClick={() => setPaperModal(null)} disabled={applying}>Cancel</button>
              <button className="copy-btn copy-btn-primary" onClick={() => applyPaper('off')} disabled={applying}
                style={{ background: 'rgba(239,68,68,0.12)', borderColor: 'rgba(239,68,68,0.4)', color: '#f87171' }}>
                {applying ? 'Turning Off…' : 'TURN OFF PAPER BOTS'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Paper on modal */}
      {paperModal === 'on' && (
        <div className="copy-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !applying) setPaperModal(null); }}>
          <div className="copy-modal" role="dialog" aria-modal="true" style={{ maxWidth: 440 }}>
            <div className="copy-modal-header">
              <h3 className="copy-modal-title">Turn On Previous Paper Copy Bots?</h3>
              <button className="copy-modal-close" onClick={() => setPaperModal(null)} disabled={applying}>×</button>
            </div>
            <div className="copy-modal-body">
              <p style={{ fontSize: '0.8rem', color: 'rgba(248,250,252,0.65)', marginBottom: '1rem' }}>
                Restores only the <strong style={{ color: '#f8fafc' }}>{restoreCount} bot{restoreCount !== 1 ? 's' : ''}</strong> that were active before the last turn-off.
              </p>
              {[
                ['Bots to restore',    `${restoreCount}`],
                ['Turned off at',      fmtTime(paper?.turned_off_at ?? null)],
                ['LIVE bots affected', '0 — unchanged'],
              ].map(([label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', padding: '0.2rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <span style={{ color: 'rgba(248,250,252,0.45)' }}>{label}</span>
                  <span style={{ fontWeight: 600 }}>{value}</span>
                </div>
              ))}
              {applyErr && <div style={{ fontSize: '0.75rem', color: '#f87171', marginTop: '0.5rem' }}>✗ {applyErr}</div>}
            </div>
            <div className="copy-modal-footer">
              <button className="copy-btn copy-btn-secondary" onClick={() => setPaperModal(null)} disabled={applying}>Cancel</button>
              <button className="copy-btn copy-btn-primary" onClick={() => applyPaper('on')} disabled={applying}>
                {applying ? 'Restoring…' : 'TURN ON PREVIOUS PAPER BOTS'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
