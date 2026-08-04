'use client';

// Copy Trading dashboard — accessible at /dashboard/copy for internal/admin use.
//
// Previously the main dashboard at /dashboard. Now behind /dashboard/copy.
// Feature flag NEXT_PUBLIC_SHOW_COPY_UI controls whether a link to this page
// is shown in the main UI, but this page itself is always accessible via URL.
//
// No trading logic in this file. All execution happens in child components and
// their respective API routes.

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import LiveCard from '@/components/dashboard/LiveCard';
import CopyPaperBankrollCard from '@/components/copy/CopyPaperBankrollCard';

const CopyTradingTabs        = dynamic(() => import('@/components/copy/CopyTradingTabs'),        { ssr: false });
const CopyTradingStatusPanel = dynamic(() => import('@/components/copy/CopyTradingStatusPanel'), { ssr: false });

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

export default function CopyTradingPage() {
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing]   = useState(false);
  const [, setTick]                   = useState(0);

  const handleRefresh = () => {
    setRefreshing(true);
    window.dispatchEvent(new CustomEvent('copy:refresh'));
    setTimeout(() => setRefreshing(false), 2_000);
  };

  useEffect(() => {
    const ticker = setInterval(() => setTick((n) => n + 1), 1_000);
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
        {/* ── Left: title + subtitle + back link ── */}
        <div className="copy-page-header-left">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
            <a
              href="/dashboard"
              style={{ fontSize: '0.7rem', color: 'rgba(248,250,252,0.3)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
            >
              ← Crypto Dashboard
            </a>
            <span style={{ color: 'rgba(248,250,252,0.1)' }}>|</span>
            <span style={{ fontSize: '0.7rem', color: 'rgba(248,250,252,0.25)', fontFamily: 'monospace' }}>
              /dashboard/copy
            </span>
          </div>
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

      {/* Bankroll cards */}
      <section className="copy-bankroll-row">
        <LiveCard />
        <CopyPaperBankrollCard />
      </section>

      {/* Consolidated copy trading status panel */}
      <CopyTradingStatusPanel />

      {/* Tabbed layout — includes Crypto Bots tab */}
      <CopyTradingTabs />
    </div>
  );
}
