// WeatherLatestResearch — Compact summary table of current research calls.
// Research calls are NOT trades and are NOT persisted between sessions.

import type { WeatherResearchResult } from '@/lib/weather-types';

interface Props {
  results: WeatherResearchResult[];
}

function fmtPrice(p: number | null): string {
  if (p === null) return '—';
  return `${(p * 100).toFixed(0)}¢`;
}

function fmtProb(p: number, failed: boolean): string {
  if (failed || p === 0) return '—';
  return `${(p * 100).toFixed(0)}%`;
}

function decisionCls(decision: string, failed: boolean): string {
  if (failed) return 'weather-hist-decision--unavail';
  if (decision === 'TRADE YES') return 'weather-hist-decision--yes';
  if (decision === 'TRADE NO')  return 'weather-hist-decision--no';
  if (decision === 'WAIT')      return 'weather-hist-decision--wait';
  return 'weather-hist-decision--unavail';
}

export default function WeatherLatestResearch({ results }: Props) {
  return (
    <section className="weather-history-section">
      <div className="weather-history-header">
        <span className="weather-history-title">Latest Research Calls</span>
        <span className="weather-history-note">
          Research only — not trades — not saved between sessions
        </span>
      </div>

      {results.length === 0 ? (
        <div className="weather-history-empty">
          No research calls yet. Press Refresh Research to begin.
        </div>
      ) : (
        <table className="weather-history-table">
          <thead>
            <tr>
              <th>City</th>
              <th>Bracket</th>
              <th>YES Ask</th>
              <th>Est. Prob</th>
              <th>Decision</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => {
              const failed = r.gptError !== null;
              return (
                <tr key={r.marketId}>
                  <td>{r.gpt.city || '—'}</td>
                  <td>{r.bracketLabel || '—'}</td>
                  <td>{fmtPrice(r.yesAsk)}</td>
                  <td>{fmtProb(r.gpt.yesProbability, failed)}</td>
                  <td>
                    <span className={decisionCls(r.finalDecision, failed)}>
                      {failed ? 'Research Failed' : r.finalDecision}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
