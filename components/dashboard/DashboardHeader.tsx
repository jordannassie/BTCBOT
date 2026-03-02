'use client';

import Link from 'next/link';

export default function DashboardHeader() {
  return (
    <header className="dashboard-header">
      <div className="header-content">
        <Link href="/dashboard" className="header-brand">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="brand-icon">
            <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
            <path d="M2 17L12 22L22 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span>BTCBOT</span>
        </Link>

        <div className="header-search">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M11 11L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input type="text" placeholder="Search markets..." disabled />
        </div>

        <div className="header-actions">
          <button className="header-btn secondary">How it works</button>
          <button className="header-btn secondary">Log In</button>
          <button className="header-btn primary">Sign Up</button>
        </div>
      </div>
    </header>
  );
}
