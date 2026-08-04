'use client';

// CryptoTradeSizeControl — shared trade-size display + edit widget.
//
// Used in both the compact CryptoBotCard header AND the expanded CryptoBotDetails.
// Implemented once; only the `compact` flag changes the visual density.
//
// Display mode: shows saved value with a clickable amount or Edit button.
// Edit mode:    shows a numeric input with Save + Cancel controls.
//
// API routes used (same as CryptoBotDetails inline save, now unified):
//   POST /api/btc-5m-late          { trade_size_usd }         — BTC
//   POST /api/crypto-5m            { bot_id, trade_size_usd } — ETH/SOL/XRP
//
// is_enabled is NEVER sent — the API now accepts trade-size-only requests.
//
// Keyboard support: Enter → save, Escape → cancel.
//
// Props:
//   botId       — 'btc_5m_late' | 'eth_5m_paper' | 'sol_5m_paper' | 'xrp_5m_paper'
//   isBtc       — true → POST /api/btc-5m-late, false → POST /api/crypto-5m
//   savedSize   — current backend value (drives display)
//   accentColor — per-asset color for the value + save button
//   onSaved     — called with new size on success; parent should trigger reload
//   compact     — true = header-inline style (tight), false = section style (spacious)

import { useCallback, useEffect, useRef, useState } from 'react';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtUsd(v: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2,
  }).format(v);
}

