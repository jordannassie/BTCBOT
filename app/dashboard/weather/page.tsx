'use client';

// Weather Trading Dashboard — Live Research Mode
//
// This page discovers real same-day Polymarket temperature markets, fetches
// live CLOB order-book prices, retrieves Open-Meteo weather data, and runs
// OpenAI GPT research to produce structured analysis.
//
// NO TRADES ARE PLACED. This is research-only.
// All decisions are labeled "RESEARCH CALL — NOT A TRADE".
//
// Research only runs when the user presses "Refresh Markets".
// No polling, no background loops, no cron jobs.

import { useState, useCallback } from 'react';
import WeatherSummaryCards    from '@/components/weather/WeatherSummaryCards';
import WeatherOpportunityCard from '@/components/weather/WeatherOpportunityCard';
import WeatherPositions       from '@/components/weather/WeatherPositions';
import WeatherLatestResearch  from '@/components/weather/WeatherLatestResearch';
import '@/components/weather/weather.css';

import type {
  WeatherMarket,
  WeatherResearchInput,
  WeatherResearchResult,
  ResearchSummary,
  MarketsApiResponse,
  PricesApiResponse,
  ObservationApiResponse,
  ResearchApiResponse,
  DiscoveryDiagnostics,
} from '@/lib/weather-types';

// ── Page state ────────────────────────────────────────────────────────────────

type Phase =
  | 'idle'
  | 'discovering'
  | 'pricing'
  | 'observing'
  | 'researching'
  | 'complete'
  | 'partial'
  | 'no-markets'
  | 'error';

/** Error category codes for clear UI separation */
type ErrorCategory =
  | 'NO_MARKETS_FOUND'
  | 'DISCOVERY_FAILED'
  | 'PRICE_DATA_FAILED'
  | 'WEATHER_DATA_FAILED'
  | 'OPENAI_MODEL_ERROR'
  | 'OPENAI_AUTH_ERROR'
  | 'OPENAI_RATE_LIMIT'
  | 'OPENAI_RESPONSE_INVALID'
  | 'RESEARCH_COMPLETE'
  | null;

interface PageState {
  phase:         Phase;
  progressMsg:   string;
  results:       WeatherResearchResult[];
  summary:       ResearchSummary | null;
  errorMsg:      string | null;
  errorCategory: ErrorCategory;
  diagnostics:   DiscoveryDiagnostics | null;
  lastRefreshed: string | null;
}

const IDLE_STATE: PageState = {
  phase:         'idle',
  progressMsg:   '',
  results:       [],
  summary:       null,
  errorMsg:      null,
  errorCategory: null,
  diagnostics:   null,
  lastRefreshed: null,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch { return iso; }
}

// ── Controls component ────────────────────────────────────────────────────────

interface ControlsProps {
  phase:         Phase;
  progressMsg:   string;
  lastRefreshed: string | null;
  onRefresh:     () => void;
  onClear:       () => void;
}

function WeatherControls({ phase, progressMsg, lastRefreshed, onRefresh, onClear }: ControlsProps) {
  const isRunning = ['discovering', 'pricing', 'observing', 'researching'].includes(phase);

  const statusLabel =
    phase === 'idle'        ? 'READY' :
    phase === 'discovering' ? 'REFRESHING' :
    phase === 'pricing'     ? 'REFRESHING' :
    phase === 'observing'   ? 'REFRESHING' :
    phase === 'researching' ? 'REFRESHING' :
    phase === 'complete'    ? 'COMPLETE' :
    phase === 'partial'     ? 'PARTIAL' :
    phase === 'no-markets'  ? 'COMPLETE' :
    phase === 'error'       ? 'ERROR' : 'READY';

  const statusCls =
    phase === 'complete'   ? 'weather-status--complete' :
    phase === 'partial'    ? 'weather-status--partial'  :
    phase === 'error'      ? 'weather-status--error'    :
    isRunning              ? 'weather-status--running'  : '';

  return (
    <div className="weather-controls-section weather-controls-section--live">
      <div className="weather-controls-header">
        <span className="weather-controls-title">Controls</span>
        <div className="weather-controls-right">
          <span className={`weather-status-badge ${statusCls}`}>{statusLabel}</span>
          {lastRefreshed && (
            <span className="weather-last-refreshed">
              Last refreshed {fmtTime(lastRefreshed)}
            </span>
          )}
        </div>
      </div>

      <div className="weather-controls-bar">

        <div className="weather-control-item">
          <span className="weather-control-label">Mode</span>
          <span className="weather-control-value weather-control-value--fixed">RESEARCH ONLY</span>
        </div>

        <div className="weather-control-sep" />

        <div className="weather-control-item">
          <span className="weather-control-label">Data sources</span>
          <span className="weather-control-value weather-control-value--fixed">Polymarket · Open-Meteo · GPT</span>
        </div>

        <div className="weather-control-sep" />

        <button
          className={`weather-ctrl-btn weather-ctrl-btn--primary${isRunning ? ' weather-ctrl-btn--loading' : ''}`}
          onClick={onRefresh}
          disabled={isRunning}
          type="button"
        >
          {isRunning ? progressMsg || 'Working…' : 'Refresh Markets'}
        </button>

        <button
          className="weather-ctrl-btn"
          onClick={onClear}
          disabled={isRunning}
          type="button"
        >
          Clear Results
        </button>

      </div>

      {/* Progress bar during research */}
      {isRunning && progressMsg && (
        <div className="weather-progress-row">
          <div className="weather-progress-indicator" />
          <span className="weather-progress-msg">{progressMsg}</span>
        </div>
      )}

      {/* Data labels */}
      <div className="weather-data-labels">
        <span className="weather-data-label-pill">Real public data</span>
        <span className="weather-data-label-pill">Research calls only</span>
        <span className="weather-data-label-pill">No trading connected</span>
      </div>
    </div>
  );
}

