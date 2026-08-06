'use client';

// WeatherOpportunityCard — Displays a single real Polymarket temperature-bracket
// market with live order-book prices, weather data, and GPT research analysis.
//
// Research calls are clearly labelled. No order execution occurs here.

import type { WeatherResearchResult, ResearchDecision, ResearchConfidence } from '@/lib/weather-types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtPrice(p: number | null): string {
  if (p === null) return '—';
  return `${(p * 100).toFixed(1)}¢`;
}

function fmtEdge(e: number | null): string {
  if (e === null) return '—';
  const pct = (e * 100).toFixed(1);
  return e >= 0 ? `+${pct}pp` : `${pct}pp`;
}

function fmtPct(p: number): string {
  return `${(p * 100).toFixed(0)}%`;
}

function fmtLocalTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    });
  } catch {
    return iso;
  }
}

function fmtEndDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    });
  } catch {
    return iso;
  }
}

// ── Decision badge ────────────────────────────────────────────────────────────

function DecisionBadge({ decision }: { decision: ResearchDecision }) {
  const cls =
    decision === 'TRADE YES' ? 'trade-yes' :
    decision === 'TRADE NO'  ? 'trade-no'  :
    decision === 'WAIT'      ? 'wait'       : 'unavail';

  return (
    <span className={`weather-decision-badge ${cls}`}>
      {decision}
    </span>
  );
}

// ── Confidence pill ───────────────────────────────────────────────────────────

function ConfidencePill({ confidence }: { confidence: ResearchConfidence }) {
  const cls = confidence === 'HIGH' ? 'high' : confidence === 'MEDIUM' ? 'medium' : 'low';
  return <span className={`weather-confidence-pill ${cls}`}>{confidence}</span>;
}

// ── Edge cell ─────────────────────────────────────────────────────────────────

function EdgeCell({ edge }: { edge: number | null }) {
  if (edge === null) return <span className="weather-opp-data-value muted">—</span>;
  const cls = edge >= 0.10 ? 'green' : edge >= 0 ? 'neutral' : 'red';
  return <span className={`weather-opp-data-value ${cls}`}>{fmtEdge(edge)}</span>;
}

// ── Main component ────────────────────────────────────────────────────────────

export interface WeatherOpportunityCardProps {
  result: WeatherResearchResult;
}

