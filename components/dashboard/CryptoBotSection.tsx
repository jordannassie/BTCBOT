'use client';

// CryptoBotSection — Four-column crypto bot grid + expanded details panel.
//
// Replaces Crypto5MinPanel on the main /dashboard page.
//
// Architecture:
//   This parent component is the single data fetcher. It calls GET /api/crypto/bots
//   every 5 seconds and distributes data down to CryptoBotCard (×4) and CryptoBotDetails.
//
// Layout:
//   [ BTC ] [ ETH ] [ SOL ] [ XRP ]  ← 4-column grid, equal cards
//   [ ──────────── Details ──────── ]  ← expanded panel for selected asset
//
// Synchronization:
//   Listens to 'crypto:bot-state-changed' + 'crypto:paper-reset' for immediate refresh.
//   Dispatches 'crypto:bot-state-changed' after any toggle.
//
// No trading logic. No FastLoop access.

import { useCallback, useEffect, useState } from 'react';
import CryptoBotCard, { ASSET_META, type AssetKey, type BotData } from './CryptoBotCard';
import CryptoBotDetails from './CryptoBotDetails';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ApiResponse {
  ok:    boolean;
  bots?: BotData[];
}

const ASSET_KEYS: AssetKey[] = ['BTC', 'ETH', 'SOL', 'XRP'];

// ── Component ─────────────────────────────────────────────────────────────────

export default function CryptoBotSection() {
  const [bots,         setBots]        = useState<BotData[]>([]);
  const [loading,      setLoading]     = useState(true);
  const [selectedAsset,setSelected]    = useState<AssetKey>('BTC');
  const [toggling,     setToggling]    = useState<Set<string>>(new Set());
  const [toggleErrMap, setToggleErrMap]= useState<Record<string, string>>({});

  // ── Data fetch ──────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      const res  = await fetch('/api/crypto/bots', { cache: 'no-store' });
      const json = await res.json() as ApiResponse;
      if (json.ok && json.bots) setBots(json.bots);
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 5_000);
    const onBotChange  = () => load();
    const onPaperReset = () => load();
    window.addEventListener('crypto:bot-state-changed', onBotChange);
    window.addEventListener('crypto:paper-reset',       onPaperReset);
    return () => {
      clearInterval(id);
      window.removeEventListener('crypto:bot-state-changed', onBotChange);
      window.removeEventListener('crypto:paper-reset',       onPaperReset);
    };
  }, [load]);

  // ── Toggle handler ──────────────────────────────────────────────────────
  const handleToggle = useCallback(async (botId: string, enable: boolean) => {
    const meta = Object.values(ASSET_META).find((m) => m.botId === botId);
    if (!meta) return;

    setToggling((prev) => new Set([...prev, botId]));
    setToggleErrMap((prev) => ({ ...prev, [botId]: '' }));

    try {
      let res: Response;
      if (meta.isBtc) {
        res = await fetch('/api/btc-5m-late', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ is_enabled: enable }),
          cache:   'no-store',
        });
      } else {
        res = await fetch('/api/crypto-5m', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ bot_id: botId, is_enabled: enable }),
          cache:   'no-store',
        });
      }

      const json = await res.json() as { ok: boolean; error?: string };
      if (json.ok) {
        await load();
        window.dispatchEvent(new CustomEvent('crypto:bot-state-changed'));
      } else {
        setToggleErrMap((prev) => ({ ...prev, [botId]: json.error ?? 'Toggle failed' }));
      }
    } catch {
      setToggleErrMap((prev) => ({ ...prev, [botId]: 'Network error' }));
    } finally {
      setToggling((prev) => { const s = new Set(prev); s.delete(botId); return s; });
    }
  }, [load]);

  const selectedBot = bots.find((b) => b.bot_id === ASSET_META[selectedAsset].botId) ?? null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      {/* ── Four-column card grid ── */}
      <div className="crypto-bot-grid">
        {ASSET_KEYS.map((asset) => {
          const meta = ASSET_META[asset];
          const bot  = bots.find((b) => b.bot_id === meta.botId) ?? null;
          return (
            <CryptoBotCard
              key={asset}
              asset={asset}
              bot={bot}
              selected={selectedAsset === asset}
              toggling={toggling.has(meta.botId)}
              onSelect={() => setSelected(asset)}
              onToggle={(enable) => handleToggle(meta.botId, enable)}
            />
          );
        })}
      </div>

      {/* Toggle errors */}
      {Object.entries(toggleErrMap).some(([, v]) => v) && (
        <div style={{ fontSize: '0.68rem', color: '#f87171' }}>
          {Object.entries(toggleErrMap)
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k}>{k}: {v}</div>
            ))}
        </div>
      )}

      {/* ── Expanded details for selected asset ── */}
      {!loading && (
        <CryptoBotDetails
          asset={selectedAsset}
          bot={selectedBot}
          onToggle={(enable) => handleToggle(ASSET_META[selectedAsset].botId, enable)}
          onReload={load}
        />
      )}
    </div>
  );
}
