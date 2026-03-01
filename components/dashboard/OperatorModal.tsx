'use client';

import { useState, useEffect } from 'react';
import { updateSettings } from './actions';

type OperatorModalProps = {
  onClose: () => void;
};

export default function OperatorModal({ onClose }: OperatorModalProps) {
  const [isEnabled, setIsEnabled] = useState(false);
  const [mode, setMode] = useState<'PAPER' | 'LIVE'>('PAPER');
  const [edgeThreshold, setEdgeThreshold] = useState('0.02');
  const [tradeSize, setTradeSize] = useState('10');
  const [maxTradesPerHour, setMaxTradesPerHour] = useState('5');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetch('/api/bot-settings')
      .then((res) => res.json())
      .then((data) => {
        if (data.settings) {
          setIsEnabled(data.settings.is_enabled || false);
          setMode(data.settings.mode || 'PAPER');
          setEdgeThreshold(String(data.settings.edge_threshold || 0.02));
          setTradeSize(String(data.settings.trade_size || 10));
          setMaxTradesPerHour(String(data.settings.max_trades_per_hour || 5));
        }
      })
      .catch((err) => console.error('Error loading settings:', err));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage('');

    try {
      const result = await updateSettings({
        is_enabled: isEnabled,
        mode,
        edge_threshold: parseFloat(edgeThreshold),
        trade_size: parseFloat(tradeSize),
        max_trades_per_hour: parseInt(maxTradesPerHour, 10)
      });

      if (result.success) {
        setMessage('Settings saved successfully');
        setTimeout(() => {
          onClose();
        }, 1000);
      } else {
        setMessage('Error saving settings');
      }
    } catch (error) {
      setMessage('Error saving settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Operator Controls</h3>
          <button className="modal-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="modal-body">
          <div className="control-group">
            <label className="control-label">
              <span>Bot Enabled</span>
              <div className="toggle-switch">
                <input 
                  type="checkbox" 
                  checked={isEnabled} 
                  onChange={(e) => setIsEnabled(e.target.checked)}
                  id="enabled-toggle"
                />
                <label htmlFor="enabled-toggle" className="toggle-slider"></label>
              </div>
            </label>
          </div>

          <div className="control-group">
            <label className="control-label">
              <span>Mode</span>
              <select 
                value={mode} 
                onChange={(e) => setMode(e.target.value as 'PAPER' | 'LIVE')}
                className="control-select"
              >
                <option value="PAPER">PAPER</option>
                <option value="LIVE">LIVE</option>
              </select>
            </label>
          </div>

          <div className="control-group">
            <label className="control-label">
              <span>Edge Threshold</span>
              <input 
                type="number" 
                step="0.01" 
                value={edgeThreshold}
                onChange={(e) => setEdgeThreshold(e.target.value)}
                className="control-input"
              />
            </label>
          </div>

          <div className="control-group">
            <label className="control-label">
              <span>Trade Size</span>
              <input 
                type="number" 
                step="1" 
                value={tradeSize}
                onChange={(e) => setTradeSize(e.target.value)}
                className="control-input"
              />
            </label>
          </div>

          <div className="control-group">
            <label className="control-label">
              <span>Max Trades Per Hour</span>
              <input 
                type="number" 
                step="1" 
                value={maxTradesPerHour}
                onChange={(e) => setMaxTradesPerHour(e.target.value)}
                className="control-input"
              />
            </label>
          </div>

          {message && (
            <div className={`message ${message.includes('success') ? 'success' : 'error'}`}>
              {message}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
