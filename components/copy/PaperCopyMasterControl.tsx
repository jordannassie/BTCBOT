'use client';

// PaperCopyMasterControl — Master on/off for all PAPER copy bots.
//
// TURN OFF: sets is_enabled=false, opens_only=true, arm_live=false for every
//           mode=PAPER bot. Saves previously-enabled IDs for restore.
//
// TURN ON:  restores is_enabled=true, opens_only=false ONLY for bots that
//           were enabled before the last turn-off.
//
// LIVE bots are never touched.

import { useCallback, useEffect, useState } from 'react';

// ─── Types ─────────────────────────────────────────────────────────────────────

type PaperOffStatus = {
  paper_off:          boolean;
  turned_off_at:      string | null;
  prev_enabled_count: number;
  total_paper_bots:   number;
  enabled_paper_bots: number;
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return iso; }
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function PaperCopyMasterControl() {
  const [status,   setStatus]   = useState<PaperOffStatus | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [modal,    setModal]    = useState<'off' | 'on' | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyErr, setApplyErr] = useState<string | null>(null);
  const [done,     setDone]     = useState<'off' | 'on' | null>(null);

  const load = useCallback(async () => {
    try {
      const res  = await fetch('/api/copy/bots/paper-off', { cache: 'no-store' });
      const data = await res.json() as PaperOffStatus & { ok: boolean; error?: string };
      if (data.ok) { setStatus(data); }
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleApply = async (action: 'off' | 'on') => {
    setApplying(true);
    setApplyErr(null);
    try {
      const res  = await fetch('/api/copy/bots/paper-off', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
        cache: 'no-store',
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (data.ok) {
        setModal(null);
        setDone(action);
        await load();
        setTimeout(() => setDone(null), 5000);
      } else {
        setApplyErr(data.error ?? 'Action failed');
      }
    } catch { setApplyErr('Network error'); }
    finally { setApplying(false); }
  };

  if (loading) return null;
  if (!status) return null;

  const isOff          = status.paper_off;
  const enabledCount   = status.enabled_paper_bots;
  const totalPaper     = status.total_paper_bots;
  const restoreCount   = status.prev_enabled_count;

  return (
    <>
      {/* ── OFF banner ── */}
      {isOff && (
        <div style={{
          background: 'rgba(239,68,68,0.07)',
          border: '1px solid rgba(239,68,68,0.25)',
          borderRadius: '0.6rem',
          padding: '0.65rem 1.25rem',
          margin: '0.5rem 0 0',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem',
        }}>
          <div>
            <span style={{ fontWeight: 700, color: '#f87171', fontSize: '0.82rem', letterSpacing: '0.04em' }}>
              PAPER COPY TRADING OFF
            </span>
            <span style={{ marginLeft: '0.75rem', fontSize: '0.72rem', color: 'rgba(248,250,252,0.45)' }}>
              0 active paper copy bots · Turned off {fmtTime(status.turned_off_at)}
            </span>
          </div>
          {restoreCount > 0 && (
            <button
              className="copy-btn copy-btn-primary copy-btn-sm"
              onClick={() => { setApplyErr(null); setModal('on'); }}
            >
              Turn On Previous Paper Bots
            </button>
          )}
        </div>
      )}

      {/* ── Main control row ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '1rem',
        padding: '0.65rem 1.25rem',
        background: 'rgba(15,17,26,0.7)',
        border: `1px solid ${isOff ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.06)'}`,
        borderRadius: '0.6rem',
        margin: '0.5rem 0 0',
        flexWrap: 'wrap',
      }}>
        {/* Label + status */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
          <span style={{ fontSize: '0.7rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(248,250,252,0.35)', fontWeight: 700 }}>
            Paper Copy Trading
          </span>
          <span style={{
            fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.04em',
            color: isOff ? '#f87171' : '#34d399',
          }}>
            {isOff ? 'OFF' : `ACTIVE — ${enabledCount} bot${enabledCount !== 1 ? 's' : ''}`}
          </span>
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: '1.25rem', marginLeft: '0.5rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.1rem' }}>
            <span style={{ fontSize: '0.68rem', color: 'rgba(248,250,252,0.3)' }}>Total paper bots</span>
            <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>{totalPaper}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.1rem' }}>
            <span style={{ fontSize: '0.68rem', color: 'rgba(248,250,252,0.3)' }}>Active</span>
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: isOff ? '#f87171' : '#34d399' }}>
              {enabledCount}
            </span>
          </div>
        </div>

        {/* Done flash */}
        {done === 'off' && (
          <span style={{ fontSize: '0.72rem', color: '#f87171', marginLeft: '0.5rem' }}>
            ✓ All paper bots turned off
          </span>
        )}
        {done === 'on' && (
          <span style={{ fontSize: '0.72rem', color: '#34d399', marginLeft: '0.5rem' }}>
            ✓ Previous paper bots restored
          </span>
        )}

        {/* Action button */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {!isOff ? (
            <button
              className="copy-btn copy-btn-secondary copy-btn-sm"
              onClick={() => { setApplyErr(null); setModal('off'); }}
              style={{ borderColor: 'rgba(239,68,68,0.4)', color: '#f87171' }}
            >
              ⏹ Turn Off All Paper Bots
            </button>
          ) : (
            restoreCount > 0
              ? <button
                  className="copy-btn copy-btn-primary copy-btn-sm"
                  onClick={() => { setApplyErr(null); setModal('on'); }}
                >
                  ▶ Turn On Previous Paper Bots
                </button>
              : <span style={{ fontSize: '0.7rem', color: 'rgba(248,250,252,0.3)' }}>
                  No restore data — use Discover Traders to add bots
                </span>
          )}
        </div>
      </div>

      {/* ── Confirmation modal: TURN OFF ── */}
      {modal === 'off' && (
        <div className="copy-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !applying) setModal(null); }}>
          <div className="copy-modal" role="dialog" aria-modal="true" style={{ maxWidth: 440 }}>
            <div className="copy-modal-header">
              <h3 className="copy-modal-title">Turn Off All PAPER Copy Bots?</h3>
              <button className="copy-modal-close" onClick={() => setModal(null)} disabled={applying}>×</button>
            </div>
            <div className="copy-modal-body">
              <p style={{ fontSize: '0.8rem', color: 'rgba(248,250,252,0.65)', marginBottom: '1rem' }}>
                This stops all new paper copy trading. Previously-enabled bots are saved so they can be restored later.
              </p>
              {[
                ['Paper bots to disable',  `${enabledCount}`],
                ['LIVE bots affected',     '0 — unchanged'],
                ['Live execution',         'Unchanged'],
                ['Historical records',     'Preserved'],
                ['Wallets',                'Unchanged'],
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
              <button
                className="copy-btn copy-btn-primary"
                onClick={() => handleApply('off')}
                disabled={applying}
                style={{ background: 'rgba(239,68,68,0.12)', borderColor: 'rgba(239,68,68,0.4)', color: '#f87171' }}
              >
                {applying ? 'Turning Off…' : 'TURN OFF PAPER BOTS'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirmation modal: TURN ON ── */}
      {modal === 'on' && (
        <div className="copy-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !applying) setModal(null); }}>
          <div className="copy-modal" role="dialog" aria-modal="true" style={{ maxWidth: 440 }}>
            <div className="copy-modal-header">
              <h3 className="copy-modal-title">Turn On Previous Paper Copy Bots?</h3>
              <button className="copy-modal-close" onClick={() => setModal(null)} disabled={applying}>×</button>
            </div>
            <div className="copy-modal-body">
              <p style={{ fontSize: '0.8rem', color: 'rgba(248,250,252,0.65)', marginBottom: '1rem' }}>
                Restores only the <strong style={{ color: '#f8fafc' }}>{restoreCount} bot{restoreCount !== 1 ? 's' : ''}</strong> that were active before the last turn-off. Bots added since then are unaffected.
              </p>
              {[
                ['Bots to restore',    `${restoreCount}`],
                ['Turned off at',      fmtTime(status.turned_off_at)],
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
              <button className="copy-btn copy-btn-secondary" onClick={() => setModal(null)} disabled={applying}>Cancel</button>
              <button className="copy-btn copy-btn-primary" onClick={() => handleApply('on')} disabled={applying}>
                {applying ? 'Restoring…' : 'TURN ON PREVIOUS PAPER BOTS'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
