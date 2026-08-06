// WeatherSummaryCards — Four summary stat cards for the Weather Trading page.
// When summary is provided (after research), shows real values.
// Before research runs, shows dashes.

import type { ResearchSummary } from '@/lib/weather-types';

interface Props {
  summary?: ResearchSummary | null;
}

export default function WeatherSummaryCards({ summary }: Props) {
  const cards = [
    {
      label: 'Markets Found',
      value: summary ? String(summary.marketsFound)    : '—',
    },
    {
      label: 'Markets Analyzed',
      value: summary ? String(summary.marketsAnalyzed) : '—',
    },
    {
      label: 'Qualified Calls',
      value: summary ? String(summary.qualifiedCalls)  : '—',
      highlight: summary && summary.qualifiedCalls > 0,
    },
    {
      label: 'Waiting / Unavail.',
      value: summary ? String(summary.waitingOrUnavail) : '—',
    },
  ];

  return (
    <div className="weather-summary-row">
      {cards.map((card) => (
        <div
          key={card.label}
          className={`weather-summary-card${card.highlight ? ' weather-summary-card--highlight' : ''}`}
        >
          <span className="weather-summary-card-value">{card.value}</span>
          <span className="weather-summary-card-label">{card.label}</span>
        </div>
      ))}
    </div>
  );
}
