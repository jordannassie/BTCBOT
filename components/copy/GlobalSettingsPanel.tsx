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

function IconShield() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  );
}

function IconWarning() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  );
}

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
    const msg = checked
      ? 'Enable the master live-trading gate? Live bots with ARM LIVE set will begin executing real orders.'
      : 'Disable the master live-trading gate? All live copy execution will stop.';
    if (!window.confirm(msg)) return;
    patch({ live_on: checked });
  };

  const handleEmergencyStop = () => {
    if (!settings) return;
    const next = !settings.emergency_stop;
    const msg = next
      ? 'ACTIVATE emergency stop? This immediately halts ALL live copy-trading regardless of bot settings.'
      : 'Clear the emergency stop? Live trading will resume if the master gate is on.';
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

  const isLive = settings.live_on;
  const isEstop = settings.emergency_stop;

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

        {/* ── System Safety Block ── */}
        <div className="copy-safety-block">
          <div className="copy-safety-block-head">
            <span className="copy-safety-block-icon"><IconShield /></span>
            <span className="copy-safety-block-title">System Safety</span>
          </div>

          <div className="copy-safety-rows">
            {/* Live Trading Gate */}
            <div className={`copy-safety-row copy-safety-row-live`}>
              <div className="copy-safety-label-group">
                <span className="copy-safety-label">Live Trading Gate</span>
                <span className="copy-safety-sublabel">
                  Master switch for all live copy execution. Must be ON for any live bot to place real orders.
                  Disable to safely pause all live activity without changing individual bot state.
                </span>
              </div>
              <div className="copy-safety-controls">
                <span className={`copy-gate-pill ${isLive ? 'copy-gate-pill-on' : 'copy-gate-pill-off'}`}>
                  <span className={`copy-gate-dot ${isLive ? 'copy-gate-dot-on' : 'copy-gate-dot-off'}`} />
                  {isLive ? 'ON' : 'OFF'}
                </span>
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
            </div>

            {/* Emergency Stop */}
            <div className={`copy-safety-row copy-safety-row-stop${isEstop ? ' danger' : ''}`}>
              <div className="copy-safety-label-group">
                <span className="copy-safety-label">Emergency Stop</span>
                <span className="copy-safety-sublabel">
                  Immediately halts all live copy-trading regardless of bot state or master gate.
                  {isEstop ? ' ⚠ Emergency stop is currently ACTIVE — no live orders will execute.' : ' Not active.'}
                </span>
              </div>
              <div className="copy-safety-controls">
                <span className={`copy-gate-pill ${isEstop ? 'copy-estop-pill-active' : 'copy-estop-pill-inactive'}`}>
                  {isEstop
                    ? <><span className="copy-gate-dot copy-gate-dot-danger" />ACTIVE</>
                    : 'Clear'}
                </span>
                <button
                  className={`copy-estop-btn${isEstop ? ' active' : ''}`}
                  onClick={handleEmergencyStop}
                  disabled={status === 'saving'}
                >
                  {isEstop ? (
                    <><IconWarning /> Clear Stop</>
                  ) : (
                    <><IconWarning /> Activate Stop</>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── Risk Defaults ── */}
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
            {status === 'saving' ? 'Saving…' : 'Save Risk Defaults'}
          </button>
          <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.25)' }}>
            Updated: {new Date(settings.updated_at).toLocaleString()}
          </span>
        </div>

      </div>
    </div>
  );
}
