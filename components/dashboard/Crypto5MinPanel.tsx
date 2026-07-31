'use client';

// Crypto5MinPanel — Four compact 5-minute strategy market cards.
//
// BTC 5-Min: reads live data from:
//   • /api/bot-settings?bot_id=btc_5m_ema  (settings + EMA signal telemetry)
//   • /api/btc-ema-metrics                  (today's trades/wins/losses/P&L)
//
// ETH, SOL, XRP: COMING SOON placeholders.
//
// Does NOT execute trades. Does NOT call FastLoop.
// Settings changes write to bot_settings via /api/bot-settings (POST).

import { useCallback, useEffect, useState } from 'react';

// ─── Types ─────────────────────────────────────────────────────────────────────

type BotSettings = {
  bot_id:          string;
  is_enabled:      boolean;
  mode:            string;
  arm_live:        boolean;
  trade_size_usd:  number;
  edge_threshold:  number;
  paper_balance_usd: number;
  strategy_settings: Record<string, unknown>;
};

type Metrics = {
  open_count:    number;
  open_exposure: number;
  total_pnl:     number;
};

type Card = 'btc' | 'eth' | 'sol' | 'xrp';

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmtUsd(v: unknown, digits = 2): string {
  const n = parseFloat(String(v ?? ''));
  if (!Number.isFinite(n)) return '—';
  const prefix = n < 0 ? '-$' : '$';
  return `${prefix}${Math.abs(n).toFixed(digits)}`;
}

function fmtNum(v: unknown, digits = 2): string {
  const n = parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
}

function signalLabel(s: unknown): { text: string; color: string } {
  if (s === 'YES')  return { text: 'UP',        color: '#34d399' };
  if (s === 'NO')   return { text: 'DOWN',       color: '#f87171' };
  if (s === 'NONE') return { text: 'TOO CLOSE',  color: '#fbbf24' };
  return               { text: '—',           color: 'rgba(248,250,252,0.3)' };
}

function statusLabel(enabled: boolean, mode: string): { text: string; color: string } {
  if (!enabled) return { text: 'OFF',   color: 'rgba(248,250,252,0.35)' };
  if (mode === 'LIVE') return { text: 'LIVE',  color: '#f87171' };
  return                 { text: 'PAPER', color: '#818cf8' };
}

// ─── Stat row ──────────────────────────────────────────────────────────────────

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', padding: '0.15rem 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <span style={{ color: 'rgba(248,250,252,0.38)' }}>{label}</span>
      <span style={{ fontWeight: 600, color: color ?? '#f8fafc' }}>{value}</span>
    </div>
  );
}

// ─── COMING SOON card ──────────────────────────────────────────────────────────

function ComingSoonCard({ asset }: { asset: string }) {
  return (
    <div style={{
      flex: '1 1 200px', minWidth: 180,
      background: 'rgba(15,17,26,0.6)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: '0.75rem',
      padding: '1rem',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: '0.4rem', minHeight: 140,
    }}>
      <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'rgba(248,250,252,0.5)', letterSpacing: '0.04em' }}>
        {asset} 5-MIN
      </span>
      <span style={{
        fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.1em',
        color: '#818cf8', background: 'rgba(99,102,241,0.1)',
        border: '1px solid rgba(99,102,241,0.2)',
        borderRadius: '0.35rem', padding: '0.15rem 0.55rem',
      }}>
        COMING SOON
      </span>
    </div>
  );
}

// ─── BTC Card ─────────────────────────────────────────────────────────────────

