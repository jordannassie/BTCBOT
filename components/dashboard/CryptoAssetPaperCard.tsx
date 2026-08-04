'use client';

// CryptoAssetPaperCard — active paper bot card for ETH, SOL, XRP 5-minute strategies.
// Mirrors the BTC card layout and controls.
// Reads from /api/crypto-5m?bot_id=<id> and /api/crypto/bots (stats).
// Does NOT execute trades. Does NOT call LIVE.

import { useCallback, useEffect, useState } from 'react';

// ─── Types ─────────────────────────────────────────────────────────────────────

type Settings = {
  bot_id:            string;
  is_enabled:        boolean;
  mode:              string;
  arm_live:          boolean;
  trade_size_usd:    number;
  paper_balance_usd: number;
  paper_pnl_usd?:   number;
  strategy_settings?: Record<string, unknown>;
};

type BotStat = {
  bot_id:            string;
  is_enabled:        boolean;
  trade_size_usd:    number;
  starting_balance:  number;
  realized_pnl:      number;
  open_exposure:     number;
  available_balance: number;
  account_equity:    number;
  stats: {
    total_trades:        number;
    trades_today:        number;
    open_trades:         number;
    closed_trades:       number;
    wins:                number;
    losses:              number;
    win_rate:            number;
    today_pnl:           number;
    all_time_pnl:        number;
  };
  recent_trades: Array<{
    status?:      string | null;
    start_ts?:    string | null;
    slug?:        string | null;
    side?:        string | null;
    size_usd?:    number | null;
    entry_price?: number | null;
    pnl_usd?:     number | null;
    result?:      string | null;
  }>;
  latest_trade: {
    start_ts?:    string | null;
    slug?:        string | null;
    side?:        string | null;
    size_usd?:    number | null;
    entry_price?: number | null;
    status?:      string | null;
    pnl_usd?:     number | null;
    result?:      string | null;
  } | null;
};

// ─── Config ────────────────────────────────────────────────────────────────────

