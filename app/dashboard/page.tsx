'use client';

// Crypto Trading Dashboard — primary product page.
//
// Feature flags (lib/features.ts):
//   SHOW_COPY_UI    = false → copy trading link is hidden from this page
//   SHOW_CRYPTO_UI  = true  → crypto bots are the primary content
//
// Copy trading dashboard remains accessible at /dashboard/copy regardless of flags.
//
// No trading logic in this file. All execution is in child components.

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { SHOW_COPY_UI } from '@/lib/features';

import LiveCard         from '@/components/dashboard/LiveCard';
import CryptoPaperCard  from '@/components/dashboard/CryptoPaperCard';
import CryptoKPIStrip   from '@/components/dashboard/CryptoKPIStrip';

const Crypto5MinPanel = dynamic(() => import('@/components/dashboard/Crypto5MinPanel'), { ssr: false });

// ── Refresh icon ──────────────────────────────────────────────────────────────

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

// ── Page ─────────────────────────────────────────────────────────────────────

export default function CryptoDashboardPage() {
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
    <div className="dashboard-container crypto-page">

      {/* ── Page header ── */}
      <div className="crypto-page-header">
        <div className="crypto-page-header-left">
          <h1 className="crypto-page-title">Crypto Trading</h1>
          <p className="crypto-page-subtitle">
            BTC 5-Min paper strategy · live bankroll monitoring · real-time market data
          </p>
        </div>
        <div className="crypto-page-header-right">
          <span className="copy-overview-freshness">
            {lastUpdated
              ? `Updated ${fmtAge(lastUpdated)} · 5s auto-refresh`
              : 'Loading…'}
          </span>
          <button
            className="copy-overview-refresh-btn"
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh all data"
            aria-label="Refresh dashboard"
          >
            <IconRefresh />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* ── KPI strip ── */}
      <CryptoKPIStrip />

      {/* ── Hero bankroll area ── */}
      <section className="crypto-bankroll-row">
        <CryptoPaperCard />
        <LiveCard />
      </section>

      {/* ── Crypto Bots section ── */}
      <section className="crypto-bots-section">
        <div className="crypto-section-label">Crypto Bots</div>
        <Crypto5MinPanel />
      </section>

      {/* ── Admin access to Copy Trading (hidden unless SHOW_COPY_UI=true) ── */}
      {SHOW_COPY_UI && (
        <div style={{
          marginTop: '2rem',
          padding: '0.75rem 1rem',
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: '0.5rem',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: '0.72rem', color: 'rgba(248,250,252,0.3)' }}>
            Copy Trading dashboard is active
          </span>
          <a
            href="/dashboard/copy"
            style={{
              fontSize: '0.72rem', fontWeight: 600, color: '#60a5fa',
              textDecoration: 'none', padding: '0.25rem 0.6rem',
              border: '1px solid rgba(96,165,250,0.2)', borderRadius: '0.35rem',
            }}
          >
            Open Copy Trading →
          </a>
        </div>
      )}

      {/* Always-available subtle admin link (no flag dependency) */}
      <div style={{
        marginTop: '1.5rem', textAlign: 'center',
        borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '1rem',
      }}>
        <a
          href="/dashboard/copy"
          style={{ fontSize: '0.62rem', color: 'rgba(248,250,252,0.18)', textDecoration: 'none' }}
          title="Copy Trading dashboard"
        >
          Copy Trading ↗
        </a>
      </div>
    </div>
  );
}
