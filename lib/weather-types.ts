// ─── Weather Trading — Shared Types ──────────────────────────────────────────
//
// These types are shared between Weather API routes and the client UI.
// Safe to import anywhere — no secrets, no server-only imports.
// ──────────────────────────────────────────────────────────────────────────────

// ── Polymarket market discovery ───────────────────────────────────────────────

/** A temperature-bracket market discovered on Polymarket */
export interface WeatherMarket {
  marketId:        string;
  conditionId:     string;
  question:        string;
  description:     string;
  resolutionSource: string;
  endDate:         string;       // ISO string
  endDateIso:      string;       // YYYY-MM-DD
  slug:            string;
  polymarketUrl:   string;
  /** Outcome names — verified from API (do NOT assume order) */
  outcomes:        string[];
  /** CLOB token IDs — parallel array matching outcomes[] */
  tokenIds:        string[];
  /** Displayed midpoint prices from Gamma (informational only) */
  outcomePrices:   number[];
  acceptingOrders: boolean;
  enableOrderBook: boolean;
  /** Parsed city name from question text, or null if not identified */
  inferredCity:    string | null;
  /** Known approximate latitude for weather lookup */
  inferredLat:     number | null;
  /** Known approximate longitude for weather lookup */
  inferredLon:     number | null;
  /** Known timezone for city */
  inferredTimezone: string | null;
}

// ── CLOB order book ───────────────────────────────────────────────────────────

export interface OrderBookLevel {
  price: number;
  size:  number;
}

export interface OrderBookData {
  tokenId:       string;
  outcome:       string;
  bids:          OrderBookLevel[];   // sorted descending (best bid first)
  asks:          OrderBookLevel[];   // sorted ascending (best ask first)
  bestBid:       number | null;
  bestAsk:       number | null;
  lastTradePrice: number | null;
  timestamp:     string;
  error:         string | null;
}

// ── Weather observation ───────────────────────────────────────────────────────

export interface WeatherObservation {
  city:               string;
  lat:                number;
  lon:                number;
  timezone:           string;
  localTime:          string;          // formatted local time string
  currentTempF:       number | null;
  currentTempC:       number | null;
  observedHighF:      number | null;
  observedHighC:      number | null;
  observedLowF:       number | null;
  observedLowC:       number | null;
  forecastMaxF:       number | null;
  forecastMaxC:       number | null;
  forecastMinF:       number | null;
  forecastMinC:       number | null;
  precipMm:           number | null;
  cloudCoverPct:      number | null;
  windKph:            number | null;
  dataTimestamp:      string;          // ISO string
  stationNote:        string | null;
  error:              string | null;
}

// ── Research input (passed to research API) ──────────────────────────────────

export interface WeatherResearchInput {
  market:      WeatherMarket;
  orderBooks:  Record<string, OrderBookData>;  // keyed by tokenId
  observation: WeatherObservation | null;
}

// ── Research result ──────────────────────────────────────────────────────────

export type ResearchDecision = 'TRADE YES' | 'TRADE NO' | 'WAIT' | 'UNAVAILABLE';
export type ResearchConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface EvidenceSource {
  title:   string;
  url:     string;
  finding: string;
}

/** GPT-supplied research fields — validated before use */
export interface GptResearchFields {
  city:                    string;
  stationCode:             string | null;
  stationVerified:         boolean;
  resolutionRulesVerified: boolean;
  temperatureUnit:         'F' | 'C';
  observedHighOrLow:       number | null;
  forecastRange:           { low: number; high: number } | null;
  remainingRelevantMinutes: number;
  contract:                string;
  yesProbability:          number;          // 0–1
  noProbability:           number;          // 0–1
  confidence:              ResearchConfidence;
  gptDecision:             ResearchDecision; // GPT suggestion (not final)
  summary:                 string;
  supportingEvidence:      EvidenceSource[];
  warnings:                string[];
}

/** Final research result (GPT fields + deterministic rule enforcement) */
export interface WeatherResearchResult {
  marketId:     string;
  question:     string;
  conditionId:  string;
  polymarketUrl: string;
  endDate:      string;

  // Executable prices (from CLOB, not GPT)
  yesOutcome:   string;
  noOutcome:    string;
  yesTokenId:   string;
  noTokenId:    string;
  yesAsk:       number | null;
  noAsk:        number | null;
  yesBid:       number | null;
  noBid:        number | null;
  yesEdge:      number | null;        // yesProbability - yesAsk
  noEdge:       number | null;        // noProbability - noAsk
  orderBookTimestamp: string;

  // GPT research fields
  gpt:          GptResearchFields;

  // Final deterministic decision (enforced by application code, not GPT)
  finalDecision: ResearchDecision;
  decisionReason: string;

  // Weather
  observation:  WeatherObservation | null;

  // Metadata
  analyzedAt:   string;   // ISO string
  hasOrderBook: boolean;
  gptError:     string | null;
}

// ── Summary ───────────────────────────────────────────────────────────────────

export interface ResearchSummary {
  marketsFound:     number;
  marketsAnalyzed:  number;
  qualifiedCalls:   number;
  waitingOrUnavail: number;
  lastRefreshed:    string;    // ISO string
}

// ── API response shapes ───────────────────────────────────────────────────────

export interface MarketsApiResponse {
  ok:       boolean;
  markets:  WeatherMarket[];
  total:    number;
  error:    string | null;
}

export interface PricesApiResponse {
  ok:         boolean;
  orderBooks: Record<string, OrderBookData>;
  error:      string | null;
}

export interface ObservationApiResponse {
  ok:          boolean;
  observation: WeatherObservation | null;
  error:       string | null;
}

export interface ResearchApiResponse {
  ok:       boolean;
  results:  WeatherResearchResult[];
  summary:  ResearchSummary;
  error:    string | null;
}
