import Link from 'next/link';
import { APP_NAME } from '@/lib/config';

// BTC Strategies nav link removed — Copy Trading is the only product.
// No longer a client component — pathname detection is no longer needed.

export default function DashboardHeader() {
  return (
    <header className="dashboard-header">
      <div className="header-content">

        {/* Brand — always links to Copy Trading home */}
        <Link href="/dashboard" className="header-brand">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="brand-icon">
            <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
            <path d="M2 17L12 22L22 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span className="brand-text">{APP_NAME}</span>
          <span className="brand-divider" />
          <span className="brand-product">Copy Trading</span>
        </Link>

      </div>
    </header>
  );
}