// ── Idle state ────────────────────────────────────────────────────────────────

function IdleState() {
  return (
    <div className="weather-idle-state">
      <div className="weather-idle-icon">🌡</div>
      <p className="weather-idle-title">Press Refresh Markets to begin</p>
      <p className="weather-idle-sub">
        Discovers Polymarket temperature events · Reads live order books ·
        Retrieves public weather data · Runs GPT research with web search
      </p>
      <p className="weather-idle-note">Research only — no orders are placed.</p>
    </div>
  );
}

// ── Error state ───────────────────────────────────────────────────────────────

function ErrorState({ message, category }: { message: string; category: ErrorCategory }) {
  const labels: Record<NonNullable<ErrorCategory>, string> = {
    NO_MARKETS_FOUND:       'No Markets Found',
    DISCOVERY_FAILED:       'Discovery Failed',
    PRICE_DATA_FAILED:      'Price Data Failed',
    WEATHER_DATA_FAILED:    'Weather Data Failed',
    OPENAI_MODEL_ERROR:     'OpenAI Model Error',
    OPENAI_AUTH_ERROR:      'OpenAI Auth Error',
    OPENAI_RATE_LIMIT:      'OpenAI Rate Limit',
    OPENAI_RESPONSE_INVALID:'OpenAI Response Invalid',
    RESEARCH_COMPLETE:      'Research Complete',
  };
  const label = category && labels[category] ? `${labels[category]}` : 'Research Error';
  return (
    <div className="weather-error-state">
      <div className="weather-error-icon">⚠</div>
      <p className="weather-error-title">{label}</p>
      <p className="weather-error-msg">{message}</p>
    </div>
  );
}

// ── No-markets state ──────────────────────────────────────────────────────────

function NoMarketsState({ diagnostics }: { diagnostics: DiscoveryDiagnostics | null }) {
  return (
    <div className="weather-no-markets-state">
      <p className="weather-no-markets-title">NO_MARKETS_FOUND — No eligible temperature markets</p>
      <p className="weather-no-markets-sub">
        Searched Polymarket temperature events for today and tomorrow. No active bracket
        markets with executable order books were found. Polymarket may not yet have
        launched temperature markets for these dates. Try again later.
      </p>
      {diagnostics && (
        <details className="weather-diag-details">
          <summary className="weather-diag-summary">Discovery details</summary>
          <DiagnosticsPanel diag={diagnostics} />
        </details>
      )}
    </div>
  );
}

// ── Diagnostics panel ─────────────────────────────────────────────────────────