export default function WeatherOpportunityCard({ result }: WeatherOpportunityCardProps) {
  const { gpt, observation } = result;

  const stationLabel = gpt.stationCode
    ? `${gpt.stationCode}${gpt.stationVerified ? '' : ' (unverified)'}`
    : 'Station unverified';

  const obsValue = observation
    ? (gpt.temperatureUnit === 'F'
        ? (observation.currentTempF !== null ? `${observation.currentTempF}°F` : '—')
        : (observation.currentTempC !== null ? `${observation.currentTempC}°C` : '—'))
    : '—';

  const forecastRange = gpt.forecastRange
    ? `${gpt.forecastRange.low}–${gpt.forecastRange.high}°${gpt.temperatureUnit}`
    : '—';

  return (
    <div className="weather-opp-card">

      {/* ── Card head ── */}
      <div className="weather-opp-card-head">
        <div className="weather-opp-city-block">
          <span className="weather-opp-city">{gpt.city || 'Unknown City'}</span>
          <span className="weather-opp-station">{stationLabel}</span>
        </div>

        <div className="weather-opp-times">
          {observation?.localTime && (
            <span className="weather-opp-time-row">
              <span className="weather-opp-time-label">Local</span>
              {observation.localTime}
            </span>
          )}
          <span className="weather-opp-time-row">
            <span className="weather-opp-time-label">Closes</span>
            {fmtEndDate(result.endDate)}
          </span>
        </div>

        <DecisionBadge decision={result.finalDecision} />
      </div>

      {/* Research call label */}
      <div className="weather-research-label">
        RESEARCH CALL — NOT A TRADE
      </div>

      {/* ── Card body ── */}
      <div className="weather-opp-card-body">

        {/* Market question */}
        <p className="weather-opp-question">{result.question}</p>

        {/* Temperature data grid */}
        <div className="weather-opp-data-grid">
          <div className="weather-opp-data-item">
            <span className="weather-opp-data-label">Current Obs.</span>
            <span className="weather-opp-data-value">{obsValue}</span>
          </div>
          <div className="weather-opp-data-item">
            <span className="weather-opp-data-label">Forecast Range</span>
            <span className="weather-opp-data-value">{forecastRange}</span>
          </div>
          {gpt.observedHighOrLow !== null && (
            <div className="weather-opp-data-item">
              <span className="weather-opp-data-label">Observed High/Low</span>
              <span className="weather-opp-data-value">
                {gpt.observedHighOrLow}°{gpt.temperatureUnit}
              </span>
            </div>
          )}
          <div className="weather-opp-data-item">
            <span className="weather-opp-data-label">Time Remaining</span>
            <span className="weather-opp-data-value">
              {gpt.remainingRelevantMinutes > 0
                ? `~${Math.round(gpt.remainingRelevantMinutes)} min`
                : '—'}
            </span>
          </div>
        </div>

        {/* Price and edge data */}
        <div className="weather-opp-price-grid">
          <div className="weather-opp-price-col">
            <div className="weather-opp-price-header">YES</div>
            <div className="weather-opp-data-item">
              <span className="weather-opp-data-label">Best Ask</span>
              <span className="weather-opp-data-value">{fmtPrice(result.yesAsk)}</span>
            </div>
            <div className="weather-opp-data-item">
              <span className="weather-opp-data-label">Est. Prob</span>
              <span className="weather-opp-data-value">{fmtPct(gpt.yesProbability)}</span>
            </div>
            <div className="weather-opp-data-item">
              <span className="weather-opp-data-label">Edge</span>
              <EdgeCell edge={result.yesEdge} />
            </div>
          </div>
          <div className="weather-opp-price-divider" />
          <div className="weather-opp-price-col">
            <div className="weather-opp-price-header">NO</div>
            <div className="weather-opp-data-item">
              <span className="weather-opp-data-label">Best Ask</span>
              <span className="weather-opp-data-value">{fmtPrice(result.noAsk)}</span>
            </div>
            <div className="weather-opp-data-item">
              <span className="weather-opp-data-label">Est. Prob</span>
              <span className="weather-opp-data-value">{fmtPct(gpt.noProbability)}</span>
            </div>
            <div className="weather-opp-data-item">
              <span className="weather-opp-data-label">Edge</span>
              <EdgeCell edge={result.noEdge} />
            </div>
          </div>
          <div className="weather-opp-price-conf">
            <div className="weather-opp-data-item">
              <span className="weather-opp-data-label">Confidence</span>
              <ConfidencePill confidence={gpt.confidence} />
            </div>
          </div>
        </div>

        {/* Research summary */}
        {gpt.summary && (
          <p className="weather-opp-summary">{gpt.summary}</p>
        )}

        {/* GPT decision reason */}
        {result.decisionReason && (
          <p className="weather-opp-decision-reason">
            <span className="weather-opp-data-label">Decision basis: </span>
            {result.decisionReason}
          </p>
        )}

        {/* Warnings */}
        {gpt.warnings.length > 0 && (
          <div className="weather-opp-warnings">
            {gpt.warnings.map((w, i) => (
              <div key={i} className="weather-opp-warning-item">⚠ {w}</div>
            ))}
          </div>
        )}

        {/* GPT error */}
        {result.gptError && (
          <div className="weather-opp-gpt-error">
            Research unavailable: {result.gptError.slice(0, 200)}
          </div>
        )}

        {/* Evidence sources */}
        {gpt.supportingEvidence.length > 0 && (
          <div className="weather-opp-evidence">
            <span className="weather-opp-evidence-label">Sources:</span>
            <div className="weather-opp-evidence-list">
              {gpt.supportingEvidence.map((ev, i) => (
                ev.url ? (
                  <a
                    key={i}
                    href={ev.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="weather-opp-source-link"
                    title={ev.finding}
                  >
                    {ev.title || 'Source'}
                  </a>
                ) : (
                  <span key={i} className="weather-opp-source-pill" title={ev.finding}>
                    {ev.title || 'Source'}
                  </span>
                )
              ))}
            </div>
          </div>
        )}

        {/* Timestamps */}
        <div className="weather-opp-timestamps">
          {observation?.dataTimestamp && (
            <span>Weather: {fmtLocalTime(observation.dataTimestamp)}</span>
          )}
          {result.orderBookTimestamp && (
            <span>Order book: {fmtLocalTime(result.orderBookTimestamp)}</span>
          )}
        </div>
      </div>

      {/* ── Card footer ── */}
      <div className="weather-opp-card-foot">
        <a
          href={result.polymarketUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="weather-open-market-btn weather-open-market-btn--live"
        >
          Open Market ↗
        </a>
        <span className="weather-open-market-btn-note">view only — no orders placed</span>
      </div>
    </div>
  );
}
