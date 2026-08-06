'use client';

// Weather Trading Dashboard — UI Preview Only.
//
// ⚠️  This page contains DEMONSTRATION DATA ONLY.
//     No API calls are made. No trades are placed.
//     No Polymarket, weather API, OpenAI, Supabase, or Railway connections.
//     Controls are disabled — they do not change any backend state.
//
// The purpose of this page is to preview the layout before connecting any
// live data or trading systems.

import WeatherSummaryCards    from '@/components/weather/WeatherSummaryCards';
import WeatherOpportunityCard from '@/components/weather/WeatherOpportunityCard';
import WeatherPositions       from '@/components/weather/WeatherPositions';
import WeatherCallHistory     from '@/components/weather/WeatherCallHistory';
import '@/components/weather/weather.css';

// ─── Demo data — not real observations ────────────────────────────────────────

const DEMO_OPPORTUNITIES = [
  {
    city:            'Dallas',
    station:         'KDFW',
    localTime:       '2:30 PM CDT',
    marketCloses:    '6:00 PM CDT',
    observedHigh:    '99°F',
    forecastHigh:    '99–100°F',
    likelyBracket:   '99–100°F',
    estimatedProb:   '81%',
    marketPrice:     '64¢',
    possibleEdge:    '+17%',
    confidence:      'HIGH' as const,
    decision:        'TRADE' as const,
    summary:
      'Observed high at KDFW already at 99°F with peak heating hours remaining. ' +
      'Multiple NWS and model outputs agree on 99–100°F range. Strong agreement ' +
      'between METAR observation and short-range forecast.',
    evidenceSources: ['NOAA', 'NWS', 'METAR', 'GFS'],
  },
  {
    city:            'New York City',
    station:         'KNYC',
    localTime:       '3:15 PM EDT',
    marketCloses:    '7:00 PM EDT',
    observedHigh:    '87°F',
    forecastHigh:    '88–90°F',
    likelyBracket:   '88–89°F',
    estimatedProb:   '67%',
    marketPrice:     '62¢',
    possibleEdge:    '+5%',
    confidence:      'MEDIUM' as const,
    decision:        'WAIT' as const,
    summary:
      'Observed high at 87°F with forecast calling for 88–90°F. Edge is modest at ' +
      '+5% — insufficient margin given model spread. Waiting for afternoon METAR ' +
      'update before reassessing.',
    evidenceSources: ['NOAA', 'NWS', 'METAR'],
  },
  {
    city:            'London',
    station:         'EGLC',
    localTime:       '8:15 PM BST',
    marketCloses:    '9:00 PM BST',
    observedHigh:    '24°C',
    forecastHigh:    '24–25°C',
    likelyBracket:   '24–25°C',
    estimatedProb:   '76%',
    marketPrice:     '72¢',
    possibleEdge:    '+4%',
    confidence:      'MEDIUM' as const,
    decision:        'WAIT' as const,
    summary:
      'EGLC observation at 24°C. Forecast range is narrow but edge of +4% is thin ' +
      'relative to execution cost. Market closes soon — insufficient time to gather ' +
      'additional confirmation.',
    evidenceSources: ['Met Office', 'METAR', 'ECMWF'],
  },
];

// ─── Controls preview data ─────────────────────────────────────────────────────

function WeatherControlsPreview() {
  return (
    <div className="weather-controls-section">
      <div className="weather-controls-header">
        <span className="weather-controls-title">Controls</span>
        <span className="weather-controls-notice">
          Controls will be activated after the weather research calls are tested.
        </span>
      </div>

      <div className="weather-controls-bar">

        <div className="weather-control-item">
          <span className="weather-control-label">Research Status</span>
          <span className="weather-control-value">OFF</span>
        </div>

        <div className="weather-control-sep" />

        <div className="weather-control-item">
          <span className="weather-control-label">Mode</span>
          <span className="weather-control-value">PAPER</span>
        </div>

        <div className="weather-control-sep" />

        <div className="weather-control-item">
          <span className="weather-control-label">Trade Size</span>
          <span className="weather-control-value">$5</span>
        </div>

        <div className="weather-control-sep" />

        <span className="weather-ctrl-btn" aria-disabled="true">Refresh Markets</span>
        <span className="weather-ctrl-btn" aria-disabled="true">Pause Weather</span>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WeatherDashboardPage() {
  return (
    <div className="dashboard-container weather-page">

      {/* ── Page header ── */}
      <div className="weather-page-header">
        <div className="weather-page-header-left">
          <h1 className="weather-page-title">Weather Trading</h1>
          <p className="weather-page-subtitle">
            Same-day weather markets analyzed using observable public data.
          </p>
        </div>
        <span className="weather-preview-badge">
          UI PREVIEW — NO LIVE DATA OR TRADING
        </span>
      </div>

      {/* ── Summary cards ── */}
      <WeatherSummaryCards />

      {/* ── Controls preview ── */}
      <WeatherControlsPreview />

      {/* ── Opportunity cards ── */}
      <section>
        <div className="weather-opportunities-header">
          <span className="weather-section-label">Weather Opportunities</span>
          <span className="weather-demo-tag">Demo values only — not current facts</span>
        </div>

        <div className="weather-opportunities-grid">
          {DEMO_OPPORTUNITIES.map((opp) => (
            <WeatherOpportunityCard key={opp.city} {...opp} />
          ))}
        </div>
      </section>

      {/* ── Positions ── */}
      <WeatherPositions />

      {/* ── Call history ── */}
      <WeatherCallHistory />

    </div>
  );
}
