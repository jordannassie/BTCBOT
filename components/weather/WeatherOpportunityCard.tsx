// WeatherOpportunityCard — Demo card for a single weather market opportunity.
// All displayed data is demonstration-only. No API calls, no order execution.

export interface WeatherOpportunityCardProps {
  city:              string;
  station:           string;
  localTime:         string;
  marketCloses:      string;
  observedHigh:      string;
  forecastHigh:      string;
  likelyBracket:     string;
  estimatedProb:     string;
  marketPrice:       string;
  possibleEdge:      string;
  confidence:        'HIGH' | 'MEDIUM' | 'LOW';
  decision:          'TRADE' | 'WAIT';
  summary:           string;
  evidenceSources:   string[];
}

export default function WeatherOpportunityCard(props: WeatherOpportunityCardProps) {
  const {
    city, station, localTime, marketCloses,
    observedHigh, forecastHigh, likelyBracket,
    estimatedProb, marketPrice, possibleEdge,
    confidence, decision, summary, evidenceSources,
  } = props;

  const confidenceClass = confidence === 'HIGH' ? 'high' : confidence === 'MEDIUM' ? 'medium' : '';
  const decisionClass   = decision === 'TRADE' ? 'trade' : 'wait';

  return (
    <div className="weather-opp-card">

      {/* ── Card head ── */}
      <div className="weather-opp-card-head">
        <div className="weather-opp-city-block">
          <span className="weather-opp-city">{city}</span>
          <span className="weather-opp-station">{station}</span>
        </div>

        <div className="weather-opp-times">
          <span className="weather-opp-time-row">
            <span className="weather-opp-time-label">Local</span>
            {localTime}
          </span>
          <span className="weather-opp-time-row">
            <span className="weather-opp-time-label">Closes</span>
            {marketCloses}
          </span>
        </div>

        <span className={`weather-decision-badge ${decisionClass}`}>
          {decision}
        </span>
      </div>

      {/* ── Card body ── */}
      <div className="weather-opp-card-body">

        {/* Temperature data grid */}
        <div className="weather-opp-data-grid">
          <div className="weather-opp-data-item">
            <span className="weather-opp-data-label">Observed High</span>
            <span className="weather-opp-data-value">{observedHigh}</span>
          </div>
          <div className="weather-opp-data-item">
            <span className="weather-opp-data-label">Forecast High</span>
            <span className="weather-opp-data-value">{forecastHigh}</span>
          </div>
          <div className="weather-opp-data-item">
            <span className="weather-opp-data-label">Likely Bracket</span>
            <span className="weather-opp-data-value">{likelyBracket}</span>
          </div>
          <div className="weather-opp-data-item">
            <span className="weather-opp-data-label">Est. Probability</span>
            <span className="weather-opp-data-value">{estimatedProb}</span>
          </div>
        </div>

        {/* Market data grid */}
        <div className="weather-opp-data-grid">
          <div className="weather-opp-data-item">
            <span className="weather-opp-data-label">Market Price</span>
            <span className="weather-opp-data-value">{marketPrice}</span>
          </div>
          <div className="weather-opp-data-item">
            <span className="weather-opp-data-label">Possible Edge</span>
            <span className={`weather-opp-data-value ${parseFloat(possibleEdge) > 0 ? 'green' : 'muted'}`}>
              {possibleEdge}
            </span>
          </div>
          <div className="weather-opp-data-item">
            <span className="weather-opp-data-label">Confidence</span>
            <span className={`weather-confidence-pill ${confidenceClass}`}>
              {confidence}
            </span>
          </div>
        </div>

        {/* Research summary */}
        <p className="weather-opp-summary">{summary}</p>

        {/* Evidence sources */}
        <div className="weather-opp-evidence">
          <span className="weather-opp-evidence-label">Sources:</span>
          {evidenceSources.map((src) => (
            <span key={src} className="weather-opp-source-pill">{src}</span>
          ))}
        </div>
      </div>

      {/* ── Card footer ── */}
      <div className="weather-opp-card-foot">
        {/* Disabled — does not execute any order or navigate to a live market */}
        <span className="weather-open-market-btn" aria-disabled="true">
          Open Market →
        </span>
        <span className="weather-open-market-btn-note">disabled in preview</span>
      </div>
    </div>
  );
}
