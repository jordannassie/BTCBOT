'use client';

import OperatorControlsTrigger from './OperatorControlsTrigger';

export default function DashboardHeader() {
  return (
    <header className="dashboard-header">
      <div className="header-inner">
        <div className="header-branding">
          <div className="brand-icon"></div>
          <div>
            <p className="brand-eyebrow">BTCBOT</p>
            <h1 className="brand-title">Polymarket Operator Console</h1>
          </div>
        </div>

        <OperatorControlsTrigger />
      </div>
    </header>
  );
}
