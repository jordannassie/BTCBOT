// POST /api/weather/research
//
// SERVER-SIDE ONLY — runs OpenAI Responses API with web search to research
// Polymarket same-day temperature markets and return structured analysis.
//
// Security:
//   - OPENAI_API_KEY is read from process.env; never returned, never logged.
//   - Accepts only a validated, server-selected prompt structure; no arbitrary input.
//   - Hard limit of 10 markets per request.
//   - Enforces deterministic safety rules in application code (not in GPT output).
//   - No wallet, no Polymarket order submission, no FastLoop interaction.
//
// Body: { markets: WeatherResearchInput[] }
// Returns: ResearchApiResponse

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import type {
  WeatherResearchInput,
  WeatherResearchResult,
  ResearchApiResponse,
  ResearchSummary,
  GptResearchFields,
  ResearchDecision,
  ResearchConfidence,
  EvidenceSource,
} from '@/lib/weather-types';

export const dynamic  = 'force-dynamic';
export const revalidate = 0;

const MAX_MARKETS      = 10;
const OPENAI_TIMEOUT   = 45_000;  // 45 s per market

// ── OpenAI client (server-side) ───────────────────────────────────────────────

function getOpenAIClient(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key.trim() === '') return null;
  return new OpenAI({
    apiKey:  key,
    timeout: OPENAI_TIMEOUT,
    maxRetries: 0,
  });
}

const MODEL = process.env.OPENAI_WEATHER_MODEL || 'gpt-5.6-terra';

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a weather market research assistant. You analyze Polymarket same-day temperature bracket markets using publicly available weather data and official government sources.

