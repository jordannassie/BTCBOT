'use client';

// CopyPauseControl — Master copy-trading entry pause control.
//
// Shows current status (ACTIVE / EXIT MONITOR ONLY), a pause/resume button,
// and a persistent banner while paused.
//
// Pause does NOT disable exit monitoring or close any positions.
// Resume restores only the bots that had New Entries ON before the pause.

import { useCallback, useEffect, useState } from 'react';

// ─── Types ─────────────────────────────────────────────────────────────────────

type PauseStatus = {
  paused:              boolean;
  paused_at:           string | null;
  active_before_pause: string[];
  enabled_bots:        number;
  active_bots:         number;
  open_positions:      number;
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function CopyPauseControl() {
  const [status,   setStatus]   = useState<PauseStatus | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [modal,    setModal]    = useState<'pause' | 'resume' | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyErr, setApplyErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/copy/bots/pause', { cache: 'no-store' });
      const payload = await res.json() as PauseStatus & { ok: boolean; error?: string };
      if (payload.ok) { setStatus(payload); setError(null); }
      else setError(payload.error ?? 'Failed to load pause status');
    } catch { setError('Network error'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleApply = async (action: 'pause' | 'resume') => {
    setApplying(true);
    setApplyErr(null);
    try {
      const res = await fetch('/api/copy/bots/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
        cache: 'no-store',
      });
      const payload = await res.json() as { ok: boolean; error?: string };
      if (payload.ok) {
        setModal(null);
        await load();
      } else {
        setApplyErr(payload.error ?? 'Action failed');
      }
    } catch { setApplyErr('Network error'); }
    finally { setApplying(false); }
  };

  if (loading) return null;
  if (!status) return null;

  const isPaused    = status.paused;
  const activeCount = status.active_bots;
  const resumeCount = status.active_before_pause.length;

  return (
    <>
      {/* ── Persistent paused banner ── */}
      {isPaused && (
        <div style={{
          background: 'rgba(234,179,8,0.07)',
          border: '1px solid rgba(234,179,8,0.3)',
          borderRadius: '0.6rem',
          padding: '0.65rem 1.25rem',
          margin: '0.75rem 0 0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.5rem',
        }}>
          <div>
            <span style={{ fontWeight: 700, color: '#fbbf24', fontSize: '0.82rem', letterSpacing: '0.04em' }}>
              COPY TRADING — EXIT MONITOR ONLY
            </span>
            <span style={{ marginLeft: '0.75rem', fontSize: '0.72rem', color: 'rgba(248,250,252,0.5)' }}>
              New entries paused since {fmtTime(status.paused_at)} · Exit monitoring remains active · {status.open_positions} open position{status.open_positions !== 1 ? 's' : ''} will close naturally
            </span>
          </div>
          <button
            className="copy-btn copy-btn-secondary copy-btn-sm"
            onClick={() => { setApplyErr(null); setModal('resume'); }}
            style={{ flexShrink: 0 }}
          >
            Resume Copy Entries
          </button>
        </div>
      )}

      {/* ── Main control row ── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '1rem',
        padding: '0.65rem 1.25rem',
        background: 'rgba(15,17,26,0.7)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: '0.6rem',
        margin: '0.75rem 0 0',
        flexWrap: 'wrap',
      }}>
        {/* Label */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
          <span style={{ fontSize: '0.7rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(248,250,252,0.35)', fontWeight: 700 }}>
            Copy Trading
          </span>
          <span style={{
            fontSize: '0.78rem',
            fontWeight: 700,
            color: isPaused ? '#fbbf24' : '#34d399',
            letterSpacing: '0.04em',
          }}>
            {isPaused ? 'EXIT MONITOR ONLY' : 'ACTIVE'}
          </span>
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: '1.25rem', marginLeft: '0.5rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.1rem' }}>
            <span style={{ fontSize: '0.68rem', color: 'rgba(248,250,252,0.3)' }}>Enabled bots</span>
            <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>{status.enabled_bots}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.1rem' }}>
            <span style={{ fontSize: '0.68rem', color: 'rgba(248,250,252,0.3)' }}>New entries ON</span>
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: isPaused ? '#fbbf24' : '#34d399' }}>{activeCount}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.1rem' }}>
            <span style={{ fontSize: '0.68rem', color: 'rgba(248,250,252,0.3)' }}>Open positions</span>
            <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>{status.open_positions}</span>
          </div>
        </div>

        {/* Action button */}
        <div style={{ marginLeft: 'auto' }}>
          {error && <span style={{ fontSize: '0.7rem', color: '#f87171', marginRight: '0.75rem' }}>⚠ {error}</span>}
          {!isPaused ? (
            <button
              className="copy-btn copy-btn-secondary copy-btn-sm"
              onClick={() => { setApplyErr(null); setModal('pause'); }}
              style={{ borderColor: 'rgba(234,179,8,0.35)', color: '#fbbf24' }}
            >
              ⏸ Pause All Copy Entries
            </button>
          ) : (
            <button
              className="copy-btn copy-btn-primary copy-btn-sm"
              onClick={() => { setApplyErr(null); setModal('resume'); }}
            >
              ▶ Resume Copy Entries
            </button>
          )}
        </div>
      </div>

      {/* ── Pause confirmation modal ── */}
      {modal === 'pause' && (
        <div className="copy-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !applying) setModal(null); }}>
          <div className="copy-modal" role="dialog" aria-modal="true" style={{ maxWidth: 440 }}>
            <div className="copy-modal-header">
              <h3 className="copy-modal-title">Pause All New Copy-Trading Entries?</h3>
              <button className="copy-modal-close" onClick={() => setModal(null)} disabled={applying}>×</button>
            </div>
            <div className="copy-modal-body">
              <div style={{ marginBottom: '1rem' }}>
                {[
                  [`Active copy bots affected`, `${activeCount}`],
                  [`Current open positions`,     `${status.open_positions}`],
                  [`New entries will stop`,       'Yes'],
                  [`Exit monitoring will remain`, 'Active'],
                  [`Existing positions`,          'Remain open'],
                  [`LIVE / ARM LIVE`,             'Unchanged'],
                ].map(([label, value]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', padding: '0.2rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <span style={{ color: 'rgba(248,250,252,0.45)' }}>{label}</span>
                    <span style={{ fontWeight: 600 }}>{value}</span>
                  </div>
                ))}
              </div>
              {applyErr && <div style={{ fontSize: '0.75rem', color: '#f87171' }}>✗ {applyErr}</div>}
            </div>
            <div className="copy-modal-footer">
              <button className="copy-btn copy-btn-secondary" onClick={() => setModal(null)} disabled={applying}>Cancel</button>
              <button
                className="copy-btn copy-btn-primary"
                onClick={() => handleApply('pause')}
                disabled={applying}
                style={{ background: 'rgba(234,179,8,0.15)', borderColor: 'rgba(234,179,8,0.4)', color: '#fbbf24' }}
              >
                {applying ? 'Pausing…' : 'PAUSE NEW ENTRIES'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Resume confirmation modal ── */}
      {modal === 'resume' && (
        <div className="copy-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !applying) setModal(null); }}>
          <div className="copy-modal" role="dialog" aria-modal="true" style={{ maxWidth: 440 }}>
            <div className="copy-modal-header">
              <h3 className="copy-modal-title">Resume New Copy-Trading Entries?</h3>
              <button className="copy-modal-close" onClick={() => setModal(null)} disabled={applying}>×</button>
            </div>
            <div className="copy-modal-body">
              <p style={{ fontSize: '0.8rem', color: 'rgba(248,250,252,0.65)', marginBottom: '1rem' }}>
                New entries will be restored for <strong style={{ color: '#f8fafc' }}>{resumeCount} previously active bot{resumeCount !== 1 ? 's' : ''}</strong>.
                Bots that were already off before the pause will remain off.
              </p>
              {[
                [`Bots to restore`, `${resumeCount}`],
                [`Paused since`,    fmtTime(status.paused_at)],
                [`Exit monitoring`, 'Remains active'],
              ].map(([label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', padding: '0.2rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <span style={{ color: 'rgba(248,250,252,0.45)' }}>{label}</span>
                  <span style={{ fontWeight: 600 }}>{value}</span>
                </div>
              ))}
              {applyErr && <div style={{ fontSize: '0.75rem', color: '#f87171', marginTop: '0.5rem' }}>✗ {applyErr}</div>}
            </div>
            <div className="copy-modal-footer">
              <button className="copy-btn copy-btn-secondary" onClick={() => setModal(null)} disabled={applying}>Cancel</button>
              <button className="copy-btn copy-btn-primary" onClick={() => handleApply('resume')} disabled={applying}>
                {applying ? 'Resuming…' : 'RESUME COPY ENTRIES'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
