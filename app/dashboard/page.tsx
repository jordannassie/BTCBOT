'use client';

// The Copy Trading dashboard. All data is fetched client-side by child
// components, so this page is a client component to host the shared refresh
// status header (last-updated timestamp + manual Refresh button).
//
// Refresh timing:
//   - CopyTradingTabs polls /api/copy/summary every 15 s for tab badge counts.
//     After each successful fetch it dispatches 'copy:data-fetched' so this
//     header can update its "Updated X ago" timestamp without a separate fetch.
//   - When the user clicks "Refresh" here, we dispatch 'copy:refresh' and all
//     polling components (CopyTradingTabs, CopyOverviewCards) re-fetch at once.

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import LiveCard from '@/components/dashboard/LiveCard';
import CopyPaperBankrollCard from '@/components/copy/CopyPaperBankrollCard';
import CopyTradingTabs from '@/components/copy/CopyTradingTabs';

const CopyTradingStatusPanel  = dynamic(() => import('@/components/copy/CopyTradingStatusPanel'), { ssr: false });
const Crypto5MinPanel         = dynamic(() => import('@/components/dashboard/Crypto5MinPanel'), { ssr: false });

function IconRefresh() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

function fmtAge(date: Date): string {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 5)  return 'just now';
  if (diff < 60) return `${diff}s ago`;
  return `${Math.floor(diff / 60)}m ago`;
}

export default function DashboardPage() {
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing]   = useState(false);
  const [, setTick]                   = useState(0);

  const handleRefresh = () => {
    setRefreshing(true);
    // Tell all polling child components to re-fetch right now
    window.dispatchEvent(new CustomEvent('copy:refresh'));
    // Reset spinner after a comfortable window for child fetches to complete
    setTimeout(() => setRefreshing(false), 2_000);
  };

  useEffect(() => {
    // Tick every second so the "X ago" string stays live
    const ticker = setInterval(() => setTick((n) => n + 1), 1_000);

    // CopyTradingTabs dispatches this after every successful summary fetch,
    // so we stay in sync without a redundant fetch from this component.
    const onDataFetched = () => setLastUpdated(new Date());
    window.addEventListener('copy:data-fetched', onDataFetched);

    return () => {
      clearInterval(ticker);
      window.removeEventListener('copy:data-fetched', onDataFetched);
    };
  }, []);

  return (
    <div className="dashboard-container copy-page">
      <div className="copy-page-header">
        {/* ── Left: title + subtitle ── */}
        <div className="copy-page-header-left">
          <h1 className="copy-page-title">Copy Trading</h1>
          <p className="copy-page-subtitle">
            Monitor wallets, manage copy bots, and control live execution safely
          </p>
        </div>

        {/* ── Right: last-updated timestamp + manual Refresh button ── */}
        <div className="copy-page-header-right">
          <span className="copy-overview-freshness">
            {lastUpdated
              ? `Updated ${fmtAge(lastUpdated)} · refreshes every 15s`
              : 'Loading…'}
          </span>
          <button
            className="copy-overview-refresh-btn"
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh now"
            aria-label="Refresh dashboard"
          >
            <IconRefresh />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Bankroll cards stay pinned at the top */}
      <section className="copy-bankroll-row">
        <LiveCard />
        <CopyPaperBankrollCard />
      </section>

      {/* Consolidated copy trading status panel */}
      <CopyTradingStatusPanel />

      {/* Crypto 5-Min strategy panel */}
      <Crypto5MinPanel />

      {/* Tabbed layout */}
      <CopyTradingTabs />
    </div>
  );
}
