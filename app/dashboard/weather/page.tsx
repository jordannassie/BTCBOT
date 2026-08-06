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

interface PageState {
  phase:        Phase;
  progressMsg:  string;
  results:      WeatherResearchResult[];
  summary:      ResearchSummary | null;
  errorMsg:     string | null;
  lastRefreshed: string | null;
}

const IDLE_STATE: PageState = {
  phase:        'idle',
  progressMsg:  '',
  results:      [],
  summary:      null,
  errorMsg:     null,
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
        Searches Polymarket for live temperature bracket markets · Fetches real order books ·
        Retrieves public weather data · Runs GPT research
      </p>
      <p className="weather-idle-note">Research only — no orders are placed.</p>
    </div>
  );
}

// ── Error state ───────────────────────────────────────────────────────────────

function ErrorState({ message }: { message: string }) {
  return (
    <div className="weather-error-state">
      <div className="weather-error-icon">⚠</div>
      <p className="weather-error-title">Research encountered an error</p>
      <p className="weather-error-msg">{message}</p>
    </div>
  );
}

// ── No-markets state ──────────────────────────────────────────────────────────

function NoMarketsState() {
  return (
    <div className="weather-no-markets-state">
      <p className="weather-no-markets-title">No eligible temperature markets found on Polymarket today</p>
      <p className="weather-no-markets-sub">
        Searched Polymarket for active same-day temperature bracket markets ending within
        48 hours. None were found. Polymarket may not have launched weather temperature
        markets today. Try again later or tomorrow morning when new markets open.
      </p>
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
      progressMsg: 'Finding weather markets on Polymarket…',
      errorMsg: null,
    }));

    try {
      // ── Step 1: Discover temperature markets ──────────────────────────────
      const marketsRes = await fetch('/api/weather/markets', {
        method: 'GET',
        cache: 'no-store',
      });
      const marketsData: MarketsApiResponse = await marketsRes.json();

      if (!marketsData.ok) {
        throw new Error(`Market discovery failed: ${marketsData.error || 'Unknown error'}`);
      }

      const markets: WeatherMarket[] = marketsData.markets;

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
          lastRefreshed: new Date().toISOString(),
        });
        return;
      }

      // ── Step 2: Fetch order books for all token IDs ───────────────────────
      updatePhase('pricing', 'Reading live order books…');

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
      updatePhase('researching', `Running GPT research (0/${markets.length})…`);

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
        // Show partial results if we have them
        if (researchData.results && researchData.results.length > 0) {
          setState({
            phase: 'partial',
            progressMsg: '',
            results: researchData.results,
            summary: researchData.summary,
            errorMsg: researchData.error,
            lastRefreshed: new Date().toISOString(),
          });
        } else {
          throw new Error(researchData.error || 'Research failed');
        }
        return;
      }

      setState({
        phase: 'complete',
        progressMsg: '',
        results: researchData.results,
        summary: researchData.summary,
        errorMsg: null,
        lastRefreshed: new Date().toISOString(),
      });

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState((prev) => ({
        ...prev,
        phase: 'error',
        progressMsg: '',
        errorMsg: msg,
        lastRefreshed: new Date().toISOString(),
      }));
    }
  }, [updatePhase]);

  const handleClear = useCallback(() => {
    setState(IDLE_STATE);
  }, []);

  const { phase, results, summary, errorMsg, lastRefreshed } = state;
  const showResults = ['complete', 'partial'].includes(phase) && results.length > 0;
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
      {showError           && <ErrorState message={errorMsg!} />}
      {showNoMarkets       && <NoMarketsState />}

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