const ASSET_META: Record<string, { label: string; botId: string; imgUrl: string; imgAlt: string; accentColor: string; slugPrefix: string }> = {
  ETH: {
    label:       'ETH 5-MIN',
    botId:       'eth_5m_paper',
    imgUrl:      'https://jyhfffqximlbhlaarozs.supabase.co/storage/v1/object/public/Storage/image/Crypto/ETHfullsize.webp',
    imgAlt:      'Ethereum logo',
    accentColor: '#818cf8',
    slugPrefix:  'eth-updown-5m-',
  },
  SOL: {
    label:       'SOL 5-MIN',
    botId:       'sol_5m_paper',
    imgUrl:      'https://jyhfffqximlbhlaarozs.supabase.co/storage/v1/object/public/Storage/image/Crypto/SOL-logo.webp',
    imgAlt:      'Solana logo',
    accentColor: '#a78bfa',
    slugPrefix:  'sol-updown-5m-',
  },
  XRP: {
    label:       'XRP 5-MIN',
    botId:       'xrp_5m_paper',
    imgUrl:      'https://jyhfffqximlbhlaarozs.supabase.co/storage/v1/object/public/Storage/image/Crypto/XRP-logo.webp',
    imgAlt:      'XRP logo',
    accentColor: '#38bdf8',
    slugPrefix:  'xrp-updown-5m-',
  },
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmtUsd(v: unknown, digits = 2): string {
  const n = parseFloat(String(v ?? ''));
  if (!Number.isFinite(n)) return '—';
  const prefix = n < 0 ? '-$' : '$';
  return `${prefix}${Math.abs(n).toFixed(digits)}`;
}

function fmtPnl(v: number): string {
  return `${v >= 0 ? '+' : ''}${fmtUsd(v, 4)}`;
}

function pnlColor(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return 'rgba(248,250,252,0.5)';
  return v > 0 ? '#34d399' : v < 0 ? '#f87171' : 'rgba(248,250,252,0.55)';
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
  catch { return iso; }
}

function shortSlug(slug: string | null | undefined, prefix: string): string {
  if (!slug) return '—';
  return slug.replace(new RegExp(`^${prefix}`, 'i'), '').slice(0, 14) || slug;
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', padding: '0.12rem 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <span style={{ color: 'rgba(248,250,252,0.38)' }}>{label}</span>
      <span style={{ fontWeight: 600, color: color ?? '#f8fafc' }}>{value}</span>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CryptoAssetPaperCard({ asset, allBotStats }: {
  asset:        'ETH' | 'SOL' | 'XRP';
  allBotStats:  BotStat[] | null;
}) {
  const meta   = ASSET_META[asset];
  const botId  = meta.botId;

  const [settings,    setSettings]    = useState<Settings | null>(null);
  const [toggling,    setToggling]    = useState(false);
  const [toggleErr,   setToggleErr]   = useState<string | null>(null);
  const [toggleDone,  setToggleDone]  = useState<'on' | 'off' | null>(null);
  const [savingSize,  setSavingSize]  = useState(false);
  const [saveOk,      setSaveOk]      = useState(false);
  const [saveErr,     setSaveErr]     = useState<string | null>(null);
  const [tradeSize,   setTradeSize]   = useState('0.10');
  const [modal,       setModal]       = useState<'on' | 'off' | null>(null);

  const stat = allBotStats?.find((b) => b.bot_id === botId) ?? null;

  const loadSettings = useCallback(async () => {
    try {
      const res  = await fetch(`/api/crypto-5m?bot_id=${botId}`, { cache: 'no-store' });
      const json = await res.json() as { ok: boolean; settings?: Settings };
      if (json.ok && json.settings) {
        setSettings(json.settings);
        setTradeSize(String(json.settings.trade_size_usd ?? 0.10));
      }
    } catch {}
  }, [botId]);

  useEffect(() => {
    loadSettings();
    // Re-fetch when control center changes this bot's state
    const onBotChange = () => loadSettings();
    window.addEventListener('crypto:bot-state-changed', onBotChange);
    return () => window.removeEventListener('crypto:bot-state-changed', onBotChange);
  }, [loadSettings]);

  useEffect(() => {
    if (settings?.trade_size_usd != null) setTradeSize(String(settings.trade_size_usd));
  }, [settings?.trade_size_usd]);

  const handleToggle = async (enable: boolean) => {
    setToggling(true); setToggleErr(null); setToggleDone(null);
    try {
      const res  = await fetch('/api/crypto-5m', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bot_id: botId, is_enabled: enable }),
      });
      const json = await res.json() as { ok: boolean; settings?: Settings; error?: string };
      if (json.ok && json.settings) {
        setSettings(json.settings);
        setToggleDone(enable ? 'on' : 'off');
        setTimeout(() => setToggleDone(null), 4000);
        // Notify control center so its toggles stay in sync
        window.dispatchEvent(new CustomEvent('crypto:bot-state-changed'));
      } else {
        setToggleErr(json.error ?? 'Toggle failed');
      }
    } catch { setToggleErr('Network error'); }
    finally { setToggling(false); setModal(null); }
  };

  const handleSaveSize = async () => {
    setSavingSize(true); setSaveErr(null); setSaveOk(false);
    try {
      const size = parseFloat(tradeSize);
      if (!Number.isFinite(size) || size <= 0) { setSaveErr('Invalid size'); return; }
      const res  = await fetch('/api/crypto-5m', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bot_id: botId, is_enabled: settings?.is_enabled ?? false, trade_size_usd: size }),
      });
      const json = await res.json() as { ok: boolean; settings?: Settings; error?: string };
      if (json.ok && json.settings) {
        setSettings(json.settings);
        setSaveOk(true);
        setTimeout(() => setSaveOk(false), 3000);
      } else {
        setSaveErr(json.error ?? 'Save failed');
      }
    } catch { setSaveErr('Network error'); }
    finally { setSavingSize(false); }
  };

  const isOn   = settings?.is_enabled ?? false;
  const ss     = (settings?.strategy_settings ?? {}) as Record<string, unknown>;
  const secsLeft = typeof ss.seconds_remaining === 'number' ? ss.seconds_remaining : null;
  const slug   = typeof ss.market_slug === 'string' ? ss.market_slug : null;
  const status = typeof ss.status === 'string' ? ss.status : null;
  const pmUrl  = typeof ss.market_url === 'string' ? ss.market_url : (slug ? `https://polymarket.com/event/${slug}` : null);
  const refPx  = typeof ss.price_to_beat === 'number' ? ss.price_to_beat : null;
  const spotPx = typeof ss.reference_price === 'number' ? ss.reference_price : null;
  const leadingSide = typeof ss.leading_side === 'string' ? ss.leading_side : null;
  const decision    = typeof ss.last_decision === 'string' ? ss.last_decision : null;
  const curPos      = Boolean(ss.current_position);
  const todayWins   = typeof ss.today_wins   === 'number' ? ss.today_wins   : null;
  const todayLoss   = typeof ss.today_losses === 'number' ? ss.today_losses : null;
  const todayPnl    = typeof ss.today_pnl    === 'number' ? ss.today_pnl    : null;
  const snapAt      = typeof ss.updated_at   === 'string' ? ss.updated_at   : null;

  let badge = 'OFF'; let badgeColor = 'rgba(248,250,252,0.35)';
  if (isOn) {
    if (curPos) { badge = 'ON'; badgeColor = '#34d399'; }
    else if (secsLeft != null && secsLeft <= 60 && secsLeft >= 0) { badge = 'ON'; badgeColor = '#fbbf24'; }
    else { badge = 'ON'; badgeColor = meta.accentColor; }
  }

  const s = stat?.stats;
  const pnlCol = (v: number | null) => v == null ? undefined : v > 0 ? '#34d399' : v < 0 ? '#f87171' : undefined;

  return (
    <>
    <div style={{
      flex: '1 1 0', minWidth: 0,
      background: 'rgba(15,17,26,0.5)',
      border: `1px solid ${isOn ? `${meta.accentColor}25` : 'rgba(255,255,255,0.06)'}`,
      borderRadius: '0.75rem',
      padding: '1rem 1.1rem',
      display: 'flex', flexDirection: 'column', gap: '0.5rem',
    }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={meta.imgUrl} alt={meta.imgAlt}
          style={{
            width: 36, height: 36, objectFit: 'contain',
            borderRadius: '50%', background: 'rgba(255,255,255,0.04)',
            padding: '0.15rem', flexShrink: 0,
            opacity: isOn ? 1 : 0.55,
            border: isOn ? `1.5px solid ${meta.accentColor}60` : 'none',
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '0.82rem', letterSpacing: '0.04em', color: isOn ? '#f8fafc' : 'rgba(248,250,252,0.55)' }}>
            {meta.label}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginTop: '0.15rem', flexWrap: 'wrap' }}>
            <span style={{
              fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.07em',
              color: badgeColor, background: `${badgeColor}18`,
              border: `1px solid ${badgeColor}40`,
              borderRadius: '0.25rem', padding: '0.08rem 0.4rem',
            }}>{badge}</span>
            <span style={{
              fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.06em',
              color: '#818cf8', background: 'rgba(129,140,248,0.08)',
              border: '1px solid rgba(129,140,248,0.2)',
              borderRadius: '0.25rem', padding: '0.08rem 0.4rem',
            }}>PAPER</span>
            {curPos && <span style={{ fontSize: '0.58rem', fontWeight: 700, color: '#34d399', letterSpacing: '0.06em' }}>● POSITION OPEN</span>}
          </div>
        </div>
        <button
          style={{
            fontSize: '0.65rem', fontWeight: 700, padding: '0.22rem 0.65rem',
            background: isOn ? 'rgba(239,68,68,0.1)' : `${meta.accentColor}18`,
            border: `1px solid ${isOn ? 'rgba(239,68,68,0.35)' : `${meta.accentColor}45`}`,
            color: isOn ? '#f87171' : meta.accentColor,
            borderRadius: '0.35rem', cursor: toggling ? 'wait' : 'pointer',
            flexShrink: 0, whiteSpace: 'nowrap',
          }}
          disabled={toggling}
          onClick={() => setModal(isOn ? 'off' : 'on')}
        >
          {toggling ? '…' : isOn ? 'Turn OFF' : 'Turn ON'}
        </button>
      </div>

      {/* ── Status / market info ── */}
      {isOn && (
        <div style={{ fontSize: '0.7rem', display: 'flex', flexDirection: 'column', gap: 0 }}>
          {slug ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.2rem' }}>
              <span style={{ fontFamily: 'monospace', fontSize: '0.63rem', color: 'rgba(248,250,252,0.5)', wordBreak: 'break-all' }}>
                {slug}
              </span>
              {pmUrl && (
                <a href={pmUrl} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: '0.58rem', color: meta.accentColor, textDecoration: 'none', whiteSpace: 'nowrap',
                    border: `1px solid ${meta.accentColor}40`, borderRadius: '0.25rem', padding: '0.08rem 0.35rem',
                    background: `${meta.accentColor}10` }}>
                  PM ↗
                </a>
              )}
            </div>
          ) : (
            <span style={{ color: 'rgba(248,250,252,0.25)', fontSize: '0.68rem' }}>Waiting for market data…</span>
          )}
          <Stat label="Seconds left"   value={secsLeft != null ? `${secsLeft}s` : '—'} color={secsLeft != null && secsLeft < 30 ? '#fbbf24' : undefined} />
          <Stat label="Price to Beat"  value={refPx  != null ? `$${refPx.toFixed(refPx < 10 ? 4 : 2)}` : '—'} />
          <Stat label="Spot price"     value={spotPx != null ? `$${spotPx.toFixed(spotPx < 10 ? 4 : 2)}` : '—'} />
          <Stat label="Leading side"   value={leadingSide ?? '—'} color={leadingSide === 'UP' ? '#34d399' : leadingSide === 'DOWN' ? '#f87171' : undefined} />
          <Stat label="Last decision"  value={decision ?? '—'} />
          <Stat label="Strategy state" value={status ?? '—'} />
          {snapAt && <Stat label="Snapshot at" value={fmtTime(snapAt)} />}
        </div>
      )}

      {/* ── Today's performance ── */}
      {(todayWins != null || s) && (
        <div style={{ fontSize: '0.7rem', padding: '0.3rem 0.5rem',
          background: 'rgba(255,255,255,0.025)', borderRadius: '0.35rem',
          border: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.15rem 0.6rem' }}>
            <Stat label="Today W/L"    value={s ? `${s.wins}W / ${s.losses}L` : `${todayWins ?? 0}W / ${todayLoss ?? 0}L`} />
            <Stat label="Today P/L"    value={fmtPnl(s?.today_pnl ?? todayPnl ?? 0)} color={pnlCol(s?.today_pnl ?? todayPnl ?? 0)} />
            <Stat label="All-time P/L" value={fmtPnl(s?.all_time_pnl ?? 0)} color={pnlCol(s?.all_time_pnl ?? 0)} />
            <Stat label="Total trades" value={String(s?.total_trades ?? 0)} />
          </div>
        </div>
      )}

      {/* ── Balance summary ── */}
      {stat && (
        <div style={{ fontSize: '0.7rem', padding: '0.3rem 0.5rem',
          background: 'rgba(255,255,255,0.025)', borderRadius: '0.35rem',
          border: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ fontWeight: 700, fontSize: '0.62rem', color: 'rgba(248,250,252,0.4)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '0.2rem' }}>
            Paper Account
          </div>
          <Stat label="Starting"  value={fmtUsd(stat.starting_balance)} />
          <Stat label="P/L"       value={fmtPnl(stat.realized_pnl)} color={pnlColor(stat.realized_pnl)} />
          <Stat label="Exposure"  value={fmtUsd(stat.open_exposure)} />
          <Stat label="Balance"   value={fmtUsd(stat.available_balance)} />
          <Stat label="Equity"    value={fmtUsd(stat.account_equity)} color={pnlColor(stat.account_equity - stat.starting_balance)} />
        </div>
      )}

      {/* ── Trade size control ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
        <label style={{ fontSize: '0.6rem', color: 'rgba(248,250,252,0.3)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
          Trade size ($)
        </label>
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <input
            type="number" step="0.01" min="0.01"
            value={tradeSize}
            onChange={(e) => setTradeSize(e.target.value)}
            style={{
              flex: 1, padding: '0.18rem 0.35rem', fontSize: '0.75rem',
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '0.3rem', color: '#f8fafc',
            }}
          />
          <button
            style={{
              fontSize: '0.65rem', padding: '0.2rem 0.55rem',
              background: `${meta.accentColor}18`,
              border: `1px solid ${meta.accentColor}40`,
              color: meta.accentColor, borderRadius: '0.3rem', cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
            disabled={savingSize}
            onClick={handleSaveSize}
          >
            {savingSize ? '…' : 'Save'}
          </button>
        </div>
        {saveOk  && <span style={{ fontSize: '0.62rem', color: '#34d399' }}>✓ Trade size saved</span>}
        {saveErr && <span style={{ fontSize: '0.62rem', color: '#f87171' }}>✗ {saveErr}</span>}
      </div>

      {/* ── Latest trade ── */}
      {stat?.latest_trade && (() => {
        const lt = stat.latest_trade!;
        const side = lt.side ?? '—';
        const result = lt.result ?? '—';
        const resultColor = result === 'WIN' ? '#34d399' : result === 'LOSS' ? '#f87171' : result === 'OPEN' ? '#fbbf24' : 'rgba(248,250,252,0.5)';
        return (
          <div style={{ fontSize: '0.68rem', padding: '0.3rem 0.5rem',
            background: 'rgba(255,255,255,0.025)', borderRadius: '0.35rem',
            border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ fontWeight: 700, fontSize: '0.6rem', color: 'rgba(248,250,252,0.4)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '0.2rem' }}>
              Latest Trade
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.1rem 0.5rem' }}>
              <Stat label="Market" value={shortSlug(lt.slug, meta.slugPrefix)} />
              <Stat label="Side"   value={side} color={side === 'UP' ? '#34d399' : side === 'DOWN' ? '#f87171' : undefined} />
              <Stat label="Result" value={result} color={resultColor} />
              <Stat label="P/L"    value={lt.pnl_usd != null && lt.status !== 'OPEN' ? fmtPnl(lt.pnl_usd) : '—'} color={pnlColor(lt.pnl_usd)} />
            </div>
          </div>
        );
      })()}

      {/* ── Feedback ── */}
      {toggleDone === 'on'  && <span style={{ fontSize: '0.65rem', color: '#34d399' }}>✓ {asset} bot turned ON</span>}
      {toggleDone === 'off' && <span style={{ fontSize: '0.65rem', color: 'rgba(248,250,252,0.4)' }}>✓ {asset} bot turned OFF</span>}
      {toggleErr            && <span style={{ fontSize: '0.65rem', color: '#f87171' }}>✗ {toggleErr}</span>}
    </div>

    {/* ── Confirmation modal: Turn ON ── */}
    {modal === 'on' && (
      <div className="copy-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !toggling) setModal(null); }}>
        <div className="copy-modal" role="dialog" aria-modal="true" style={{ maxWidth: 380 }}>
          <div className="copy-modal-header">
            <h3 className="copy-modal-title">Enable {asset} 5-Min PAPER Trading?</h3>
            <button className="copy-modal-close" onClick={() => setModal(null)} disabled={toggling}>×</button>
          </div>
          <div className="copy-modal-body">
            {[
              ['Strategy',  `${asset} 5-Min Simple`],
              ['Mode',      'PAPER — forced'],
              ['Trade size', `$${parseFloat(tradeSize).toFixed(2)}`],
              ['LIVE',      'OFF — not available'],
              ['ARM LIVE',  'OFF — forced'],
            ].map(([label, value]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', padding: '0.2rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <span style={{ color: 'rgba(248,250,252,0.45)' }}>{label}</span>
                <span style={{ fontWeight: 600 }}>{value}</span>
              </div>
            ))}
          </div>
          <div className="copy-modal-footer">
            <button className="copy-btn copy-btn-secondary" onClick={() => setModal(null)} disabled={toggling}>Cancel</button>
            <button className="copy-btn copy-btn-primary" onClick={() => handleToggle(true)} disabled={toggling}>
              {toggling ? 'Enabling…' : `TURN ON ${asset} PAPER`}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* ── Confirmation modal: Turn OFF ── */}
    {modal === 'off' && (
      <div className="copy-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !toggling) setModal(null); }}>
        <div className="copy-modal" role="dialog" aria-modal="true" style={{ maxWidth: 380 }}>
          <div className="copy-modal-header">
            <h3 className="copy-modal-title">Turn Off {asset} 5-Min PAPER Trading?</h3>
            <button className="copy-modal-close" onClick={() => setModal(null)} disabled={toggling}>×</button>
          </div>
          <div className="copy-modal-body">
            <p style={{ fontSize: '0.8rem', color: 'rgba(248,250,252,0.65)', marginBottom: '0.5rem' }}>
              This stops new {asset} 5-minute entries. Existing positions will still settle normally.
            </p>
          </div>
          <div className="copy-modal-footer">
            <button className="copy-btn copy-btn-secondary" onClick={() => setModal(null)} disabled={toggling}>Cancel</button>
            <button
              className="copy-btn copy-btn-primary"
              onClick={() => handleToggle(false)}
              disabled={toggling}
              style={{ background: 'rgba(239,68,68,0.12)', borderColor: 'rgba(239,68,68,0.4)', color: '#f87171' }}
            >
              {toggling ? 'Turning Off…' : `TURN OFF ${asset} PAPER`}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