function validate(raw: string): { ok: boolean; size: number; err: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, size: 0, err: 'Enter an amount' };
  const size = parseFloat(trimmed);
  if (!Number.isFinite(size))  return { ok: false, size: 0, err: 'Must be a number' };
  if (size <= 0)                return { ok: false, size: 0, err: 'Must be greater than $0' };
  if (size > 1_000_000)         return { ok: false, size: 0, err: 'Max $1,000,000' };
  // Round to 2 decimal places silently
  const rounded = Math.round(size * 100) / 100;
  return { ok: true, size: rounded, err: '' };
}

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  botId:       string;
  isBtc:       boolean;
  savedSize:   number;
  accentColor: string;
  onSaved:     (newSize: number) => void;
  compact?:    boolean;
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function CryptoTradeSizeControl({
  botId, isBtc, savedSize, accentColor, onSaved, compact = false,
}: Props) {
  const [editing,   setEditing]   = useState(false);
  const [inputVal,  setInputVal]  = useState('');
  const [saving,    setSaving]    = useState(false);
  const [savedMsg,  setSavedMsg]  = useState<string | null>(null);
  const [errorMsg,  setErrorMsg]  = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when entering edit mode
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const startEdit = useCallback(() => {
    setInputVal(savedSize.toFixed(2));
    setErrorMsg(null);
    setSavedMsg(null);
    setEditing(true);
  }, [savedSize]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setErrorMsg(null);
  }, []);

  const doSave = useCallback(async () => {
    const { ok, size, err } = validate(inputVal);
    if (!ok) { setErrorMsg(err); return; }

    setSaving(true);
    setErrorMsg(null);
    setSavedMsg(null);
    try {
      let res: Response;
      if (isBtc) {
        res = await fetch('/api/btc-5m-late', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ trade_size_usd: size }),
          cache:   'no-store',
        });
      } else {
        res = await fetch('/api/crypto-5m', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ bot_id: botId, trade_size_usd: size }),
          cache:   'no-store',
        });
      }
      const json = await res.json() as { ok: boolean; error?: string };
      if (json.ok) {
        setEditing(false);
        setSavedMsg(`Trade size saved: ${fmtUsd(size)}`);
        setTimeout(() => setSavedMsg(null), 4000);
        onSaved(size);
      } else {
        setErrorMsg(json.error ?? 'Save failed');
      }
    } catch {
      setErrorMsg('Network error');
    } finally {
      setSaving(false);
    }
  }, [inputVal, isBtc, botId, onSaved]);

  const handleKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter')  { e.preventDefault(); doSave(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
  }, [doSave, cancelEdit]);

  // ── Compact (card header) layout ──────────────────────────────────────────
  if (compact) {
    return (
      <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 80 }}>
        {/* Label */}
        <div style={{
          fontSize: '0.55rem', fontWeight: 700, letterSpacing: '0.08em',
          textTransform: 'uppercase', color: 'rgba(248,250,252,0.3)',
          marginBottom: '0.2rem',
        }}>
          Trade Size
        </div>

        {editing ? (
          /* ── Edit mode (compact) ── */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
              <span style={{ fontSize: '0.72rem', color: 'rgba(248,250,252,0.4)', fontFamily: 'monospace' }}>$</span>
              <input
                ref={inputRef}
                type="number"
                value={inputVal}
                onChange={(e) => { setInputVal(e.target.value); setErrorMsg(null); }}
                onKeyDown={handleKey}
                step="0.01" min="0.01" max="1000000"
                disabled={saving}
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: 64, padding: '0.2rem 0.35rem',
                  background: 'rgba(255,255,255,0.08)',
                  border: `1px solid ${errorMsg ? 'rgba(248,113,113,0.6)' : `${accentColor}50`}`,
                  borderRadius: '0.3rem', color: '#f8fafc',
                  fontSize: '0.72rem', fontFamily: 'monospace', outline: 'none',
                  textAlign: 'right',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: '0.25rem' }}>
              <button
                onClick={(e) => { e.stopPropagation(); doSave(); }}
                disabled={saving}
                style={{
                  padding: '0.15rem 0.45rem', borderRadius: '0.3rem',
                  fontSize: '0.6rem', fontWeight: 700, cursor: saving ? 'wait' : 'pointer',
                  background: `${accentColor}20`, border: `1px solid ${accentColor}50`,
                  color: accentColor,
                }}
              >
                {saving ? '…' : 'Save'}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); cancelEdit(); }}
                disabled={saving}
                style={{
                  padding: '0.15rem 0.35rem', borderRadius: '0.3rem',
                  fontSize: '0.6rem', cursor: 'pointer',
                  background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
                  color: 'rgba(248,250,252,0.35)',
                }}
              >
                ×
              </button>
            </div>
            {errorMsg && (
              <div style={{ fontSize: '0.57rem', color: '#f87171', textAlign: 'right', maxWidth: 100 }}>
                {errorMsg}
              </div>
            )}
          </div>
        ) : (
          /* ── Display mode (compact) ── */
          <div>
            <button
              onClick={(e) => { e.stopPropagation(); startEdit(); }}
              title="Click to change trade size"
              style={{
                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                textAlign: 'right', display: 'block', width: '100%',
              }}
            >
              <div style={{
                fontSize: '1.05rem', fontWeight: 800, fontFamily: 'monospace',
                color: accentColor, letterSpacing: '-0.01em',
                lineHeight: 1.1,
              }}>
                {fmtUsd(savedSize)}
              </div>
              <div style={{ fontSize: '0.55rem', color: 'rgba(248,250,252,0.25)', marginTop: '0.1rem' }}>
                tap to edit
              </div>
            </button>
            {savedMsg && (
              <div style={{ fontSize: '0.55rem', color: '#34d399', marginTop: '0.1rem', textAlign: 'right' }}>
                ✓ Saved
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Full (details panel) layout ───────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      <div style={{
        fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.06em',
        textTransform: 'uppercase', color: 'rgba(248,250,252,0.3)',
      }}>
        Trade Settings
      </div>

      {editing ? (
        /* ── Edit mode (full) ── */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.88rem', color: 'rgba(248,250,252,0.4)', fontFamily: 'monospace' }}>$</span>
            <input
              ref={inputRef}
              type="number"
              value={inputVal}
              onChange={(e) => { setInputVal(e.target.value); setErrorMsg(null); }}
              onKeyDown={handleKey}
              step="0.01" min="0.01" max="1000000"
              disabled={saving}
              style={{
                flex: '1 1 120px', maxWidth: 180,
                padding: '0.4rem 0.6rem',
                background: 'rgba(255,255,255,0.06)',
                border: `1px solid ${errorMsg ? 'rgba(248,113,113,0.5)' : 'rgba(255,255,255,0.12)'}`,
                borderRadius: '0.4rem', color: '#f8fafc',
                fontSize: '0.9rem', fontFamily: 'monospace', outline: 'none',
              }}
            />
            <button
              onClick={doSave}
              disabled={saving}
              style={{
                padding: '0.4rem 0.9rem', borderRadius: '0.4rem',
                fontSize: '0.75rem', fontWeight: 700,
                cursor: saving ? 'wait' : 'pointer',
                background: `${accentColor}15`, border: `1px solid ${accentColor}40`,
                color: accentColor,
              }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={cancelEdit}
              disabled={saving}
              style={{
                padding: '0.4rem 0.7rem', borderRadius: '0.4rem',
                fontSize: '0.72rem', cursor: 'pointer',
                background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
                color: 'rgba(248,250,252,0.4)',
              }}
            >
              Cancel
            </button>
          </div>
          {errorMsg && (
            <div style={{ fontSize: '0.7rem', color: '#f87171' }}>✗ {errorMsg}</div>
          )}
        </div>
      ) : (
        /* ── Display mode (full) ── */
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '0.7rem', color: 'rgba(248,250,252,0.35)', marginBottom: '0.15rem' }}>
              Saved trade size
            </div>
            <div style={{
              fontSize: '1.1rem', fontWeight: 800, fontFamily: 'monospace',
              color: accentColor, letterSpacing: '-0.01em',
            }}>
              {fmtUsd(savedSize)}
            </div>
          </div>
          <button
            onClick={startEdit}
            style={{
              padding: '0.35rem 0.85rem', borderRadius: '0.4rem',
              fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer',
              background: `${accentColor}10`, border: `1px solid ${accentColor}30`,
              color: accentColor, marginTop: '0.5rem',
            }}
          >
            Edit Size
          </button>
          {savedMsg && (
            <div style={{ fontSize: '0.7rem', color: '#34d399', fontWeight: 600 }}>
              ✓ {savedMsg}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
