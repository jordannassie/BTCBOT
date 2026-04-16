'use client';

// Converts the Copy Trading page from a long scroll to a tabbed dashboard.
// The bankroll cards (LiveCard + CopyPaperBankrollCard) live above this
// component, server-rendered. This component owns everything below them.
//
// Tabs: Overview · Wallets · Bots · Attempts · Positions · Settings
// (Master Strategy is now in Settings → Advanced, not a top-level tab)
//
// UX:
//   - Active tab persisted to localStorage (key: 'btcbot-copy-tab')
//   - Tab counts fetched from /api/copy/summary, polled every 15 s
//   - Counts also refresh on window focus (visibilitychange)
//   - Attempts and Positions tabs get scrollable tables (sticky headers)

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';

import CopyOverviewCards from './CopyOverviewCards';

const TrackedWalletsSection  = dynamic(() => import('./TrackedWalletsSection'));
const HotWalletsSection      = dynamic(() => import('./HotWalletsSection'));
const HotImportSection       = dynamic(() => import('./HotImportSection'));
const CopyBotsSection        = dynamic(() => import('./CopyBotsSection'));
const CopyAttemptsSection    = dynamic(() => import('./CopyAttemptsSection'));
const CopiedPositionsSection = dynamic(() => import('./CopiedPositionsSection'));
const MasterStrategySection  = dynamic(() => import('./MasterStrategySection'));
const GlobalSettingsPanel    = dynamic(() => import('./GlobalSettingsPanel'));

// ─── Types ────────────────────────────────────────────────────────────────────

type TabId = 'overview' | 'wallets' | 'hot' | 'bots' | 'attempts' | 'positions' | 'settings';

const LS_KEY  = 'btcbot-copy-tab';
const POLL_MS = 15_000;

interface TabDef {
  id: TabId;
  label: string;
  /** Key in the summary payload for the badge number */
  countKey?: string;
  /**
   * Optional second key. When both keys are present the badge shows
   * "primary / secondary" so the operator can see enabled vs total at a glance.
   */
  countKeyTotal?: string;
}

