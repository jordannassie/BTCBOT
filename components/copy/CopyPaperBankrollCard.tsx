'use client';

import { useCallback, useEffect, useState } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

type CardState = {
  balance: number;
  pnl: number;
  default_amount: number;
};

// ─── Formatters ───────────────────────────────────────────────────────────────

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const fmt = (v: number) => usd.format(v);

// ─── Component ────────────────────────────────────────────────────────────────

export default function CopyPaperBankrollCard() {
  const [state, setState] = useState<CardState | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Input for new default amount
  const [inputValue, setInputValue] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);

  // Action feedback
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch('/api/copy/paper-bankroll', { cache: 'no-store' });
      const payload = await res.json();
      if (payload.ok) {
        setState(payload);
        setInputValue(String(payload.default_amount));
      } else {
        setFetchError(payload.error ?? 'Failed to load paper bankroll');
      }
    } catch {
      setFetchError('Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const showFeedback = (text: string, type: 'success' | 'error') => {
    setFeedback({ text, type });
    setTimeout(() => setFeedback(null), 3500);
  };

  const handleSaveDefault = async () => {
    setInputError(null);
    const parsed = parseFloat(inputValue.replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setInputError('Enter a valid positive amount');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/copy/paper-bankroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_default', amount: parsed }),
        cache: 'no-store',
      });
      const payload = await res.json();
      if (payload.ok) {
        setState((prev) => prev ? { ...prev, default_amount: payload.default_amount } : prev);
        setInputValue(String(payload.default_amount));
        showFeedback(`Default saved: ${fmt(payload.default_amount)}`, 'success');
      } else {
        showFeedback(payload.error ?? 'Save failed', 'error');
      }
    } catch {
      showFeedback('Network error saving default', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setResetting(true);
    try {
      const res = await fetch('/api/copy/paper-bankroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset' }),
        cache: 'no-store',
      });
      const payload = await res.json();
      if (payload.ok) {
        setState((prev) =>
          prev ? { ...prev, balance: payload.balance, pnl: 0 } : prev
        );
        showFeedback(`Paper bankroll reset to ${fmt(payload.balance)}`, 'success');
      } else {
        showFeedback(payload.error ?? 'Reset failed', 'error');
      }
    } catch {
      showFeedback('Network error resetting bankroll', 'error');
    } finally {
      setResetting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="copy-paper-card copy-paper-card--loading">
        <div className="copy-paper-card-label">PAPER BANKROLL</div>
        <div className="copy-loading" style={{ padding: '1rem 0' }}>Loading…</div>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="copy-paper-card">
        <div className="copy-paper-card-label">PAPER BANKROLL</div>
        <p style={{ color: '#f87171', fontSize: '0.8rem', marginTop: '0.5rem' }}>{fetchError}</p>
      </div>
    );
  }

  const pnlColor = !state || state.pnl === 0
    ? 'rgba(248,250,252,0.45)'
    : state.pnl > 0 ? '#34d399' : '#f87171';

  return (
    <div className="copy-paper-card">
      {/* Header */}
      <div className="copy-paper-card-header">
        <div>
          <div className="copy-paper-card-label">PAPER BANKROLL</div>
          <div className="copy-paper-card-sublabel">Safe testing capital for copy bots</div>
        </div>
        <span className="copy-badge copy-badge-paper" style={{ alignSelf: 'flex-start' }}>PAPER</span>
      </div>

      {/* Balance */}
      <div className="copy-paper-balance">{fmt(state?.balance ?? 0)}</div>

      {/* P&L row */}
      <div className="copy-paper-pnl-row">
        <span className="copy-paper-pnl-label">All-time P/L</span>
        <span className="copy-paper-pnl-value" style={{ color: pnlColor }}>
          {state && state.pnl !== 0
            ? (state.pnl > 0 ? '+' : '') + fmt(state.pnl)
            : '—'}
        </span>
      </div>

      {/* Divider */}
      <div className="copy-paper-divider" />

      {/* Saved default display */}
      <div className="copy-paper-default-row">
        <span className="copy-paper-default-label">Saved Default</span>
        <span className="copy-paper-default-value">{fmt(state?.default_amount ?? 0)}</span>
      </div>

      {/* Set default input */}
      <div className="copy-paper-set-default">
        <label className="copy-paper-input-label">Set new default amount</label>
        <div className="copy-paper-input-row">
          <div className="copy-paper-input-wrap">
            <span className="copy-paper-input-prefix">$</span>
            <input
              className="copy-paper-input"
              type="number"
              min="1"
              step="any"
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                setInputError(null);
              }}
              placeholder="e.g. 1000"
            />
          </div>
          <button
            className="copy-btn copy-btn-sm copy-btn-secondary"
            onClick={handleSaveDefault}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save Default'}
          </button>
        </div>
        {inputError && <span className="copy-paper-hint-error">{inputError}</span>}
        <span className="copy-paper-hint">
          Reset to Default will restore the paper balance to this amount and zero the P/L.
        </span>
      </div>

      {/* Reset button */}
      <button
        className="copy-paper-reset-btn"
        onClick={handleReset}
        disabled={resetting}
      >
        {resetting
          ? 'Resetting…'
          : `Reset to Default (${fmt(state?.default_amount ?? 0)})`}
      </button>

      {/* Feedback */}
      {feedback && (
        <p className={`copy-paper-feedback ${feedback.type}`}>{feedback.text}</p>
      )}
    </div>
  );
}
