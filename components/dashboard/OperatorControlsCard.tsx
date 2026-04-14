// LEGACY — not mounted anywhere in the current dashboard.
// This component was the original operator controls panel, replaced by the
// individual PaperStrategyCard and PaperCandleBiasCard components.
// Safe to delete once confirmed no longer needed.
export default function OperatorControlsCard() {
  return (
    <div className="profile-card operator-card">
      <div className="operator-header">
        <h3>Legacy Operator Controls</h3>
        <p className="operator-subtitle error">
          Disabled – use the PAPER FASTLOOP / PAPER SNIPER cards above instead.
        </p>
      </div>
    </div>
  );
}