function DiagnosticsPanel({ diag }: { diag: DiscoveryDiagnostics }) {
  return (
    <div className="weather-diag-panel">
      <table className="weather-diag-table">
        <tbody>
          <tr><td>Events scanned</td><td>{diag.eventsScanned}</td></tr>
          <tr><td>Temperature events matched</td><td>{diag.temperatureEventsMatched}</td></tr>
          <tr><td>Eligible events (with markets)</td><td>{diag.eligibleEvents}</td></tr>
          <tr><td>Nested bracket markets found</td><td>{diag.nestedMarketsFound}</td></tr>
          <tr><td>Eligible bracket markets</td><td>{diag.eligibleMarkets}</td></tr>
        </tbody>
      </table>
      <p className="weather-diag-label">Rejection counts:</p>
      <table className="weather-diag-table">
        <tbody>
          <tr><td>Closed / inactive</td><td>{diag.rejectedCounts.closed}</td></tr>
          <tr><td>Wrong date</td><td>{diag.rejectedCounts.wrongDate}</td></tr>
          <tr><td>Not temperature</td><td>{diag.rejectedCounts.notTemperature}</td></tr>
          <tr><td>Missing tokens</td><td>{diag.rejectedCounts.missingTokens}</td></tr>
          <tr><td>Invalid outcome mapping</td><td>{diag.rejectedCounts.invalidOutcomeMapping}</td></tr>
          <tr><td>Unparseable bracket</td><td>{diag.rejectedCounts.unparseableBracket}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

/** Classify a raw error message into a safe UI category */
function categorizeError(msg: string): ErrorCategory {
  const m = msg.toLowerCase();
  if (m.includes('model_not_found') || m.includes('model not found') || m.includes('does not exist')) return 'OPENAI_MODEL_ERROR';
  if (m.includes('unauthorized') || m.includes('auth') || m.includes('api key') || m.includes('invalid key')) return 'OPENAI_AUTH_ERROR';
  if (m.includes('rate limit') || m.includes('quota') || m.includes('too many requests')) return 'OPENAI_RATE_LIMIT';
  if (m.includes('json') || m.includes('parse') || m.includes('invalid response')) return 'OPENAI_RESPONSE_INVALID';
  if (m.includes('discovery failed') || m.includes('market discovery')) return 'DISCOVERY_FAILED';
  if (m.includes('price') || m.includes('order book') || m.includes('clob')) return 'PRICE_DATA_FAILED';
  if (m.includes('weather') || m.includes('open-meteo') || m.includes('observation')) return 'WEATHER_DATA_FAILED';
  return 'DISCOVERY_FAILED';
}

export default function WeatherDashboardPage() {
  const [state, setState] = useState<PageState>(IDLE_STATE);

  const updatePhase = useCallback((phase: Phase, msg: string) => {
    setState((prev) => ({ ...prev, phase, progressMsg: msg }));
  }, []);

  const handleRefresh = useCallback(async () => {
    setState((prev) => ({
      ...prev,
      phase: 'discovering',
      progressMsg: 'Discovering Polymarket temperature events…',
      errorMsg: null,
      errorCategory: null,
      diagnostics: null,
    }));

    try {
      // ── Step 1: Discover temperature events / bracket markets ─────────────
      let marketsData: MarketsApiResponse;
      try {
        const marketsRes = await fetch('/api/weather/markets', {
          method: 'GET',
          cache: 'no-store',
        });
        if (!marketsRes.ok) {
          const text = await marketsRes.text();
          throw new Error(`Discovery HTTP ${marketsRes.status}: ${text.slice(0, 200)}`);
        }
        marketsData = await marketsRes.json() as MarketsApiResponse;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setState((prev) => ({
          ...prev,
          phase: 'error',
          progressMsg: '',
          errorMsg: msg,
          errorCategory: 'DISCOVERY_FAILED',
          lastRefreshed: new Date().toISOString(),
        }));
        return;
      }

      if (!marketsData.ok) {
        setState((prev) => ({
          ...prev,
          phase: 'error',
          progressMsg: '',
          errorMsg: `DISCOVERY_FAILED: ${marketsData.error || 'Unknown discovery error'}`,
          errorCategory: 'DISCOVERY_FAILED',
          diagnostics: marketsData.diagnostics ?? null,
          lastRefreshed: new Date().toISOString(),
        }));
        return;
      }

      const markets: WeatherMarket[] = marketsData.markets;
      const diagnostics = marketsData.diagnostics ?? null;

      if (markets.length === 0) {
        setState({
          phase: 'no-markets',
          progressMsg: '',
          results: [],
          summary: {
            marketsFound: 0, marketsAnalyzed: 0, qualifiedCalls: 0,
            waitingOrUnavail: 0, lastRefreshed: new Date().toISOString(),
          },
          errorMsg: null,
          errorCategory: 'NO_MARKETS_FOUND',
          diagnostics,
          lastRefreshed: new Date().toISOString(),
        });
        return;
      }

      // ── Step 2: Fetch order books for all token IDs ───────────────────────
      updatePhase('pricing', `Reading live order books for ${markets.length} markets…`);

      const allTokenIds = markets.flatMap((m) => m.tokenIds);
      const pricesRes = await fetch('/api/weather/prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenIds: allTokenIds }),
        cache: 'no-store',
      });
      const pricesData: PricesApiResponse = await pricesRes.json();
      const orderBooks = pricesData.ok ? pricesData.orderBooks : {};

      // ── Step 3: Fetch weather observations ────────────────────────────────
      updatePhase('observing', 'Fetching weather observations…');

      const observations: Record<string, ObservationApiResponse['observation']> = {};
      for (const market of markets) {
        if (market.inferredLat === null || market.inferredLon === null) continue;
        const params = new URLSearchParams({
          lat:  String(market.inferredLat),
          lon:  String(market.inferredLon),
          tz:   market.inferredTimezone || 'UTC',
          city: market.inferredCity     || 'Unknown',
        });
        try {
          const obsRes = await fetch(`/api/weather/observation?${params}`, { cache: 'no-store' });
          const obsData: ObservationApiResponse = await obsRes.json();
          if (obsData.ok && obsData.observation) {
            observations[market.marketId] = obsData.observation;
          }
        } catch { /* Non-fatal — weather data is optional */ }
      }

      // ── Step 4: GPT research ──────────────────────────────────────────────
      updatePhase('researching', `Running GPT research on ${markets.length} markets…`);

      const researchInputs: WeatherResearchInput[] = markets.map((market) => ({
        market,
        orderBooks,
        observation: observations[market.marketId] ?? null,
      }));

      const researchRes = await fetch('/api/weather/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markets: researchInputs }),
        cache: 'no-store',
      });

      const researchData: ResearchApiResponse = await researchRes.json();

      if (!researchData.ok) {
        const errMsg = researchData.error || 'Research failed';
        // Show partial results if we have them
        if (researchData.results && researchData.results.length > 0) {
          setState({
            phase: 'partial',
            progressMsg: '',
            results: researchData.results,
            summary: researchData.summary,
            errorMsg: errMsg,
            errorCategory: categorizeError(errMsg),
            diagnostics,
            lastRefreshed: new Date().toISOString(),
          });
        } else {
          setState((prev) => ({
            ...prev,
            phase: 'error',
            progressMsg: '',
            errorMsg: errMsg,
            errorCategory: categorizeError(errMsg),
            diagnostics,
            lastRefreshed: new Date().toISOString(),
          }));
        }
        return;
      }

      setState({
        phase: 'complete',
        progressMsg: '',
        results: researchData.results,
        summary: researchData.summary,
        errorMsg: null,
        errorCategory: 'RESEARCH_COMPLETE',
        diagnostics,
        lastRefreshed: new Date().toISOString(),
      });

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState((prev) => ({
        ...prev,
        phase: 'error',
        progressMsg: '',
        errorMsg: msg,
        errorCategory: categorizeError(msg),
        lastRefreshed: new Date().toISOString(),
      }));
    }
  }, [updatePhase]);

  const handleClear = useCallback(() => {
    setState(IDLE_STATE);
  }, []);

  const { phase, results, summary, errorMsg, errorCategory, diagnostics, lastRefreshed } = state;
  const showResults   = ['complete', 'partial'].includes(phase) && results.length > 0;
  const showNoMarkets = phase === 'no-markets';
  const showError     = phase === 'error';

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
        <span className="weather-preview-badge weather-preview-badge--live">
          LIVE RESEARCH — NO TRADING CONNECTED
        </span>
      </div>

      {/* ── Summary cards ── */}
      <WeatherSummaryCards summary={summary} />

      {/* ── Controls ── */}
      <WeatherControls
        phase={phase}
        progressMsg={state.progressMsg}
        lastRefreshed={lastRefreshed}
        onRefresh={handleRefresh}
        onClear={handleClear}
      />

      {/* ── Partial warning ── */}
      {phase === 'partial' && errorMsg && (
        <div className="weather-partial-warning">
          ⚠ Partial results — some research steps failed: {errorMsg}
        </div>
      )}

      {/* ── Main content area ── */}
      {phase === 'idle'    && <IdleState />}
      {showError           && <ErrorState message={errorMsg!} category={errorCategory} />}
      {showNoMarkets       && <NoMarketsState diagnostics={diagnostics} />}

      {/* ── Diagnostics (available after any completed run) ── */}
      {showResults && diagnostics && (
        <details className="weather-diag-details">
          <summary className="weather-diag-summary">Discovery details</summary>
          <DiagnosticsPanel diag={diagnostics} />
        </details>
      )}

      {showResults && (
        <section>
          <div className="weather-opportunities-header">
            <span className="weather-section-label">Weather Opportunities</span>
            <span className="weather-demo-tag">Live research · {results.length} analyzed</span>
          </div>

          <div className="weather-opportunities-grid">
            {results.map((result) => (
              <WeatherOpportunityCard key={result.marketId} result={result} />
            ))}
          </div>
        </section>
      )}

      {/* ── Positions (always empty — no trading) ── */}
      <WeatherPositions />

      {/* ── Latest research calls ── */}
      <WeatherLatestResearch results={results} />

    </div>
  );
}
