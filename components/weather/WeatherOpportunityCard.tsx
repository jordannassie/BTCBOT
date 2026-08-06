'use client';

// WeatherOpportunityCard v2
//
// Full-width horizontal card.  One card per research result.
// Decision badge is the most prominent element.
// Plain-English explanation sentence below the header.
// Shows "—" for probabilities / edge when GPT research failed.
// Single error message — no duplication.
//
// No order execution.  Research only.

import type { WeatherResearchResult } from '@/lib/weather-types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtLocalTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    });
  } catch { return iso; }
}

function fmtEndDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    });
  } catch { return iso; }
}

function fmtPriceStr(p: number | null): string {
  if (p === null) return '—';
  return `${(p * 100).toFixed(0)}¢`;
}

function fmtProbStr(p: number | null, failed: boolean): string {
  if (failed || p === null) return '—';
  // Suppress 0% when research failed — never imply a real zero estimate
  if (p === 0) return '—';
  return `${(p * 100).toFixed(0)}%`;
}

function fmtEdgeStr(e: number | null, failed: boolean): string {
  if (failed || e === null) return '—';
  const pp = (e * 100).toFixed(1);
  return e >= 0 ? `+${pp}pp` : `${pp}pp`;
}

function edgeColorClass(e: number | null, failed: boolean): string {
  if (failed || e === null) return 'woc-metric-value--muted';
  if (e >= 0.10) return 'woc-metric-value--green';
  if (e >= 0)    return '';
  return 'woc-metric-value--red';
}

// Convert raw gptError code prefix to plain English for the UI.
// Technical details are available in the collapsible section below.
function gptErrorToPlain(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes('openai_timeout') || s.includes('timed out') || s.includes('timeout'))
    return 'GPT research took too long to complete. Try refreshing this market.';
  if (s.includes('openai_auth_error') || s.includes('unauthorized') || s.includes('api key'))
    return 'GPT research is temporarily unavailable because the server connection could not be authorized.';
  if (s.includes('openai_rate_limit') || s.includes('rate limit') || s.includes('quota'))
    return 'GPT research hit a rate limit. Try again shortly.';
  if (s.includes('openai_model_error') || s.includes('model not found') || s.includes('model_not_found'))
    return 'GPT model is not available. Contact the administrator.';
  if (s.includes('openai_response_invalid') || s.includes('no json') || s.includes('unexpected token'))
    return 'GPT returned an unusable research response. No decision was made.';
  if (s.includes('no executable') || s.includes('order-book ask'))
    return 'No executable ask price is available for this market.';
  return 'GPT research could not complete. No decision was made.';
}

// Build one plain-English explanation sentence for the card.
function buildExplanation(result: WeatherResearchResult, researchFailed: boolean): string {
  if (researchFailed) return gptErrorToPlain(result.gptError ?? 'Research unavailable');

  const decision = result.finalDecision;
  const reason   = result.decisionReason ?? '';
  const yesProb  = result.gpt.yesProbability;
  const yesEdge  = result.yesEdge;

  if (decision === 'UNAVAILABLE') {
    if (reason.toLowerCase().includes('order')) return 'No executable ask price is available for this market.';
    return 'Research could not produce a decision — ' + reason.toLowerCase() + '.';
  }

  if (decision === 'TRADE YES') {
    const prob = Math.round(yesProb * 100);
    const edge = yesEdge !== null ? `+${(yesEdge * 100).toFixed(1)}pp` : '';
    return `TRADE YES — Estimated probability is ${prob}%${edge ? ` with ${edge} positive edge` : ''}.`;
  }

  if (decision === 'TRADE NO') {
    const prob  = Math.round((1 - yesProb) * 100);
    const nedge = result.noEdge;
    const edge  = nedge !== null ? `+${(nedge * 100).toFixed(1)}pp` : '';
    return `TRADE NO — Estimated NO probability is ${prob}%${edge ? ` with ${edge} positive edge` : ''}.`;
  }

  // WAIT — extract specific reason
  if (reason) {
    // Convert the technical reason to readable English
    const parts: string[] = [];
    if (reason.includes('probability') && reason.match(/(\d+)%.*<.*80%/)) {
      const m = reason.match(/YES probability (\d+)%/i);
      const prob = m ? m[1] : '?';
      parts.push(`estimated probability is ${prob}%, below the required 80%`);
    }
    if (reason.includes('edge') && reason.includes('< 10pp')) {
      const m = reason.match(/YES edge ([\d.]+pp)/i);
      const e = m ? m[1] : '';
      if (e) parts.push(`positive edge is ${e}, below the required 10pp`);
    }
    if (reason.includes('station not verified')) parts.push('the settlement station has not been verified');
    if (reason.includes('resolution rules not verified')) parts.push('resolution rules could not be confirmed');
    if (reason.includes('critical warning')) parts.push('a critical data warning was present');

    if (parts.length > 0) return `WAIT — ${parts.join('; ')}.`;
    return `WAIT — ${reason}.`;
  }

  return 'WAIT — insufficient evidence to make a confident call.';
}

