'use client';

// Weather Research Dashboard — Live Research Mode
//
// Discovers real same-day Polymarket temperature bracket markets,
// fetches live CLOB order-book prices, retrieves Open-Meteo weather data,
// and runs OpenAI GPT research to produce structured analysis.
//
// NO TRADES ARE PLACED. This is research-only.
// Research only runs when the user presses "Refresh Research".

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
  phase: 'idle', progressMsg: '', results: [],
  summary: null, errorMsg: null, errorCategory: null,
  diagnostics: null, lastRefreshed: null,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function zeroSummary(): ResearchSummary {
  return { marketsFound: 0, marketsAnalyzed: 0, qualifiedCalls: 0, waitingOrUnavail: 0, lastRefreshed: new Date().toISOString() };
}

function buildSummary(marketsFound: number, results: WeatherResearchResult[]): ResearchSummary {
  return {
    marketsFound,
    marketsAnalyzed:  results.length,
    qualifiedCalls:   results.filter((r) => r.finalDecision === 'TRADE YES' || r.finalDecision === 'TRADE NO').length,
    waitingOrUnavail: results.filter((r) => r.finalDecision === 'WAIT' || r.finalDecision === 'UNAVAILABLE').length,
    lastRefreshed:    new Date().toISOString(),
  };
}

function categorizeError(msg: string): ErrorCategory {
  const m = msg.toLowerCase();
  if (m.includes('openai_model_error') || m.includes('model not found')) return 'OPENAI_MODEL_ERROR';
  if (m.includes('openai_auth_error')  || m.includes('unauthorized'))    return 'OPENAI_AUTH_ERROR';
  if (m.includes('openai_rate_limit')  || m.includes('rate limit'))      return 'OPENAI_RATE_LIMIT';
  if (m.includes('openai_timeout')     || m.includes('timed out'))       return 'OPENAI_RATE_LIMIT';
  if (m.includes('openai_response_invalid'))                              return 'OPENAI_RESPONSE_INVALID';
  if (m.includes('discovery failed')   || m.includes('market discovery')) return 'DISCOVERY_FAILED';
  if (m.includes('price')             || m.includes('order book'))        return 'PRICE_DATA_FAILED';
  if (m.includes('weather')           || m.includes('observation'))       return 'WEATHER_DATA_FAILED';
  return 'DISCOVERY_FAILED';
}

// Convert an error category to a plain-English sentence
function categoryToPlain(cat: ErrorCategory, raw: string | null): string {
  const r = (raw ?? '').toLowerCase();
  switch (cat) {
    case 'DISCOVERY_FAILED':
      return 'Market discovery failed. Polymarket or network may be temporarily unavailable.';
    case 'NO_MARKETS_FOUND':
      return 'No active temperature markets were found for today or tomorrow. Polymarket may not have launched them yet.';
    case 'PRICE_DATA_FAILED':
      return 'Live order-book prices could not be retrieved. Try refreshing in a moment.';
    case 'WEATHER_DATA_FAILED':
      return 'Current weather data could not be retrieved from Open-Meteo.';
    case 'OPENAI_MODEL_ERROR':
      return 'The GPT research model is not available. Contact the administrator.';
    case 'OPENAI_AUTH_ERROR':
      return 'GPT research is temporarily unavailable because the server connection could not be authorized.';
    case 'OPENAI_RATE_LIMIT':
      if (r.includes('timeout') || r.includes('timed out'))
        return 'GPT research took too long to complete. Try refreshing this market.';
      return 'GPT research hit a rate limit. Try again shortly.';
    case 'OPENAI_RESPONSE_INVALID':
      return 'GPT returned an unusable research response. No decision was made.';
    default:
      return raw ?? 'An unexpected error occurred. Please try again.';
  }
}

/**
 * Safe fetch — always returns parsed JSON.
 * If the server returns HTML (e.g. Netlify 504) returns a safe fallback instead
 * of throwing raw HTML into the UI.
 */
async function safeFetchJson<T>(
  url: string,
  init?: RequestInit,
  fallback?: T,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, cache: 'no-store' });
  } catch (netErr) {
    const msg = netErr instanceof Error ? netErr.message : String(netErr);
    if (fallback !== undefined) return fallback;
    throw new Error(`Network error: ${msg}`);
  }

  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) {
    const snippet = (await res.text()).slice(0, 120).replace(/<[^>]*>/g, '').trim();
    const safeMsg = `HTTP ${res.status} — server returned non-JSON${snippet ? `: ${snippet}` : ''}`;
    if (fallback !== undefined) return fallback;
    throw new Error(safeMsg);
  }

  return res.json() as Promise<T>;
}

// ── Controls ──────────────────────────────────────────────────────────────────

