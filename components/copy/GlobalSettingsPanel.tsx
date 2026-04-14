'use client';

import { useCallback, useEffect, useState } from 'react';

type GlobalSettings = {
  id: number;
  live_on: boolean;
  emergency_stop: boolean;
  max_total_live_exposure: number;
  default_slippage_cap: number;
  default_position_size: number;
  default_max_positions: number;
  updated_at: string;
};

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export default function GlobalSettingsPanel() {
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [statusMsg, setStatusMsg] = useState('');

  // Editable numeric fields
  const [exposure, setExposure] = useState('');
  const [slippage, setSlippage] = useState('');
  const [posSize, setPosSize] = useState('');
  const [maxPos, setMaxPos] = useState('');

  const applySettings = useCallback((s: GlobalSettings) => {
    setSettings(s);
    setExposure(String(s.max_total_live_exposure));
    setSlippage(String(s.default_slippage_cap));
    setPosSize(String(s.default_position_size));
    setMaxPos(String(s.default_max_positions));
  }, []);

  useEffect(() => {
    fetch('/api/copy/settings', { cache: 'no-store' })
      .then((r) => r.json())
      .then((p) => { if (p.ok && p.settings) applySettings(p.settings); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [applySettings]);

  const patch = useCallback(async (updates: Record<string, unknown>) => {
    setStatus('saving');
    setStatusMsg('');
    try {
      const res = await fetch('/api/copy/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
        cache: 'no-store',
      });
      const payload = await res.json();
      if (!payload.ok) throw new Error(payload.error ?? 'Save failed');
      if (payload.settings) applySettings(payload.settings);
      setStatus('saved');
      setStatusMsg('Saved');
      setTimeout(() => { setStatus('idle'); setStatusMsg(''); }, 2000);
    } catch (err) {
      setStatus('error');
      setStatusMsg(err instanceof Error ? err.message : 'Save failed');
    }
  }, [applySettings]);

  const handleLiveToggle = (checked: boolean) => {
    patch({ live_on: checked });
  };

  const handleEmergencyStop = () => {
    if (!settings) return;
    const next = !settings.emergency_stop;
    if (next && !window.confirm('Enable emergency stop? This will halt all live copy-trading immediately.')) return;
    if (!next && !window.confirm('Clear emergency stop? Live trading will resume if enabled.')) return;
    patch({ emergency_stop: next });
  };

  const handleSaveNumeric = () => {
    patch({
      max_total_live_exposure: parseFloat(exposure) || 0,
      default_slippage_cap: parseFloat(slippage) || 0,
      default_position_size: parseFloat(posSize) || 0,
      default_max_positions: parseInt(maxPos, 10) || 0,
    });
  };

  if (loading) {
    return (
      <div className="copy-section">
        <p className="copy-section-title" style={{ marginBottom: 0 }}>Global Settings</p>
        <p style={{ fontSize: '0.82rem', color: 'rgba(255,255,255,0.4)', marginTop: '0.75rem' }}>Loading…</p>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="copy-section">
        <p className="copy-section-title" style={{ marginBottom: 0 }}>Global Settings</p>
        <p style={{ fontSize: '0.82rem', color: '#ef4444', marginTop: '0.75rem' }}>
          Could not load settings. Check Supabase connection.
        </p>
      </div>
    );
  }

  return (
    <div className="copy-section">
      <div className="copy-section-header">
        <h2 className="copy-section-title">Global Settings</h2>
        {status !== 'idle' && (
          <span className={`copy-status-msg ${status}`}>{statusMsg || (status === 'saving' ? 'Saving…' : '')}</span>
        )}
      </div>

      {/* Live On toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
        <span style={{ fontSize: '0.9rem', color: '#f8fafc', fontWeight: 600 }}>LIVE ON</span>
        <div className="toggle-switch">
          <input
            type="checkbox"
            checked={settings.live_on}
            onChange={(e) => handleLiveToggle(e.target.checked)}
            id="global-live-on"
            disabled={status === 'saving'}
          />
          <label className="toggle-slider" htmlFor="global-live-on" />
        </div>
        <span style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.45)' }}>
          Master live-trading gate. Must be ON for any live order to execute.
        </span>
      </div>

      {/* Numeric defaults */}
      <div className="copy-settings-grid">
        <div className="copy-form-field">
          <label className="copy-form-label">Max Live Exposure (USD)</label>
          <input
            className="copy-form-input"
            type="number"
            value={exposure}
            onChange={(e) => setExposure(e.target.value)}
            step="10"
            min="0"
          />
        </div>
        <div className="copy-form-field">
          <label className="copy-form-label">Default Slippage Cap</label>
          <input
            className="copy-form-input"
            type="number"
            value={slippage}
            onChange={(e) => setSlippage(e.target.value)}
            step="0.001"
            min="0"
            max="1"
          />
          <span className="copy-settings-sub">e.g. 0.03 = 3%</span>
        </div>
        <div className="copy-form-field">
          <label className="copy-form-label">Default Position Size (USD)</label>
          <input
            className="copy-form-input"
            type="number"
            value={posSize}
            onChange={(e) => setPosSize(e.target.value)}
            step="1"
            min="0"
          />
        </div>
        <div className="copy-form-field">
          <label className="copy-form-label">Default Max Positions</label>
          <input
            className="copy-form-input"
            type="number"
            value={maxPos}
            onChange={(e) => setMaxPos(e.target.value)}
            step="1"
            min="0"
          />
        </div>
      </div>

      <div className="copy-settings-save-row">
        <button
          className="copy-btn copy-btn-primary"
          onClick={handleSaveNumeric}
          disabled={status === 'saving'}
        >
          {status === 'saving' ? 'Saving…' : 'Save Settings'}
        </button>
      </div>

      {/* Emergency Stop */}
      <div className="copy-divider" />
      <div className="copy-danger-zone">
        <div>
          <div className="copy-danger-label">Emergency Stop</div>
          <div className="copy-danger-sub">
            When active, halts all live copy-trading immediately regardless of bot state.
          </div>
        </div>
        <button
          className={`copy-btn copy-btn-danger ${settings.emergency_stop ? 'active' : ''}`}
          onClick={handleEmergencyStop}
          disabled={status === 'saving'}
        >
          {settings.emergency_stop ? '⛔ ACTIVE — Click to Clear' : 'Activate Emergency Stop'}
        </button>
      </div>

      <p style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.25)', marginTop: '0.75rem' }}>
        Last updated: {new Date(settings.updated_at).toLocaleString()}
      </p>
    </div>
  );
}