// Research status one-liner
function researchStatusLabel(result: WeatherResearchResult, researchFailed: boolean): { text: string; dot: 'ok' | 'wait' | 'fail' | 'neutral' } {
  if (!result.hasOrderBook)       return { text: 'No executable market price',         dot: 'neutral' };
  if (researchFailed) {
    const e = (result.gptError ?? '').toLowerCase();
    if (e.includes('timeout') || e.includes('timed out')) return { text: 'Research timed out',             dot: 'fail' };
    if (e.includes('auth') || e.includes('api key'))      return { text: 'Research authorization failed',  dot: 'fail' };
    if (e.includes('rate limit') || e.includes('quota'))  return { text: 'Research rate limit hit',        dot: 'fail' };
    if (e.includes('model'))                              return { text: 'Research model unavailable',     dot: 'fail' };
    return { text: 'Research response invalid', dot: 'fail' };
  }
  if (result.finalDecision === 'TRADE YES' || result.finalDecision === 'TRADE NO')
    return { text: 'Research completed', dot: 'ok' };
  if (result.finalDecision === 'WAIT')
    return { text: 'Research completed — waiting for stronger signal', dot: 'wait' };
  return { text: 'Research completed — market unavailable', dot: 'neutral' };
}

// ── Decision badge CSS class ──────────────────────────────────────────────────

function decisionBadgeCls(decision: string, failed: boolean): string {
  if (failed) return 'woc-decision--failed';
  if (decision === 'TRADE YES') return 'woc-decision--yes';
  if (decision === 'TRADE NO')  return 'woc-decision--no';
  if (decision === 'WAIT')      return 'woc-decision--wait';
  return 'woc-decision--unavail';
}