interface ControlsProps {
  phase:         Phase;
  progressMsg:   string;
  lastRefreshed: string | null;
  diagnostics:   DiscoveryDiagnostics | null;
  onRefresh:     () => void;
  onClear:       () => void;
}

function WeatherControls({ phase, progressMsg, lastRefreshed, diagnostics, onRefresh, onClear }: ControlsProps) {
  const isRunning = ['discovering', 'pricing', 'observing', 'researching'].includes(phase);

  const statusLabel =
    isRunning              ? 'Running'   :
    phase === 'complete'   ? 'Complete'  :
    phase === 'partial'    ? 'Partial'   :
    phase === 'no-markets' ? 'Complete'  :
    phase === 'error'      ? 'Error'     : 'Ready';

  const statusCls =
    isRunning            ? 'weather-status-pill--running'  :
    phase === 'complete' ? 'weather-status-pill--complete' :
    phase === 'partial'  ? 'weather-status-pill--partial'  :
    phase === 'error'    ? 'weather-status-pill--error'    :
                           'weather-status-pill--idle';

  return (
    <div className="weather-controls-section">
      <div className="weather-controls-row">
        <div className="weather-controls-left">
          <div className="weather-controls-status">
            <span className={`weather-status-pill ${statusCls}`}>{statusLabel}</span>
            {lastRefreshed && !isRunning && (
              <span className="weather-last-refreshed">
                Last refreshed {fmtTime(lastRefreshed)}
              </span>
            )}
          </div>
        </div>
        <div className="weather-controls-buttons">
          <button
            className="weather-btn weather-btn--primary"
            onClick={onRefresh}
            disabled={isRunning}
            type="button"
          >
            {isRunning ? 'Running…' : 'Refresh Research'}
          </button>
          <button
            className="weather-btn weather-btn--secondary"
            onClick={onClear}
            disabled={isRunning}
            type="button"
          >
            Clear Results
          </button>
        </div>
      </div>

      {/* Progress message */}
      {isRunning && progressMsg && (
        <div className="weather-controls-progress">
          <span className="weather-controls-spinner" />
          {progressMsg}
        </div>
      )}

      {/* Research details collapsible */}
      {(diagnostics || !isRunning) && (
        <details className="weather-details-block">
          <summary className="weather-details-summary">Research details</summary>
          <div className="weather-details-content">
            <div className="weather-diag-grid">
              <span className="weather-diag-key">Data sources</span>
              <span className="weather-diag-value">Polymarket · Open-Meteo · GPT</span>
              <span className="weather-diag-key">Mode</span>
              <span className="weather-diag-value">Research only — no trading</span>
            </div>
            {diagnostics && (
              <div className="weather-diag-grid" style={{ marginTop: '0.75rem' }}>
                <span className="weather-diag-key">Events scanned</span>
                <span className="weather-diag-value">{diagnostics.eventsScanned}</span>
                <span className="weather-diag-key">Temp events matched</span>
                <span className="weather-diag-value">{diagnostics.temperatureEventsMatched}</span>
                <span className="weather-diag-key">Eligible events</span>
                <span className="weather-diag-value">{diagnostics.eligibleEvents}</span>
                <span className="weather-diag-key">Bracket markets found</span>
                <span className="weather-diag-value">{diagnostics.nestedMarketsFound}</span>
                <span className="weather-diag-key">Eligible brackets</span>
                <span className="weather-diag-value">{diagnostics.eligibleMarkets}</span>
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

// ── Idle state ────────────────────────────────────────────────────────────────

function IdleState() {
  return (
    <div className="weather-state-block">
      <span className="weather-state-icon">🌡</span>
      <p className="weather-state-title">Press Refresh Research to begin</p>
      <p className="weather-state-sub">
        Discovers Polymarket temperature events, reads live order books,
        retrieves weather data, and runs GPT analysis with web search.
      </p>
      <p className="weather-state-note">Research only — no orders are placed.</p>
    </div>
  );
}

// ── Error state ───────────────────────────────────────────────────────────────

function ErrorState({ message, category }: { message: string; category: ErrorCategory }) {
  const plain = categoryToPlain(category, message);
  return (
    <div className="weather-state-block weather-state-block--error">
      <span className="weather-state-icon">⚠</span>
      <p className="weather-state-title">Research could not complete</p>
      <div className="weather-error-plain">{plain}</div>
    </div>
  );
}

// ── No-markets state ──────────────────────────────────────────────────────────

function NoMarketsState({ diagnostics }: { diagnostics: DiscoveryDiagnostics | null }) {
  return (
    <div className="weather-state-block weather-state-block--warning">
      <span className="weather-state-icon">📭</span>
      <p className="weather-state-title">No temperature markets found</p>
      <p className="weather-state-sub">
        Searched Polymarket temperature events for today and tomorrow.
        No active bracket markets with executable order books were found.
        Polymarket may not yet have launched temperature markets for these dates.
        Try again later.
      </p>
      {diagnostics && (
        <details className="weather-details-block" style={{ marginTop: '1rem', textAlign: 'left', display: 'inline-block', maxWidth: '40rem' }}>
          <summary className="weather-details-summary">Discovery details</summary>
          <div className="weather-details-content">
            <div className="weather-diag-grid">
              <span className="weather-diag-key">Events scanned</span>
              <span className="weather-diag-value">{diagnostics.eventsScanned}</span>
              <span className="weather-diag-key">Temp events matched</span>
              <span className="weather-diag-value">{diagnostics.temperatureEventsMatched}</span>
              <span className="weather-diag-key">Eligible events</span>
              <span className="weather-diag-value">{diagnostics.eligibleEvents}</span>
              <span className="weather-diag-key">Bracket markets found</span>
              <span className="weather-diag-value">{diagnostics.nestedMarketsFound}</span>
              <span className="weather-diag-key">Eligible brackets</span>
              <span className="weather-diag-value">{diagnostics.eligibleMarkets}</span>
            </div>
          </div>
        </details>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

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
      errorMsg: null, errorCategory: null, diagnostics: null, results: [],
    }));

    try {
      // ── Step 1: Discover temperature bracket markets ──────────────────────
      let marketsData: MarketsApiResponse;
      try {
        marketsData = await safeFetchJson<MarketsApiResponse>('/api/weather/markets');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setState((prev) => ({
          ...prev, phase: 'error', progressMsg: '',
          errorMsg: msg, errorCategory: 'DISCOVERY_FAILED',
          lastRefreshed: new Date().toISOString(),
        }));
        return;
      }

      if (!marketsData.ok) {
        setState((prev) => ({
          ...prev, phase: 'error', progressMsg: '',
          errorMsg: marketsData.error ?? 'Unknown discovery error',
          errorCategory: 'DISCOVERY_FAILED',
          diagnostics: marketsData.diagnostics ?? null,
          lastRefreshed: new Date().toISOString(),
        }));
        return;
      }

      const allMarkets: WeatherMarket[] = marketsData.markets;
      const diagnostics = marketsData.diagnostics ?? null;

      if (allMarkets.length === 0) {
        setState({
          phase: 'no-markets', progressMsg: '', results: [],
          summary: zeroSummary(),
          errorMsg: null, errorCategory: 'NO_MARKETS_FOUND',
          diagnostics, lastRefreshed: new Date().toISOString(),
        });
        return;
      }

      // ── Step 2: Select up to 3 markets — today first ──────────────────────
      const MAX_RESEARCH = 3;
      const todayM    = allMarkets.filter((m) => !m.isTomorrow);
      const tomorrowM = allMarkets.filter((m) =>  m.isTomorrow);
      const researchQueue = [...todayM, ...tomorrowM].slice(0, MAX_RESEARCH);

      updatePhase('pricing', `Reading order books for ${researchQueue.length} market${researchQueue.length !== 1 ? 's' : ''}…`);

      // ── Step 3: Fetch order books ─────────────────────────────────────────
      const allTokenIds = researchQueue.flatMap((m) => m.tokenIds);
      const pricesData = await safeFetchJson<PricesApiResponse>(
        '/api/weather/prices',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tokenIds: allTokenIds }) },
        { ok: false, orderBooks: {}, error: 'Price fetch failed' },
      );
      const orderBooks = pricesData.ok ? pricesData.orderBooks : {};

      // ── Step 4: Fetch weather observations ────────────────────────────────
      updatePhase('observing', 'Fetching weather observations…');
      const observations: Record<string, ObservationApiResponse['observation']> = {};
      for (const market of researchQueue) {
        if (market.inferredLat === null || market.inferredLon === null) continue;
        const params = new URLSearchParams({
          lat:  String(market.inferredLat),
          lon:  String(market.inferredLon),
          tz:   market.inferredTimezone || 'UTC',
          city: market.inferredCity     || 'Unknown',
        });
        try {
          const obsData = await safeFetchJson<ObservationApiResponse>(
            `/api/weather/observation?${params}`, undefined,
            { ok: false, observation: null, error: 'Observation unavailable' },
          );
          if (obsData.ok && obsData.observation) {
            observations[market.marketId] = obsData.observation;
          }
        } catch { /* non-fatal */ }
      }

      // ── Step 5: GPT research — one market per serverless call ─────────────
      const accumulated: WeatherResearchResult[] = [];
      let firstResearchError: string | null = null;

      for (let idx = 0; idx < researchQueue.length; idx++) {
        const market = researchQueue[idx];
        const label  = market.bracketLabel || market.inferredCity || market.question.slice(0, 28);
        updatePhase('researching', `GPT research ${idx + 1}/${researchQueue.length}: ${label}…`);

        const input: WeatherResearchInput = {
          market,
          orderBooks,
          observation: observations[market.marketId] ?? null,
        };

        let researchData: ResearchApiResponse;
        try {
          researchData = await safeFetchJson<ResearchApiResponse>(
            '/api/weather/research',
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ markets: [input] }) },
            { ok: false, results: [], summary: zeroSummary(), error: 'Research server returned non-JSON' },
          );
        } catch (fetchErr) {
          const errMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
          if (!firstResearchError) firstResearchError = errMsg;
          continue;
        }

        if (researchData.ok && researchData.results.length > 0) {
          accumulated.push(...researchData.results);
        } else {
          const errMsg = researchData.error || 'Research failed for this market';
          if (!firstResearchError) firstResearchError = errMsg;
        }

        // Show incremental results after each market
        if (accumulated.length > 0) {
          setState((prev) => ({
            ...prev, phase: 'researching',
            results: [...accumulated],
            summary: buildSummary(allMarkets.length, accumulated),
            diagnostics,
          }));
        }
      }

      // ── Step 6: Final state ───────────────────────────────────────────────
      const finalSummary = buildSummary(allMarkets.length, accumulated);

      if (accumulated.length === 0) {
        const errMsg = firstResearchError ?? 'No research results returned';
        setState((prev) => ({
          ...prev, phase: 'error', progressMsg: '',
          errorMsg: errMsg, errorCategory: categorizeError(errMsg),
          diagnostics, lastRefreshed: new Date().toISOString(),
        }));
        return;
      }

      setState({
        phase: firstResearchError ? 'partial' : 'complete',
        progressMsg: '',
        results: accumulated,
        summary: finalSummary,
        errorMsg:      firstResearchError ?? null,
        errorCategory: firstResearchError ? categorizeError(firstResearchError) : 'RESEARCH_COMPLETE',
        diagnostics,
        lastRefreshed: new Date().toISOString(),
      });

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState((prev) => ({
        ...prev, phase: 'error', progressMsg: '',
        errorMsg: msg, errorCategory: categorizeError(msg),
        lastRefreshed: new Date().toISOString(),
      }));
    }
  }, [updatePhase]);

  const handleClear = useCallback(() => {
    setState(IDLE_STATE);
  }, []);

  const { phase, results, summary, errorMsg, errorCategory, diagnostics, lastRefreshed } = state;

  const showResults   = ['complete', 'partial', 'researching'].includes(phase) && results.length > 0;
  const showNoMarkets = phase === 'no-markets';
  const showError     = phase === 'error';
  const isRunning     = ['discovering', 'pricing', 'observing', 'researching'].includes(phase);

  return (
    <div className="dashboard-container weather-page">

      {/* ── Header ── */}
      <div className="weather-page-header">
        <div className="weather-page-header-left">
          <h1 className="weather-page-title">Weather Research</h1>
          <p className="weather-page-subtitle">
            AI weather research for active Polymarket temperature markets.
          </p>
        </div>
        <span className="weather-badge-research">Research Only · No Trading</span>
      </div>

      {/* ── Summary cards ── */}
      <WeatherSummaryCards summary={summary} />

      {/* ── Controls ── */}
      <WeatherControls
        phase={phase}
        progressMsg={state.progressMsg}
        lastRefreshed={lastRefreshed}
        diagnostics={diagnostics}
        onRefresh={handleRefresh}
        onClear={handleClear}
      />

      {/* ── Partial banner — shown when some markets failed but others succeeded ── */}
      {phase === 'partial' && errorMsg && (
        <div className="weather-partial-banner">
          ⚠ Some research steps did not complete — {categoryToPlain(errorCategory, errorMsg)}
        </div>
      )}

      {/* ── Main content ── */}
      {phase === 'idle'    && <IdleState />}
      {showError           && <ErrorState message={errorMsg!} category={errorCategory} />}
      {showNoMarkets       && <NoMarketsState diagnostics={diagnostics} />}

      {/* ── Opportunity cards — full-width, one per row ── */}
      {showResults && (
        <section>
          <div className="weather-section-header">
            <span className="weather-section-title">Weather Opportunities</span>
            <span className={`weather-section-tag${phase === 'partial' ? ' weather-section-tag--partial' : ''}`}>
              {isRunning ? `Researching…` : `${results.length} analyzed`}
            </span>
          </div>
          <div className="weather-opps-stack">
            {results.map((result) => (
              <WeatherOpportunityCard key={result.marketId} result={result} />
            ))}
          </div>
        </section>
      )}

      {/* ── Positions (always empty — no trading) ── */}
      <WeatherPositions />

      {/* ── Latest research table ── */}
      <WeatherLatestResearch results={results} />

    </div>
  );
}