// Tab badge logic:
//   Wallets   → walletsActive    (active / total if they differ)
//   Bots      → activeBotCount   (enabled / total if they differ)
//   Attempts  → attemptsTodayCount (today's decisions)
//   Positions → openPositionCount  (OPEN only)
const TABS: TabDef[] = [
  { id: 'overview',  label: 'Overview' },
  { id: 'wallets',   label: 'Wallets',   countKey: 'walletsActive', countKeyTotal: 'walletsTotal' },
  { id: 'hot',       label: 'HOT' },
  { id: 'bots',      label: 'Bots',      countKey: 'activeBotCount', countKeyTotal: 'botsTotal' },
  { id: 'attempts',  label: 'Attempts',  countKey: 'attemptsTodayCount' },
  { id: 'positions', label: 'Positions', countKey: 'openPositionCount' },
  { id: 'settings',  label: 'Settings' },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function CopyTradingTabs() {
  const [tab, setTab] = useState<TabId>('overview');
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [mounted, setMounted] = useState(false);

  // Restore saved tab from localStorage after mount (SSR-safe)
  useEffect(() => {
    setMounted(true);
    try {
      const saved = localStorage.getItem(LS_KEY) as TabId | null;
      if (saved && TABS.some((t) => t.id === saved)) setTab(saved);
    } catch {}
  }, []);

  // Fetch (and poll) the summary endpoint for tab badge counts.
  // Dispatches 'copy:data-fetched' after each successful fetch so the page
  // header can update its "Updated X ago" timestamp without a separate fetch.
  const fetchCounts = useCallback(async () => {
    try {
      const r = await fetch('/api/copy/summary', { cache: 'no-store' });
      const p = await r.json();
      if (p.ok) {
        setCounts(p as Record<string, number>);
        window.dispatchEvent(new CustomEvent('copy:data-fetched'));
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchCounts();

    // Keep badges live while the worker writes to Supabase
    const poll = setInterval(fetchCounts, POLL_MS);

    // Re-sync when the operator returns to this browser tab
    const onVisible = () => { if (!document.hidden) fetchCounts(); };
    document.addEventListener('visibilitychange', onVisible);

    // Re-fetch immediately when the page-level Refresh button is clicked
    const onRefresh = () => fetchCounts();
    window.addEventListener('copy:refresh', onRefresh);

    return () => {
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('copy:refresh', onRefresh);
    };
  }, [fetchCounts]);

  const switchTab = (id: TabId) => {
    setTab(id);
    try { localStorage.setItem(LS_KEY, id); } catch {}
    document.getElementById('copy-tabs-bar')?.scrollIntoView({ block: 'nearest' });
  };

  if (!mounted) {
    return <div className="copy-tabs-placeholder" />;
  }

  return (
    <div className="copy-tabs-root">
      {/* ── Tab bar ── */}
      <div id="copy-tabs-bar" className="copy-tabs-bar" role="tablist" aria-label="Copy Trading sections">
        {TABS.map((t) => {
          const primary   = t.countKey      ? (counts[t.countKey]      ?? 0) : 0;
          const secondary = t.countKeyTotal ? (counts[t.countKeyTotal] ?? 0) : 0;

          // Show badge when there is at least one item to display
          const showBadge = primary > 0 || secondary > 0;
          // Only show the "/ total" part when the two counts differ and total > 0
          const showSlash = t.countKeyTotal && secondary > 0 && secondary !== primary;

          const isActive = tab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={isActive}
              aria-controls={`copy-tab-panel-${t.id}`}
              id={`copy-tab-${t.id}`}
              className={`copy-tabs-btn${isActive ? ' active' : ''}`}
              onClick={() => switchTab(t.id)}
            >
              {t.label}
              {showBadge && (
                <span className={`copy-tabs-count${isActive ? ' active' : ''}`}>
                  {primary}
                  {showSlash && (
                    <span style={{ opacity: 0.5, fontWeight: 400 }}>/{secondary}</span>
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Tab content panels ── */}
      <div
        id={`copy-tab-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`copy-tab-${tab}`}
        className="copy-tabs-panel"
      >
        {tab === 'overview' && (
          <div className="copy-tabs-overview">
            <CopyOverviewCards />
          </div>
        )}

        {tab === 'wallets' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <TrackedWalletsSection />
            <HotWalletsSection />
          </div>
        )}

        {tab === 'hot' && <HotImportSection />}

        {tab === 'bots' && <CopyBotsSection />}

        {tab === 'attempts' && <CopyAttemptsSection scrollable />}

        {tab === 'positions' && <CopiedPositionsSection scrollable />}

        {tab === 'settings' && (
          <div>
            <GlobalSettingsPanel />
            {/* Master Strategy — advanced template tool, collapsed by default */}
            <details style={{ marginTop: '0.5rem' }}>
              <summary style={{
                fontSize: '0.8rem',
                fontWeight: 600,
                color: 'rgba(248,250,252,0.38)',
                cursor: 'pointer',
                padding: '1rem 0.25rem',
                userSelect: 'none',
                borderTop: '1px solid rgba(255,255,255,0.07)',
                listStyle: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
              }}>
                <span style={{ fontSize: '0.65rem', display: 'inline-block', transition: 'transform 0.15s' }}>▶</span>
                Master Strategy
                <span style={{
                  fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.06em',
                  padding: '0.1em 0.5em', borderRadius: '0.3rem',
                  background: 'rgba(248,250,252,0.06)', color: 'rgba(248,250,252,0.3)',
                  border: '1px solid rgba(248,250,252,0.1)',
                }}>ADVANCED</span>
              </summary>
              <MasterStrategySection />
            </details>
          </div>
        )}
      </div>
    </div>
  );
}