function decisionBadgeLabel(decision: string, failed: boolean): string {
  if (failed) return 'Research Failed';
  return decision;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function WeatherOpportunityCard({ result }: { result: WeatherResearchResult }) {
  const { gpt, observation } = result;

  // KEY data-honesty gate: if GPT errored, do not display its zero-valued fields
  const researchFailed = result.gptError !== null;

  const displayDecision = result.finalDecision;
  const badgeCls   = decisionBadgeCls(displayDecision, researchFailed);
  const badgeLabel = decisionBadgeLabel(displayDecision, researchFailed);

  const explanation = buildExplanation(result, researchFailed);
  const status      = researchStatusLabel(result, researchFailed);

  // Temperature display
  const currentTemp = observation
    ? (gpt.temperatureUnit === 'F'
        ? (observation.currentTempF !== null ? `${observation.currentTempF}°F` : '—')
        : (observation.currentTempC !== null ? `${observation.currentTempC}°C` : '—'))
    : '—';

  const forecastRange = (() => {
    if (researchFailed || !gpt.forecastRange) {
      // Fall back to Open-Meteo model data when GPT couldn't verify
      if (observation?.forecastMaxF !== null && observation?.forecastMaxF !== undefined) {
        return `${observation.forecastMinF ?? '?'}–${observation.forecastMaxF}°F`;
      }
      return '—';
    }
    return `${gpt.forecastRange.low}–${gpt.forecastRange.high}°${gpt.temperatureUnit}`;
  })();

  const stationLabel = gpt.stationCode
    ? `${gpt.stationCode}${gpt.stationVerified ? ' ✓' : ''}`
    : (researchFailed ? 'Station unknown' : 'Station unverified');

  const yesProb  = fmtProbStr(gpt.yesProbability, researchFailed);
  const yesEdge  = fmtEdgeStr(result.yesEdge,     researchFailed);
  const edgeCls  = edgeColorClass(result.yesEdge,  researchFailed);

  // Warnings to show — only when research succeeded and warnings are meaningful
  const meaningfulWarnings = researchFailed ? [] : gpt.warnings.filter(
    (w) => !w.toLowerCase().includes('research error:') // don't re-show gptError
  );

  return (
    <div className="woc">

      {/* ── Top: market info + decision ── */}
      <div className="woc-top">
        <div className="woc-market-info">
          <span className="woc-city">{gpt.city || result.parentEventTitle || 'Unknown City'}</span>
          {result.bracketLabel && (
            <span className="woc-bracket">{result.bracketLabel}</span>
          )}
          <div className="woc-meta-row">
            <span className="woc-meta">{stationLabel}</span>
            <span className="woc-meta-sep">·</span>
            <span className="woc-meta">Closes {fmtEndDate(result.endDate)}</span>
            {result.isTomorrow && <span className="woc-tomorrow-badge">Tomorrow</span>}
          </div>
        </div>

        <span className={`woc-decision ${badgeCls}`}>{badgeLabel}</span>
      </div>

      {/* ── Explanation sentence ── */}
      <div className="woc-explanation">
        {explanation}
      </div>

      {/* ── Key metrics ── */}
      <div className="woc-metrics">
        <div className="woc-metric">
          <span className="woc-metric-label">Current Temp</span>
          <span className="woc-metric-value">{currentTemp}</span>
        </div>
        <div className="woc-metric">
          <span className="woc-metric-label">Forecast</span>
          <span className="woc-metric-value">{forecastRange}</span>
        </div>
        <div className="woc-metric">
          <span className="woc-metric-label">YES Price</span>
          <span className="woc-metric-value">{fmtPriceStr(result.yesAsk)}</span>
        </div>
        <div className="woc-metric">
          <span className="woc-metric-label">Est. YES Prob</span>
          <span className={`woc-metric-value ${yesProb === '—' ? 'woc-metric-value--muted' : ''}`}>{yesProb}</span>
        </div>
        <div className="woc-metric">
          <span className="woc-metric-label">Edge</span>
          <span className={`woc-metric-value ${edgeCls}`}>{yesEdge}</span>
        </div>
        {!researchFailed && gpt.remainingRelevantMinutes > 0 && (
          <div className="woc-metric">
            <span className="woc-metric-label">Time Remaining</span>
            <span className="woc-metric-value">~{Math.round(gpt.remainingRelevantMinutes)} min</span>
          </div>
        )}
      </div>

      {/* ── Status line ── */}
      <div className="woc-status-row">
        <span className={`woc-status-dot woc-status-dot--${status.dot}`} />
        {status.text}
      </div>

      {/* ── Sources (only when research succeeded and evidence exists) ── */}
      {!researchFailed && gpt.supportingEvidence.length > 0 && (
        <div className="woc-sources">
          <span className="woc-sources-label">Sources used</span>
          <div className="woc-sources-list">
            {gpt.supportingEvidence.map((ev, i) =>
              ev.url ? (
                <a
                  key={i}
                  href={ev.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="woc-source-link"
                  title={ev.finding}
                >
                  {ev.title || 'Source'}
                </a>
              ) : null
            )}
          </div>
        </div>
      )}

      {/* ── Footer ── */}
      <div className="woc-footer">
        <div className="woc-footer-timestamps">
          {observation?.dataTimestamp && (
            <span className="woc-footer-ts">Weather: {fmtLocalTime(observation.dataTimestamp)}</span>
          )}
          {result.orderBookTimestamp && (
            <span className="woc-footer-ts">Order book: {fmtLocalTime(result.orderBookTimestamp)}</span>
          )}
        </div>
        <div className="woc-footer-right">
          <a
            href={result.polymarketUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="woc-open-btn"
          >
            Open Polymarket ↗
          </a>
          <span className="woc-no-trade-note">Research only — no order placed</span>
        </div>
      </div>

      {/* ── Technical details (collapsible — not shown by default) ── */}
      {(researchFailed || meaningfulWarnings.length > 0) && (
        <details className="woc-tech-details">
          <summary className="woc-tech-summary">Technical details</summary>
          <div className="woc-tech-body">
            {result.gptError && (
              <div className="woc-tech-item">
                <span className="woc-tech-key">Error code</span>
                <span className="woc-tech-val">{result.gptError.slice(0, 300)}</span>
              </div>
            )}
            {meaningfulWarnings.map((w, i) => (
              <div key={i} className="woc-tech-item">
                <span className="woc-tech-key">Warning {i + 1}</span>
                <span className="woc-tech-val">{w}</span>
              </div>
            ))}
            <div className="woc-tech-item">
              <span className="woc-tech-key">Market ID</span>
              <span className="woc-tech-val">{result.marketId}</span>
            </div>
            <div className="woc-tech-item">
              <span className="woc-tech-key">Analyzed at</span>
              <span className="woc-tech-val">{result.analyzedAt}</span>
            </div>
          </div>
        </details>
      )}

    </div>
  );
}
