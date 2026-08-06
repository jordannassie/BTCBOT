// WeatherLatestResearch — Shows research results from the current refresh.
// Replaces the old demo WeatherCallHistory component.
//
// Research calls are NOT trades and are NOT persisted.
// Clearly states that this is research-only.

import type { WeatherResearchResult, ResearchDecision } from '@/lib/weather-types';

interface Props {
  results: WeatherResearchResult[];
}

function fmtPrice(p: number | null): string {
  if (p === null) return '—';
  return `${(p * 100).toFixed(1)}¢`;
}

function fmtPct(p: number): string {
  return `${(p * 100).toFixed(0)}%`;
}

function DecisionCell({ decision }: { decision: ResearchDecision }) {
  const cls =
    decision === 'TRADE YES' ? 'weather-hist-result-win' :
    decision === 'TRADE NO'  ? 'weather-hist-result-win' :
    decision === 'WAIT'      ? '' :
    'weather-hist-result-pending';
  return <span className={cls}>{decision}</span>;
}

export default function WeatherLatestResearch({ results }: Props) {
  return (
    <section className="weather-history-section">
      <div className="weather-history-header">
        <span className="weather-history-title">Latest Research Calls</span>
        <span className="weather-history-demo-badge">
          Research calls are not trades and are not yet saved as performance history.
        </span>
      </div>

      {results.length === 0 ? (
        <div className="weather-positions-empty">
          No research calls yet. Press Refresh Markets to run live research.
        </div>
      ) : (
        <table className="weather-history-table">
          <thead>
            <tr>
              <th>City</th>
              <th>Contract</th>
              <th>YES Ask</th>
              <th>NO Ask</th>
              <th>Est. YES Prob</th>
              <th>Decision</th>
              <th>Confidence</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.marketId}>
                <td className="weather-hist-cell-city">
                  {r.gpt.city || '—'}
                </td>
                <td>{r.gpt.contract || r.question.slice(0, 50)}</td>
                <td>{fmtPrice(r.yesAsk)}</td>
                <td>{fmtPrice(r.noAsk)}</td>
                <td>{fmtPct(r.gpt.yesProbability)}</td>
                <td><DecisionCell decision={r.finalDecision} /></td>
                <td>
                  <span
                    className={
                      r.gpt.confidence === 'HIGH'   ? 'weather-hist-result-win' :
                      r.gpt.confidence === 'MEDIUM' ? 'weather-hist-result-pending' : ''
                    }
                  >
                    {r.gpt.confidence}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