function BtcCard({
  settings, metrics, saving, saveErr, saveOk,
  onSave, onToggleMode,
}: {
  settings:   BotSettings | null;
  metrics:    Metrics | null;
  saving:     boolean;
  saveErr:    string | null;
  saveOk:     boolean;
  onSave:     (fields: Record<string, unknown>) => void;
  onToggleMode: (mode: 'PAPER' | 'LIVE', enabled: boolean) => void;
}) {
  const ss = settings?.strategy_settings ?? {};
  const sig = signalLabel(ss.signal);
  const sta = statusLabel(settings?.is_enabled ?? false, settings?.mode ?? 'PAPER');

  // Editable form state (initialized from saved settings or defaults)
  const [tradeSize,     setTradeSize]     = useState(String(settings?.trade_size_usd ?? 1));
  const [evalAt,        setEvalAt]        = useState(String((ss.entry_start_seconds as number) ?? 60));
  const [prefStart,     setPrefStart]     = useState(String((ss.preferred_entry_start as number) ?? 45));
  const [prefStop,      setPrefStop]      = useState(String((ss.preferred_entry_stop as number) ?? 30));
  const [stopAt,        setStopAt]        = useState(String((ss.entry_stop_seconds as number) ?? 20));
  const [minDist,       setMinDist]       = useState(String((ss.min_btc_distance as number) ?? 15));
  const [maxPrice,      setMaxPrice]      = useState(String((ss.max_contract_price as number) ?? 0.80));

  // Sync form when settings load
  useEffect(() => {
    if (!settings) return;
    setTradeSize(String(settings.trade_size_usd ?? 1));
    const s = settings.strategy_settings ?? {};
    setEvalAt(String((s.entry_start_seconds as number) ?? 60));
    setPrefStart(String((s.preferred_entry_start as number) ?? 45));
    setPrefStop(String((s.preferred_entry_stop as number) ?? 30));
    setStopAt(String((s.entry_stop_seconds as number) ?? 20));
    setMinDist(String((s.min_btc_distance as number) ?? 15));
    setMaxPrice(String((s.max_contract_price as number) ?? 0.80));
  }, [settings]);

  const handleSave = () => {
    onSave({
      trade_size_usd: parseFloat(tradeSize) || 1,
      strategy_settings: {
        entry_start_seconds:   parseFloat(evalAt) || 60,
        preferred_entry_start: parseFloat(prefStart) || 45,
        preferred_entry_stop:  parseFloat(prefStop) || 30,
        entry_stop_seconds:    parseFloat(stopAt) || 20,
        min_btc_distance:      parseFloat(minDist) || 15,
        max_contract_price:    parseFloat(maxPrice) || 0.80,
      },
    });
  };

  const slug   = typeof ss.market_slug === 'string' ? ss.market_slug : null;
  const isLive = settings?.mode === 'LIVE';
  const isPaper = settings?.mode === 'PAPER';
  const isOn   = settings?.is_enabled ?? false;

  return (
    <div style={{
      flex: '2 1 320px', minWidth: 280,
      background: 'rgba(15,17,26,0.6)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: '0.75rem',
      padding: '1rem',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.65rem' }}>
        <span style={{ fontWeight: 700, fontSize: '0.85rem', letterSpacing: '0.04em' }}>BTC 5-MIN</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <span style={{
            fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.08em',
            color: sta.color, background: `${sta.color}18`,
            border: `1px solid ${sta.color}40`,
            borderRadius: '0.3rem', padding: '0.1rem 0.5rem',
          }}>{sta.text}</span>
          {sig.text !== '—' && (
            <span style={{
              fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.06em',
              color: sig.color, background: `${sig.color}18`,
              border: `1px solid ${sig.color}40`,
              borderRadius: '0.3rem', padding: '0.1rem 0.5rem',
            }}>{sig.text}</span>
          )}
        </div>
      </div>

      {!settings && (
        <div style={{ fontSize: '0.72rem', color: 'rgba(248,250,252,0.3)', padding: '0.5rem 0' }}>Waiting for market data…</div>
      )}

      {settings && (
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          {/* ── Left: live stats ── */}
          <div style={{ flex: '1 1 140px', minWidth: 120 }}>
            <Stat label="Market"          value={slug ? slug.slice(0, 30) : '—'} />
            <Stat label="Time remaining"  value="—" />
            <Stat label="Price to Beat"   value="—" />
            <Stat label="BTC ref price"   value={fmtNum(ss.last_close, 0) !== '—' ? `$${fmtNum(ss.last_close, 0)}` : '—'} />
            <Stat label="Leading side"    value={sig.text} color={sig.color} />
            <Stat label="Dist from PTB"   value="—" />
            <Stat label="UP ask"          value="—" />
            <Stat label="DOWN ask"        value="—" />
            <Stat label="EMA 9"           value={fmtNum(ss.ema9, 0)} />
            <Stat label="EMA 200"         value={fmtNum(ss.ema200, 0)} />
            <Stat label="Signal"          value={typeof ss.signal === 'string' ? ss.signal : '—'} color={sig.color} />
            <Stat label="Last decision"   value="—" />
            {metrics && <>
              <Stat label="Today trades"  value={String(metrics.open_count ?? 0)} />
              <Stat label="Open exposure" value={fmtUsd(metrics.open_exposure)} />
              <Stat label="All-time P&L"  value={fmtUsd(metrics.total_pnl)} color={(metrics.total_pnl ?? 0) >= 0 ? '#34d399' : '#f87171'} />
            </>}
            <Stat label="Open positions"  value={String(ss.open_position_count ?? 0)} />
          </div>

          {/* ── Right: controls ── */}
          <div style={{ flex: '1 1 160px', minWidth: 140 }}>
            {/* Mode toggles */}
            <div style={{ marginBottom: '0.6rem' }}>
              <div style={{ fontSize: '0.65rem', color: 'rgba(248,250,252,0.3)', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Mode</div>
              <div style={{ display: 'flex', gap: '0.35rem' }}>
                <button
                  className={`copy-btn copy-btn-sm ${isPaper && isOn ? 'copy-btn-primary' : 'copy-btn-secondary'}`}
                  style={{ fontSize: '0.68rem', padding: '0.2rem 0.65rem' }}
                  onClick={() => onToggleMode('PAPER', !(isPaper && isOn))}
                  title={isPaper && isOn ? 'Disable PAPER mode' : 'Enable PAPER mode'}
                >PAPER</button>
                <button
                  className={`copy-btn copy-btn-sm ${isLive && isOn ? 'copy-btn-primary' : 'copy-btn-secondary'}`}
                  style={{ fontSize: '0.68rem', padding: '0.2rem 0.65rem', opacity: 0.5 }}
                  disabled
                  title="LIVE requires all safety gates — configure via FastLoop"
                >LIVE</button>
              </div>
            </div>

            {/* Settings form */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              {[
                { label: 'Fixed trade size ($)', value: tradeSize, set: setTradeSize, step: '0.01', min: '0.01' },
                { label: 'Start eval (sec remaining)', value: evalAt, set: setEvalAt, step: '1', min: '1' },
                { label: 'Pref entry start (sec)', value: prefStart, set: setPrefStart, step: '1', min: '1' },
                { label: 'Pref entry stop (sec)', value: prefStop, set: setPrefStop, step: '1', min: '1' },
                { label: 'Stop entries (sec remaining)', value: stopAt, set: setStopAt, step: '1', min: '1' },
                { label: 'Min BTC distance ($)', value: minDist, set: setMinDist, step: '1', min: '0' },
                { label: 'Max contract price ($)', value: maxPrice, set: setMaxPrice, step: '0.01', min: '0.01', max: '1' },
              ].map(({ label, value, set, step, min, max }) => (
                <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                  <label style={{ fontSize: '0.62rem', color: 'rgba(248,250,252,0.35)' }}>{label}</label>
                  <input
                    className="copy-form-input"
                    type="number"
                    step={step}
                    min={min}
                    max={max}
                    value={value}
                    onChange={(e) => set(e.target.value)}
                    style={{ padding: '0.18rem 0.35rem', fontSize: '0.75rem' }}
                  />
                </div>
              ))}
            </div>

            <button
              className="copy-btn copy-btn-primary"
              style={{ marginTop: '0.6rem', width: '100%', fontSize: '0.72rem', padding: '0.3rem' }}
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save Settings'}
            </button>
            {saveErr && <div style={{ fontSize: '0.65rem', color: '#f87171', marginTop: '0.25rem' }}>✗ {saveErr}</div>}
            {saveOk  && <div style={{ fontSize: '0.65rem', color: '#34d399', marginTop: '0.25rem' }}>✓ Saved</div>}
            <div style={{ fontSize: '0.6rem', color: 'rgba(248,250,252,0.2)', marginTop: '0.3rem' }}>
              Mode: {settings.mode} · Strategy: BTC 5M EMA
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Panel ────────────────────────────────────────────────────────────────

export default function Crypto5MinPanel() {
  const [settings,  setSettings]  = useState<BotSettings | null>(null);
  const [metrics,   setMetrics]   = useState<Metrics | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [saveErr,   setSaveErr]   = useState<string | null>(null);
  const [saveOk,    setSaveOk]    = useState(false);
  const [expanded,  setExpanded]  = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [settRes, metRes] = await Promise.all([
        fetch('/api/bot-settings?bot_id=btc_5m_ema', { cache: 'no-store' }),
        fetch('/api/btc-ema-metrics', { cache: 'no-store' }),
      ]);
      const settJson = await settRes.json() as { ok: boolean; settings?: BotSettings };
      const metJson  = await metRes.json()  as { ok: boolean; open_count?: number; open_exposure?: number; total_pnl?: number };
      if (settJson.ok && settJson.settings) setSettings(settJson.settings);
      if (metJson.ok) setMetrics({ open_count: metJson.open_count ?? 0, open_exposure: metJson.open_exposure ?? 0, total_pnl: metJson.total_pnl ?? 0 });
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30_000);
    return () => clearInterval(interval);
  }, [loadData]);

  const handleSave = async (fields: Record<string, unknown>) => {
    setSaving(true); setSaveErr(null); setSaveOk(false);
    try {
      const res = await fetch('/api/bot-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bot_id: 'btc_5m_ema', ...fields }),
        cache: 'no-store',
      });
      const payload = await res.json() as { ok: boolean; error?: string };
      if (payload.ok) { setSaveOk(true); setTimeout(() => setSaveOk(false), 3000); await loadData(); }
      else setSaveErr(payload.error ?? 'Save failed');
    } catch { setSaveErr('Network error'); }
    finally { setSaving(false); }
  };

  const handleToggleMode = async (mode: 'PAPER' | 'LIVE', enabled: boolean) => {
    await handleSave({ mode, is_enabled: enabled });
  };

  const cards: Card[] = ['btc', 'eth', 'sol', 'xrp'];

  return (
    <section style={{
      margin: '0.75rem 0 0',
      background: 'rgba(15,17,26,0.4)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: '0.75rem',
      overflow: 'hidden',
    }}>
      {/* ── Section header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0.75rem 1.25rem',
        borderBottom: expanded ? '1px solid rgba(255,255,255,0.06)' : 'none',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <h2 style={{ margin: 0, fontSize: '0.88rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Crypto 5-Min
            </h2>
            {loading && <span style={{ fontSize: '0.65rem', color: 'rgba(248,250,252,0.3)' }}>Loading…</span>}
          </div>
          <p style={{ margin: '0.1rem 0 0', fontSize: '0.68rem', color: 'rgba(248,250,252,0.35)' }}>
            Fast-cycle crypto prediction trading with controlled entries and automatic resolution tracking.
          </p>
        </div>
        <button
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(248,250,252,0.4)', fontSize: '0.8rem', padding: '0.25rem 0.5rem' }}
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? 'Collapse' : 'Expand'}
        >{expanded ? '▲' : '▼'}</button>
      </div>

      {expanded && (
        <div style={{ display: 'flex', gap: '0.75rem', padding: '1rem 1.25rem', flexWrap: 'wrap' }}>
          {cards.map((c) =>
            c === 'btc'
              ? <BtcCard key="btc" settings={settings} metrics={metrics} saving={saving} saveErr={saveErr} saveOk={saveOk} onSave={handleSave} onToggleMode={handleToggleMode} />
              : <ComingSoonCard key={c} asset={c.toUpperCase()} />
          )}
        </div>
      )}
    </section>
  );
}
