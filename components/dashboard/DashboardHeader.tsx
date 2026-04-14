'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { APP_NAME } from '@/lib/config';

export default function DashboardHeader() {
  const pathname = usePathname();
  const onStrategies = pathname.startsWith('/dashboard/strategies');

  // Copy Trading is active everywhere except /dashboard/strategies
  const onCopyTrading = !onStrategies;

  return (
    <header className="dashboard-header">
      <div className="header-content">

        {/* Brand */}
        <Link href="/dashboard" className="header-brand">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="brand-icon">
            <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
            <path d="M2 17L12 22L22 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span className="brand-text">{APP_NAME}</span>
          <span className="brand-divider" />
          <span className="brand-product">
            {onStrategies ? 'BTC Strategies' : 'Copy Trading'}
          </span>
        </Link>

        {/* Primary nav */}
        <nav className="header-nav">
          {/* Copy Trading — primary gradient CTA */}
          <Link
            href="/dashboard"
            className={`header-nav-cta${onCopyTrading ? ' active' : ''}`}
          >
            <span className="header-nav-cta-dot" />
            Copy Trading
          </Link>

          {/* BTC Strategies — secondary text link */}
          <Link
            href="/dashboard/strategies"
            className={`header-nav-link${onStrategies ? ' active' : ''}`}
          >
            BTC Strategies
          </Link>
        </nav>

      </div>
    </header>
  );
}
