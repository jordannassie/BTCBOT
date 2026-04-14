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
    const msg = next
      ? 'Enable emergency stop? This will halt all live copy-trading immediately.'
      : 'Clear emergency stop? Live trading will resume if the master gate is on.';
    if (!window.confirm(msg)) return;
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
        <div className="copy-section-head">
          <div className="copy-section-title-row">
            <h2 className="copy-section-title">Global Settings</h2>
          </div>
        </div>
        <div className="copy-loading">Loading settings…</div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="copy-section">
        <div className="copy-section-head">
          <div className="copy-section-title-row">
            <h2 className="copy-section-title">Global Settings</h2>
          </div>
        </div>
        <div className="copy-empty">
          <p className="copy-empty-title" style={{ color: '#f87171' }}>
            Could not load settings — check Supabase connection.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="copy-section">
      <div className="copy-section-head">
        <div className="copy-section-title-row">
          <h2 className="copy-section-title">Global Settings</h2>
        </div>
        {status !== 'idle' && (
          <span className={`copy-status-msg ${status}`}>
            {statusMsg || (status === 'saving' ? 'Saving…' : '')}
          </span>
        )}
      </div>

      <div className="copy-settings-body">
        {/* Master live-trading gate */}
        <div className="copy-settings-toggle-row">
          <div className="copy-settings-toggle-label">
            <div className="copy-settings-label">Live Trading Gate</div>
            <div className="copy-settings-sub">Must be ON for any live copy order to execute, regardless of individual bot settings.</div>
          </div>
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
        </div>

        {/* Numeric defaults */}
        <div>
          <div className="copy-form-title">Risk Defaults</div>
          <div className="copy-settings-field-row">
            <div className="copy-form-field">
              <label className="copy-form-label">Max Total Live Exposure (USD)</label>
              <input
                className="copy-form-input"
                type="number"
                value={exposure}
                onChange={(e) => setExposure(e.target.value)}
                step="10"
                min="0"
              />
              <span className="copy-form-hint">Portfolio-level USD cap across all live bots</span>
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
              <span className="copy-form-hint">e.g. 0.03 = 3% tolerance</span>
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
              <span className="copy-form-hint">Fallback size per trade if bot has none set</span>
            </div>
            <div className="copy-form-field">
              <label className="copy-form-label">Default Max Open Positions</label>
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
        </div>

        <div className="copy-settings-save-row">
          <button
            className="copy-btn copy-btn-primary"
            onClick={handleSaveNumeric}
            disabled={status === 'saving'}
          >
            {status === 'saving' ? 'Saving…' : 'Save Settings'}
          </button>
          <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.25)' }}>
            Last updated: {new Date(settings.updated_at).toLocaleString()}
          </span>
        </div>

        {/* Emergency Stop */}
        <div className="copy-danger-zone">
          <div>
            <div className="copy-danger-label">Emergency Stop</div>
            <div className="copy-danger-sub">
              When active, halts all live copy-trading immediately regardless of individual bot state.
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
      </div>
    </div>
  );
}
