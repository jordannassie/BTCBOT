// Static safety information card shown at the top of /dashboard/copy.
// No API calls — purely informational. Helps operators understand live copy requirements.

function Check() {
  return (
    <svg className="copy-safety-card-req-icon" width="14" height="14" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );
}

export default function LiveCopySafetyCard() {
  return (
    <div className="copy-safety-card">
      <div className="copy-safety-card-icon">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
      </div>

      <div className="copy-safety-card-body">
        <div className="copy-safety-card-title">Live Copy — Safety Requirements</div>
        <div className="copy-safety-card-reqs">
          <div className="copy-safety-card-req">
            <Check />
            <span><strong>PAPER mode</strong> is the default and executes no real orders — safe for testing strategy and sizing.</span>
          </div>
          <div className="copy-safety-card-req">
            <Check />
            <span>For a bot to place <strong>real live orders</strong>, all five gates must be open simultaneously:</span>
          </div>
          <div className="copy-safety-card-req" style={{ paddingLeft: '1.25rem' }}>
            <Check />
            <span><strong>Bot mode = LIVE</strong> — set on the individual bot</span>
          </div>
          <div className="copy-safety-card-req" style={{ paddingLeft: '1.25rem' }}>
            <Check />
            <span><strong>Bot is Enabled</strong> — is_enabled toggle is on</span>
          </div>
          <div className="copy-safety-card-req" style={{ paddingLeft: '1.25rem' }}>
            <Check />
            <span><strong>ARM LIVE is on</strong> — secondary per-bot safety gate</span>
          </div>
          <div className="copy-safety-card-req" style={{ paddingLeft: '1.25rem' }}>
            <Check />
            <span><strong>Global Live Trading Gate = ON</strong> — master switch in Global Settings</span>
          </div>
          <div className="copy-safety-card-req" style={{ paddingLeft: '1.25rem' }}>
            <Check />
            <span><strong>Emergency Stop = Inactive</strong> — if active, all live execution is halted immediately</span>
          </div>
          <div className="copy-safety-card-req">
            <Check />
            <span>The <strong>Live Status</strong> column on each bot shows its current readiness: <em>Paper Only / Live Blocked / Live Ready / Live Stopped</em>.</span>
          </div>
        </div>
        <div className="copy-safety-card-note">
          Activating Emergency Stop overrides everything — use it any time you need to immediately pause all live copy activity.
          Re-enable the Global Live Gate carefully after verifying bot state.
        </div>
      </div>
    </div>
  );
}
