'use client';

// Converts the Copy Trading page from a long scroll to a tabbed dashboard.
// The bankroll cards (LiveCard + CopyPaperBankrollCard) live above this
// component, server-rendered. This component owns everything below them.
//
// Tabs: Overview · Wallets · Bots · Attempts · Positions · Settings
//
// UX:
//   - Active tab persisted to localStorage (key: 'btcbot-copy-tab')
//   - Tab counts refreshed from /api/copy/summary on mount
//   - Attempts and Positions tabs get scrollable tables (sticky headers)

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';

// Load section components. All are already client components so no SSR issue.
import CopyOverviewCards from './CopyOverviewCards';
import LiveCopySafetyCard from './LiveCopySafetyCard';

// Dynamic imports let Next.js code-split each tab — keeps initial bundle light.
const TrackedWalletsSection  = dynamic(() => import('./TrackedWalletsSection'));
const CopyBotsSection        = dynamic(() => import('./CopyBotsSection'));
const CopyAttemptsSection    = dynamic(() => import('./CopyAttemptsSection'));
const CopiedPositionsSection = dynamic(() => import('./CopiedPositionsSection'));
const GlobalSettingsPanel    = dynamic(() => import('./GlobalSettingsPanel'));

// ─── Types ────────────────────────────────────────────────────────────────────

type TabId = 'overview' | 'wallets' | 'bots' | 'attempts' | 'positions' | 'settings';

const LS_KEY = 'btcbot-copy-tab';

interface TabDef {
  id: TabId;
  label: string;
  /** key in the summary payload to show as a count badge */
  countKey?: string;
}

const TABS: TabDef[] = [
  { id: 'overview',  label: 'Overview' },
  { id: 'wallets',   label: 'Wallets',   countKey: 'walletsActive' },
  { id: 'bots',      label: 'Bots',      countKey: 'activeBotCount' },
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

  // Fetch tab counts from the summary endpoint
  useEffect(() => {
    fetch('/api/copy/summary', { cache: 'no-store' })
      .then((r) => r.json())
      .then((p) => { if (p.ok) setCounts(p); })
      .catch(() => {});
  }, []);

  const switchTab = (id: TabId) => {
    setTab(id);
    try { localStorage.setItem(LS_KEY, id); } catch {}
    // Scroll tab bar into view on mobile
    document.getElementById('copy-tabs-bar')?.scrollIntoView({ block: 'nearest' });
  };

  if (!mounted) {
    // Avoid hydration mismatch: render nothing until client is ready
    return <div className="copy-tabs-placeholder" />;
  }

  return (
    <div className="copy-tabs-root">
      {/* ── Tab bar ── */}
      <div id="copy-tabs-bar" className="copy-tabs-bar" role="tablist" aria-label="Copy Trading sections">
        {TABS.map((t) => {
          const count = t.countKey ? (counts[t.countKey] ?? 0) : 0;
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
              {count > 0 && (
                <span className={`copy-tabs-count${isActive ? ' active' : ''}`}>
                  {count}
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
            <LiveCopySafetyCard />
          </div>
        )}

        {tab === 'wallets' && <TrackedWalletsSection />}

        {tab === 'bots' && <CopyBotsSection />}

        {/* Attempts and Positions get internal-scroll tables */}
        {tab === 'attempts' && <CopyAttemptsSection scrollable />}

        {tab === 'positions' && <CopiedPositionsSection scrollable />}

        {tab === 'settings' && <GlobalSettingsPanel />}
      </div>
    </div>
  );
}