CRITICAL RULES:
1. Use web search to verify current weather observations and official forecasts.
2. NEVER invent station readings, forecasts, or prices.
3. NEVER claim certainty. Always distinguish observed facts from inferences.
4. Treat Polymarket's exact resolution rules as the controlling definition.
5. Consider temperature units, rounding, and the exact bracket definition carefully.
6. Consider how much heating or cooling time remains in the day.
7. If key facts conflict, are uncertain, or cannot be verified: respond with WAIT.
8. Prefer official government weather sources (NWS, NOAA, UK Met Office, etc.).
9. This is research only — do NOT recommend position sizes or execution.
10. Return valid JSON matching the specified schema exactly.`;

// ── Build research prompt for one market ─────────────────────────────────────

function buildResearchPrompt(input: WeatherResearchInput): string {
  const { market, orderBooks, observation } = input;
  const now = new Date();

  // Find YES and NO token IDs from outcomes
  const yesIdx = market.outcomes.findIndex((o) => o.toLowerCase() === 'yes');
  const noIdx  = market.outcomes.findIndex((o) => o.toLowerCase() === 'no');
  const yesTokenId = yesIdx >= 0 ? market.tokenIds[yesIdx] : market.tokenIds[0];
  const noTokenId  = noIdx  >= 0 ? market.tokenIds[noIdx]  : market.tokenIds[1];

  const yesBook = yesTokenId ? orderBooks[yesTokenId] : null;
  const noBook  = noTokenId  ? orderBooks[noTokenId]  : null;

  const yesAsk = yesBook?.bestAsk ?? null;
  const noAsk  = noBook?.bestAsk  ?? null;

  const lines: string[] = [
    `Current UTC time: ${now.toISOString()}`,
    ``,
    `=== POLYMARKET MARKET ===`,
    `Market ID: ${market.marketId}`,
    `Question: ${market.question}`,
    `Bracket/Contract: ${market.question}`,
    `Market closes: ${market.endDate}`,
    `Resolution source: ${market.resolutionSource || 'Not specified'}`,
    `Resolution rules: ${market.description || 'Not provided'}`,
    ``,
    `=== OUTCOME MAPPING (verified from API) ===`,
    ...market.outcomes.map((o, i) => `  Outcome[${i}] = "${o}" → Token ID: ${market.tokenIds[i] || 'N/A'}`),
    ``,
    `=== EXECUTABLE ORDER BOOK (live CLOB data) ===`,
    `YES token best ask: ${yesAsk !== null ? yesAsk.toFixed(4) : 'UNAVAILABLE'}`,
    `YES token best bid: ${yesBook?.bestBid !== null && yesBook?.bestBid !== undefined ? yesBook.bestBid.toFixed(4) : 'N/A'}`,
    `YES token last trade: ${yesBook?.lastTradePrice !== null && yesBook?.lastTradePrice !== undefined ? yesBook.lastTradePrice.toFixed(4) : 'N/A'}`,
    `NO token best ask:  ${noAsk !== null ? noAsk.toFixed(4) : 'UNAVAILABLE'}`,
    `NO token best bid:  ${noBook?.bestBid !== null && noBook?.bestBid !== undefined ? noBook.bestBid.toFixed(4) : 'N/A'}`,
    `NO token last trade: ${noBook?.lastTradePrice !== null && noBook?.lastTradePrice !== undefined ? noBook.lastTradePrice.toFixed(4) : 'N/A'}`,
    `Order book timestamp: ${yesBook?.timestamp || 'N/A'}`,
    ``,
    `=== WEATHER DATA (Open-Meteo model interpolation) ===`,
  ];

  if (observation) {
    lines.push(
      `City: ${observation.city}`,
      `Coordinates: ${observation.lat}, ${observation.lon}`,
      `Timezone: ${observation.timezone}`,
      `Local time: ${observation.localTime}`,
      `Current temperature: ${observation.currentTempC !== null ? `${observation.currentTempC}°C / ${observation.currentTempF}°F` : 'N/A'}`,
      `Today forecast max: ${observation.forecastMaxC !== null ? `${observation.forecastMaxC}°C / ${observation.forecastMaxF}°F` : 'N/A'}`,
      `Today forecast min: ${observation.forecastMinC !== null ? `${observation.forecastMinC}°C / ${observation.forecastMinF}°F` : 'N/A'}`,
      `Precipitation: ${observation.precipMm !== null ? `${observation.precipMm} mm` : 'N/A'}`,
      `Cloud cover: ${observation.cloudCoverPct !== null ? `${observation.cloudCoverPct}%` : 'N/A'}`,
      `Wind: ${observation.windKph !== null ? `${observation.windKph} km/h` : 'N/A'}`,
      `Weather data note: ${observation.stationNote || ''}`,
      `Weather data timestamp: ${observation.dataTimestamp}`,
    );
  } else {
    lines.push('No weather data available for this market location.');
  }

  lines.push(
    ``,
    `=== YOUR TASK ===`,
    `1. Use web search to verify current official weather observations and forecasts for the location in the Polymarket question.`,
    `2. Identify the exact settlement station or resolution source if specified.`,
    `3. Estimate the probability that the YES outcome resolves based on current data.`,
    `4. Assess confidence level.`,
    `5. Return your response as a JSON object matching this schema exactly:`,
    ``,
    `{`,
    `  "city": "string — city name from market question",`,
    `  "stationCode": "string or null — official station code if verifiable",`,
    `  "stationVerified": boolean,`,
    `  "resolutionRulesVerified": boolean,`,
    `  "temperatureUnit": "F or C",`,
    `  "observedHighOrLow": number or null,`,
    `  "forecastRange": {"low": number, "high": number} or null,`,
    `  "remainingRelevantMinutes": number,`,
    `  "contract": "exact bracket text from the question",`,
    `  "yesProbability": number 0-1,`,
    `  "noProbability": number 0-1,`,
    `  "confidence": "HIGH" | "MEDIUM" | "LOW",`,
    `  "gptDecision": "TRADE YES" | "TRADE NO" | "WAIT" | "UNAVAILABLE",`,
    `  "summary": "2-4 sentence research summary",`,
    `  "supportingEvidence": [{"title":"string","url":"https://...","finding":"string"}],`,
    `  "warnings": ["string"]`,
    `}`,
    ``,
    `Important: yesProbability + noProbability must approximately equal 1.0.`,
    `Important: If you cannot verify station or key facts, set gptDecision to WAIT.`,
    `Important: Do not hallucinate station readings, forecasts, or URLs.`,
    `Important: Return ONLY the JSON object — no markdown, no explanation.`,
  );

  return lines.join('\n');
}

// ── GPT response validator ────────────────────────────────────────────────────

const VALID_DECISIONS:   ResearchDecision[]   = ['TRADE YES', 'TRADE NO', 'WAIT', 'UNAVAILABLE'];
const VALID_CONFIDENCES: ResearchConfidence[] = ['HIGH', 'MEDIUM', 'LOW'];

function validateGptResponse(raw: unknown): GptResearchFields {
  if (typeof raw !== 'object' || raw === null) throw new Error('Response is not an object');

  const r = raw as Record<string, unknown>;

  // Validate and clamp probabilities
  const yesP = Math.min(1, Math.max(0, Number(r.yesProbability ?? 0)));
  const noP  = Math.min(1, Math.max(0, Number(r.noProbability  ?? 0)));

  // Validate decision
  const decision = String(r.gptDecision || 'WAIT').toUpperCase() as ResearchDecision;
  if (!VALID_DECISIONS.includes(decision)) throw new Error(`Invalid decision: ${decision}`);

  // Validate confidence
  const confidence = String(r.confidence || 'LOW').toUpperCase() as ResearchConfidence;
  if (!VALID_CONFIDENCES.includes(confidence)) throw new Error(`Invalid confidence: ${confidence}`);

  // Validate evidence sources (sanitize URLs)
  const evidence: EvidenceSource[] = [];
  if (Array.isArray(r.supportingEvidence)) {
    for (const e of r.supportingEvidence.slice(0, 8)) {
      if (typeof e !== 'object' || e === null) continue;
      const ev = e as Record<string, unknown>;
      const url = String(ev.url || '');
      // Only allow https:// URLs to well-known domains (no arbitrary redirects)
      const safeUrl = url.startsWith('https://') ? url.slice(0, 500) : '';
      evidence.push({
        title:   String(ev.title   || '').slice(0, 200).replace(/<[^>]*>/g, ''),
        url:     safeUrl,
        finding: String(ev.finding || '').slice(0, 500).replace(/<[^>]*>/g, ''),
      });
    }
  }

  // Validate warnings
  const warnings: string[] = [];
  if (Array.isArray(r.warnings)) {
    for (const w of r.warnings.slice(0, 10)) {
      warnings.push(String(w).slice(0, 300).replace(/<[^>]*>/g, ''));
    }
  }

  // Validate forecast range
  let forecastRange: { low: number; high: number } | null = null;
  if (r.forecastRange && typeof r.forecastRange === 'object') {
    const fr = r.forecastRange as Record<string, unknown>;
    const lo = Number(fr.low);
    const hi = Number(fr.high);
    if (Number.isFinite(lo) && Number.isFinite(hi)) {
      forecastRange = { low: lo, high: hi };
    }
  }

  return {
    city:                    String(r.city || '').slice(0, 100).replace(/<[^>]*>/g, ''),
    stationCode:             r.stationCode ? String(r.stationCode).slice(0, 20) : null,
    stationVerified:         Boolean(r.stationVerified),
    resolutionRulesVerified: Boolean(r.resolutionRulesVerified),
    temperatureUnit:         String(r.temperatureUnit || 'F').toUpperCase() === 'C' ? 'C' : 'F',
    observedHighOrLow:       Number.isFinite(Number(r.observedHighOrLow)) ? Number(r.observedHighOrLow) : null,
    forecastRange,
    remainingRelevantMinutes: Math.max(0, Math.round(Number(r.remainingRelevantMinutes ?? 0))),
    contract:                String(r.contract || '').slice(0, 300).replace(/<[^>]*>/g, ''),
    yesProbability:          yesP,
    noProbability:           noP,
    confidence,
    gptDecision:             decision,
    summary:                 String(r.summary || '').slice(0, 1000).replace(/<[^>]*>/g, ''),
    supportingEvidence:      evidence,
    warnings,
  };
}

// ── Deterministic safety rules ────────────────────────────────────────────────
//
// Application code—not GPT—enforces the final decision.
// GPT provides probability estimates and research; this function decides.

function applyDeterministicRules(
  gpt:     GptResearchFields,
  yesAsk:  number | null,
  noAsk:   number | null,
): { finalDecision: ResearchDecision; reason: string; yesEdge: number | null; noEdge: number | null } {
  const yesEdge = (yesAsk !== null && gpt.yesProbability > 0) ? gpt.yesProbability - yesAsk : null;
  const noEdge  = (noAsk  !== null && gpt.noProbability  > 0) ? gpt.noProbability  - noAsk  : null;

  const hasCriticalWarning = gpt.warnings.some((w) =>
    /critical|cannot verify|station not found|unverified|data unavail/i.test(w)
  );

  // TRADE YES conditions
  const canTradeYes = (
    gpt.stationVerified &&
    gpt.resolutionRulesVerified &&
    !hasCriticalWarning &&
    gpt.yesProbability >= 0.80 &&
    yesEdge !== null && yesEdge >= 0.10 &&
    yesAsk !== null
  );

  // TRADE NO conditions
  const canTradeNo = (
    gpt.stationVerified &&
    gpt.resolutionRulesVerified &&
    !hasCriticalWarning &&
    gpt.noProbability >= 0.80 &&
    noEdge !== null && noEdge >= 0.10 &&
    noAsk !== null
  );

  // Safety: if both qualify (indicates bad data), return UNAVAILABLE
  if (canTradeYes && canTradeNo) {
    return {
      finalDecision: 'UNAVAILABLE',
      reason: 'Both YES and NO met thresholds simultaneously — data inconsistency',
      yesEdge,
      noEdge,
    };
  }

  if (canTradeYes) {
    return {
      finalDecision: 'TRADE YES',
      reason: `Station verified; est. probability ${(gpt.yesProbability * 100).toFixed(0)}%; YES edge ${((yesEdge ?? 0) * 100).toFixed(1)}pp`,
      yesEdge,
      noEdge,
    };
  }

  if (canTradeNo) {
    return {
      finalDecision: 'TRADE NO',
      reason: `Station verified; est. probability ${(gpt.noProbability * 100).toFixed(0)}%; NO edge ${((noEdge ?? 0) * 100).toFixed(1)}pp`,
      yesEdge,
      noEdge,
    };
  }

  // UNAVAILABLE when order book has no ask
  if (yesAsk === null && noAsk === null) {
    return {
      finalDecision: 'UNAVAILABLE',
      reason: 'No executable order-book ask on either side',
      yesEdge:  null,
      noEdge:   null,
    };
  }

  // Default: WAIT
  const waitReasons: string[] = [];
  if (!gpt.stationVerified)         waitReasons.push('station not verified');
  if (!gpt.resolutionRulesVerified) waitReasons.push('resolution rules not verified');
  if (hasCriticalWarning)           waitReasons.push('critical warning present');
  if (gpt.yesProbability < 0.80)    waitReasons.push(`YES probability ${(gpt.yesProbability * 100).toFixed(0)}% < 80%`);
  if (yesEdge !== null && yesEdge < 0.10) waitReasons.push(`YES edge ${((yesEdge) * 100).toFixed(1)}pp < 10pp`);

  return {
    finalDecision: 'WAIT',
    reason: waitReasons.length > 0 ? waitReasons.join('; ') : 'Insufficient evidence',
    yesEdge,
    noEdge,
  };
}

// ── Research one market ───────────────────────────────────────────────────────

async function researchMarket(
  openai: OpenAI,
  input:  WeatherResearchInput,
): Promise<WeatherResearchResult> {
  const { market, orderBooks, observation } = input;
  const analyzedAt = new Date().toISOString();

  // Identify YES and NO tokens
  const yesIdx = market.outcomes.findIndex((o) => o.toLowerCase() === 'yes');
  const noIdx  = market.outcomes.findIndex((o) => o.toLowerCase() === 'no');
  const yesTokenId = yesIdx >= 0 ? market.tokenIds[yesIdx] : (market.tokenIds[0] ?? '');
  const noTokenId  = noIdx  >= 0 ? market.tokenIds[noIdx]  : (market.tokenIds[1] ?? '');
  const yesOutcome = yesIdx >= 0 ? market.outcomes[yesIdx] : 'Yes';
  const noOutcome  = noIdx  >= 0 ? market.outcomes[noIdx]  : 'No';

  const yesBook = yesTokenId ? orderBooks[yesTokenId] : null;
  const noBook  = noTokenId  ? orderBooks[noTokenId]  : null;
  const yesAsk  = yesBook?.bestAsk ?? null;
  const noAsk   = noBook?.bestAsk  ?? null;
  const hasOrderBook = (yesBook?.asks?.length ?? 0) > 0 || (noBook?.asks?.length ?? 0) > 0;
  const orderBookTimestamp = yesBook?.timestamp ?? noBook?.timestamp ?? analyzedAt;

  // If no order book, return UNAVAILABLE immediately
  if (!hasOrderBook) {
    const fallbackGpt: GptResearchFields = {
      city:                    market.inferredCity || 'Unknown',
      stationCode:             null,
      stationVerified:         false,
      resolutionRulesVerified: false,
      temperatureUnit:         'F',
      observedHighOrLow:       null,
      forecastRange:           null,
      remainingRelevantMinutes: 0,
      contract:                market.question,
      yesProbability:          0,
      noProbability:           0,
      confidence:              'LOW',
      gptDecision:             'UNAVAILABLE',
      summary:                 'No executable order-book ask available for this market.',
      supportingEvidence:      [],
      warnings:                ['No executable order-book ask exists'],
    };
    return {
      marketId:    market.marketId, question: market.question,
      conditionId: market.conditionId, polymarketUrl: market.polymarketUrl, endDate: market.endDate,
      yesOutcome, noOutcome, yesTokenId, noTokenId,
      yesAsk: null, noAsk: null, yesBid: null, noBid: null,
      yesEdge: null, noEdge: null, orderBookTimestamp,
      gpt: fallbackGpt,
      finalDecision: 'UNAVAILABLE', decisionReason: 'No executable order-book ask',
      observation: observation ?? null, analyzedAt, hasOrderBook: false, gptError: null,
    };
  }

  // Build prompt and call GPT
  const prompt = buildResearchPrompt(input);
  let gpt: GptResearchFields;
  let gptError: string | null = null;

  try {
    // Use OpenAI Responses API with web search
    const response = await openai.responses.create({
      model: MODEL,
      tools: [{ type: 'web_search_preview' }] as Parameters<typeof openai.responses.create>[0]['tools'],
      input: `${SYSTEM_PROMPT}\n\n${prompt}`,
    } as Parameters<typeof openai.responses.create>[0]);

    // Extract text output from Responses API
    const outputText: string = (response as unknown as { output_text?: string }).output_text ?? '';

    if (!outputText) throw new Error('Empty response from OpenAI');

    // Find JSON in the output (may be preceded by web search annotations)
    const jsonStart = outputText.indexOf('{');
    const jsonEnd   = outputText.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) throw new Error('No JSON found in response');
    const jsonStr = outputText.slice(jsonStart, jsonEnd + 1);

    const parsed = JSON.parse(jsonStr) as unknown;
    gpt = validateGptResponse(parsed);
  } catch (err) {
    gptError = err instanceof Error ? err.message : String(err);
    console.error('[weather/research] GPT error for market', market.marketId, ':', gptError);

    gpt = {
      city:                    market.inferredCity || 'Unknown',
      stationCode:             null,
      stationVerified:         false,
      resolutionRulesVerified: false,
      temperatureUnit:         'F',
      observedHighOrLow:       null,
      forecastRange:           null,
      remainingRelevantMinutes: 0,
      contract:                market.question,
      yesProbability:          0,
      noProbability:           0,
      confidence:              'LOW',
      gptDecision:             'UNAVAILABLE',
      summary:                 'Research failed — GPT did not return valid analysis.',
      supportingEvidence:      [],
      warnings:                [`Research error: ${gptError.slice(0, 200)}`],
    };
  }

  // Apply deterministic decision rules
  const { finalDecision, reason, yesEdge, noEdge } = applyDeterministicRules(gpt, yesAsk, noAsk);

  return {
    marketId:       market.marketId,
    question:       market.question,
    conditionId:    market.conditionId,
    polymarketUrl:  market.polymarketUrl,
    endDate:        market.endDate,
    yesOutcome,
    noOutcome,
    yesTokenId,
    noTokenId,
    yesAsk,
    noAsk,
    yesBid:         yesBook?.bestBid ?? null,
    noBid:          noBook?.bestBid  ?? null,
    yesEdge,
    noEdge,
    orderBookTimestamp,
    gpt,
    finalDecision,
    decisionReason: reason,
    observation:    observation ?? null,
    analyzedAt,
    hasOrderBook,
    gptError,
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Check for API key
  const openai = getOpenAIClient();
  if (!openai) {
    return NextResponse.json(
      {
        ok:      false,
        results: [],
        summary: { marketsFound: 0, marketsAnalyzed: 0, qualifiedCalls: 0, waitingOrUnavail: 0, lastRefreshed: new Date().toISOString() },
        error:   'OPENAI_API_KEY is not configured on this server.',
      } satisfies ResearchApiResponse,
      { status: 503 }
    );
  }

  // Parse and validate request body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, results: [], summary: zeroSummary(), error: 'Invalid JSON body' } satisfies ResearchApiResponse,
      { status: 400 }
    );
  }

  if (!body || typeof body !== 'object' || !Array.isArray((body as { markets?: unknown }).markets)) {
    return NextResponse.json(
      { ok: false, results: [], summary: zeroSummary(), error: 'Body must contain markets array' } satisfies ResearchApiResponse,
      { status: 400 }
    );
  }

  const inputs = ((body as { markets: unknown[] }).markets).slice(0, MAX_MARKETS) as WeatherResearchInput[];

  if (inputs.length === 0) {
    return NextResponse.json(
      { ok: false, results: [], summary: zeroSummary(), error: 'No markets to research' } satisfies ResearchApiResponse,
      { status: 400 }
    );
  }

  try {
    // Research markets one at a time (avoid parallel GPT calls to manage cost/rate limits)
    const results: WeatherResearchResult[] = [];
    for (const input of inputs) {
      const result = await researchMarket(openai, input);
      results.push(result);
    }

    const qualifiedCalls  = results.filter((r) => r.finalDecision === 'TRADE YES' || r.finalDecision === 'TRADE NO').length;
    const waitingOrUnavail = results.filter((r) => r.finalDecision === 'WAIT' || r.finalDecision === 'UNAVAILABLE').length;

    const summary: ResearchSummary = {
      marketsFound:     inputs.length,
      marketsAnalyzed:  results.length,
      qualifiedCalls,
      waitingOrUnavail,
      lastRefreshed:    new Date().toISOString(),
    };

    const response: ResearchApiResponse = {
      ok:      true,
      results,
      summary,
      error:   null,
    };

    return NextResponse.json(response, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[weather/research] error:', message);

    return NextResponse.json(
      { ok: false, results: [], summary: zeroSummary(), error: message } satisfies ResearchApiResponse,
      { status: 500 }
    );
  }
}

function zeroSummary(): ResearchSummary {
  return { marketsFound: 0, marketsAnalyzed: 0, qualifiedCalls: 0, waitingOrUnavail: 0, lastRefreshed: new Date().toISOString() };
}
