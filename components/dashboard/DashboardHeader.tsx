'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { APP_NAME } from '@/lib/config';

// Navigation note:
//   - "Crypto Trading" links to /dashboard (primary product page)
//   - "Weather" links to /dashboard/weather (UI preview — no live data)
//   - Copy Trading (/dashboard/copy) remains hidden from the nav bar.
//     It is always directly accessible by URL regardless of this nav.

export default function DashboardHeader() {
  const pathname = usePathname() ?? '';
  const isWeather = pathname.startsWith('/dashboard/weather');

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
        </Link>

        {/* Primary navigation — Copy Trading link deliberately excluded */}
        <nav className="header-nav">
          <Link
            href="/dashboard"
            className={`header-nav-link${!isWeather ? ' active' : ''}`}
          >
            Crypto Trading
          </Link>
          <Link
            href="/dashboard/weather"
            className={`header-nav-link${isWeather ? ' active' : ''}`}
          >
            Weather
          </Link>
        </nav>

      </div>
    </header>
  );
}
