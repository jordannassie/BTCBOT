// GET /api/weather/markets
//
// Discovers active Polymarket daily temperature events and returns their nested
// bracket markets.  Uses the public Gamma API — no authentication required.
//
// Does NOT place trades. Does NOT write to any database. Read-only.
//
// Strategy (event-level discovery — not the flat markets endpoint):
//   1. Build slug patterns for today and tomorrow from a known-city list.
//   2. Fetch each parent event by slug in parallel batches.
//   3. Also scan the most recent ~2500 events (sorted createdAt desc) to catch
//      any city not in the known list.
//   4. Deduplicate by event ID.
//   5. Filter for active, non-closed temperature events whose stated date is
//      today or tomorrow.
//   6. For each matched event read event.markets[] (nested bracket markets).
//   7. Parse the bracket label (e.g. "88-89°F", "79°F or below").
//   8. Verify YES / NO outcome-to-token mapping.
//   9. Pick the single most-relevant bracket per event (closest to 0.5 price).
//  10. Return up to 10 markets with safe discovery diagnostics.
//
// Returns MarketsApiResponse (see lib/weather-types.ts).

import { NextResponse } from 'next/server';
import type {
  WeatherMarket,
  MarketsApiResponse,
  DiscoveryDiagnostics,
} from '@/lib/weather-types';

export const dynamic  = 'force-dynamic';
export const revalidate = 0;

const GAMMA_BASE = 'https://gamma-api.polymarket.com';

// ── City database ─────────────────────────────────────────────────────────────
//
// slug       — city part used in Polymarket event slugs
// lat/lon    — approximate coordinates for Open-Meteo weather lookup
// tz         — IANA timezone
// hasLowest  — whether Polymarket creates "lowest temperature" events for city

interface CityEntry {
  slug:      string;
  lat:       number;
  lon:       number;
  tz:        string;
  hasLowest: boolean;
}

const CITIES: Record<string, CityEntry> = {
  'Atlanta':          { slug: 'atlanta',       lat: 33.749,  lon: -84.388,   tz: 'America/New_York',              hasLowest: false },
  'NYC':              { slug: 'nyc',            lat: 40.713,  lon: -74.006,   tz: 'America/New_York',              hasLowest: true  },
  'Dallas':           { slug: 'dallas',         lat: 32.900,  lon: -97.040,   tz: 'America/Chicago',               hasLowest: false },
  'Chicago':          { slug: 'chicago',        lat: 41.878,  lon: -87.630,   tz: 'America/Chicago',               hasLowest: false },
  'Miami':            { slug: 'miami',          lat: 25.762,  lon: -80.192,   tz: 'America/New_York',              hasLowest: true  },
  'Seattle':          { slug: 'seattle',        lat: 47.606,  lon: -122.332,  tz: 'America/Los_Angeles',           hasLowest: false },
  'Houston':          { slug: 'houston',        lat: 29.760,  lon: -95.370,   tz: 'America/Chicago',               hasLowest: false },
  'Denver':           { slug: 'denver',         lat: 39.739,  lon: -104.990,  tz: 'America/Denver',                hasLowest: false },
  'Austin':           { slug: 'austin',         lat: 30.267,  lon: -97.743,   tz: 'America/Chicago',               hasLowest: false },
  'Los Angeles':      { slug: 'los-angeles',    lat: 34.052,  lon: -118.244,  tz: 'America/Los_Angeles',           hasLowest: false },
  'San Francisco':    { slug: 'san-francisco',  lat: 37.775,  lon: -122.419,  tz: 'America/Los_Angeles',           hasLowest: false },
  'Toronto':          { slug: 'toronto',        lat: 43.653,  lon: -79.383,   tz: 'America/Toronto',               hasLowest: false },
  'Buenos Aires':     { slug: 'buenos-aires',   lat: -34.603, lon: -58.382,   tz: 'America/Argentina/Buenos_Aires',hasLowest: false },
  'Sao Paulo':        { slug: 'sao-paulo',      lat: -23.547, lon: -46.634,   tz: 'America/Sao_Paulo',             hasLowest: false },
  'Panama City':      { slug: 'panama-city',    lat: 8.994,   lon: -79.519,   tz: 'America/Panama',                hasLowest: false },
  'Mexico City':      { slug: 'mexico-city',    lat: 19.433,  lon: -99.133,   tz: 'America/Mexico_City',           hasLowest: false },
  'London':           { slug: 'london',         lat: 51.507,  lon: -0.128,    tz: 'Europe/London',                 hasLowest: true  },
  'Paris':            { slug: 'paris',          lat: 48.857,  lon: 2.352,     tz: 'Europe/Paris',                  hasLowest: true  },
  'Madrid':           { slug: 'madrid',         lat: 40.416,  lon: -3.703,    tz: 'Europe/Madrid',                 hasLowest: false },
  'Milan':            { slug: 'milan',          lat: 45.464,  lon: 9.189,     tz: 'Europe/Rome',                   hasLowest: false },
  'Munich':           { slug: 'munich',         lat: 48.135,  lon: 11.582,    tz: 'Europe/Berlin',                 hasLowest: false },
  'Amsterdam':        { slug: 'amsterdam',      lat: 52.370,  lon: 4.895,     tz: 'Europe/Amsterdam',              hasLowest: false },
  'Warsaw':           { slug: 'warsaw',         lat: 52.230,  lon: 21.012,    tz: 'Europe/Warsaw',                 hasLowest: false },
  'Moscow':           { slug: 'moscow',         lat: 55.755,  lon: 37.617,    tz: 'Europe/Moscow',                 hasLowest: false },
  'Istanbul':         { slug: 'istanbul',       lat: 41.015,  lon: 28.979,    tz: 'Europe/Istanbul',               hasLowest: false },
  'Helsinki':         { slug: 'helsinki',       lat: 60.169,  lon: 24.942,    tz: 'Europe/Helsinki',               hasLowest: false },
  'Ankara':           { slug: 'ankara',         lat: 39.921,  lon: 32.854,    tz: 'Europe/Istanbul',               hasLowest: false },
  'Tokyo':            { slug: 'tokyo',          lat: 35.676,  lon: 139.650,   tz: 'Asia/Tokyo',                    hasLowest: true  },
  'Seoul':            { slug: 'seoul',          lat: 37.566,  lon: 126.978,   tz: 'Asia/Seoul',                    hasLowest: true  },
  'Hong Kong':        { slug: 'hong-kong',      lat: 22.320,  lon: 114.177,   tz: 'Asia/Hong_Kong',                hasLowest: true  },
  'Shanghai':         { slug: 'shanghai',       lat: 31.224,  lon: 121.469,   tz: 'Asia/Shanghai',                 hasLowest: true  },
  'Singapore':        { slug: 'singapore',      lat: 1.352,   lon: 103.820,   tz: 'Asia/Singapore',                hasLowest: false },
  'Taipei':           { slug: 'taipei',         lat: 25.047,  lon: 121.517,   tz: 'Asia/Taipei',                   hasLowest: false },
  'Beijing':          { slug: 'beijing',        lat: 39.905,  lon: 116.391,   tz: 'Asia/Shanghai',                 hasLowest: false },
  'Guangzhou':        { slug: 'guangzhou',      lat: 23.129,  lon: 113.264,   tz: 'Asia/Shanghai',                 hasLowest: false },
  'Shenzhen':         { slug: 'shenzhen',       lat: 22.543,  lon: 114.058,   tz: 'Asia/Shanghai',                 hasLowest: false },
  'Wuhan':            { slug: 'wuhan',          lat: 30.593,  lon: 114.305,   tz: 'Asia/Shanghai',                 hasLowest: false },
  'Chengdu':          { slug: 'chengdu',        lat: 30.572,  lon: 104.066,   tz: 'Asia/Shanghai',                 hasLowest: false },
  'Chongqing':        { slug: 'chongqing',      lat: 29.565,  lon: 106.551,   tz: 'Asia/Shanghai',                 hasLowest: false },
  'Qingdao':          { slug: 'qingdao',        lat: 36.066,  lon: 120.383,   tz: 'Asia/Shanghai',                 hasLowest: false },
  'Busan':            { slug: 'busan',          lat: 35.180,  lon: 129.075,   tz: 'Asia/Seoul',                    hasLowest: false },
  'Manila':           { slug: 'manila',         lat: 14.599,  lon: 120.984,   tz: 'Asia/Manila',                   hasLowest: false },
  'Kuala Lumpur':     { slug: 'kuala-lumpur',   lat: 3.148,   lon: 101.686,   tz: 'Asia/Kuala_Lumpur',             hasLowest: false },
  'Jeddah':           { slug: 'jeddah',         lat: 21.485,  lon: 39.192,    tz: 'Asia/Riyadh',                   hasLowest: false },
  'Karachi':          { slug: 'karachi',        lat: 24.860,  lon: 67.010,    tz: 'Asia/Karachi',                  hasLowest: false },
  'Lucknow':          { slug: 'lucknow',        lat: 26.847,  lon: 80.947,    tz: 'Asia/Kolkata',                  hasLowest: false },
  'Tel Aviv':         { slug: 'tel-aviv',       lat: 32.086,  lon: 34.780,    tz: 'Asia/Jerusalem',                hasLowest: false },
  'Cape Town':        { slug: 'cape-town',      lat: -33.925, lon: 18.424,    tz: 'Africa/Johannesburg',           hasLowest: false },
  'Wellington':       { slug: 'wellington',     lat: -41.286, lon: 174.776,   tz: 'Pacific/Auckland',              hasLowest: false },
  'Sydney':           { slug: 'sydney',         lat: -33.869, lon: 151.209,   tz: 'Australia/Sydney',              hasLowest: false },
  'Boston':           { slug: 'boston',         lat: 42.360,  lon: -71.059,   tz: 'America/New_York',              hasLowest: false },
  'Phoenix':          { slug: 'phoenix',        lat: 33.448,  lon: -112.074,  tz: 'America/Phoenix',               hasLowest: false },
  'Las Vegas':        { slug: 'las-vegas',      lat: 36.170,  lon: -115.140,  tz: 'America/Los_Angeles',           hasLowest: false },
  'New Orleans':      { slug: 'new-orleans',    lat: 29.951,  lon: -90.072,   tz: 'America/Chicago',               hasLowest: false },
  'Minneapolis':      { slug: 'minneapolis',    lat: 44.978,  lon: -93.265,   tz: 'America/Chicago',               hasLowest: false },
  'Portland':         { slug: 'portland',       lat: 45.523,  lon: -122.677,  tz: 'America/Los_Angeles',           hasLowest: false },
  'Nashville':        { slug: 'nashville',      lat: 36.163,  lon: -86.782,   tz: 'America/Chicago',               hasLowest: false },
  'Mumbai':           { slug: 'mumbai',         lat: 19.076,  lon: 72.877,    tz: 'Asia/Kolkata',                  hasLowest: false },
  'Delhi':            { slug: 'delhi',          lat: 28.704,  lon: 77.102,    tz: 'Asia/Kolkata',                  hasLowest: false },
  'Bangkok':          { slug: 'bangkok',        lat: 13.756,  lon: 100.502,   tz: 'Asia/Bangkok',                  hasLowest: false },
  'Jakarta':          { slug: 'jakarta',        lat: -6.208,  lon: 106.846,   tz: 'Asia/Jakarta',                  hasLowest: false },
  'Cairo':            { slug: 'cairo',          lat: 30.044,  lon: 31.236,    tz: 'Africa/Cairo',                  hasLowest: false },
  'Lagos':            { slug: 'lagos',          lat: 6.524,   lon: 3.379,     tz: 'Africa/Lagos',                  hasLowest: false },
};

// Temperature event title patterns (to filter non-temperature events)
const TEMP_TITLE_PATTERNS = [
  'highest temperature',
  'lowest temperature',
  'temperature in',
  'daily high',
  'daily low',
];

// Patterns that disqualify a "temperature" title match
const EXCLUDE_TITLE_PATTERNS = [
  'global warming',
  'hottest year',
  'hottest on record',
  'sea ice',
  'climate change',
  'arctic sea',
  'body temperature',
  'room temperature',
  'room temp',
];

// ── Gamma API types ───────────────────────────────────────────────────────────

interface GammaNestedMarket {
  id:              string;
  conditionId?:    string;
  question:        string;
  description?:    string | null;
  resolutionSource?: string | null;
  endDate:         string;
  slug?:           string;
  groupItemTitle?: string;
  outcomes:        string | string[];
  outcomePrices:   string | string[];
  clobTokenIds:    string | string[];
  active:          boolean;
  closed:          boolean;
  enableOrderBook: boolean;
  acceptingOrders: boolean;
}

interface GammaEvent {
  id:          string;
  ticker?:     string;
  slug:        string;
  title:       string;
  description?: string | null;
  resolutionSource?: string | null;
  endDate:     string;
  startDate?:  string;
  createdAt?:  string;
  active:      boolean;
  closed:      boolean;
  archived?:   boolean;
  markets?:    GammaNestedMarket[];
}

// ── Date helpers ──────────────────────────────────────────────────────────────

/** Format a Date as the Polymarket slug date part, e.g. "august-6-2026" */
function buildDateSlug(d: Date): string {
  const months = [
    'january','february','march','april','may','june',
    'july','august','september','october','november','december',
  ];
  return `${months[d.getUTCMonth()]}-${d.getUTCDate()}-${d.getUTCFullYear()}`;
}

/**
 * Determine whether an event's stated date is "today" or "tomorrow".
 * We use the event title to extract the month/day (e.g. "August 6") and compare
 * to UTC today/tomorrow dates.  The endDate fallback is also used, but titles are
 * authoritative because settlement timestamps may extend past midnight.
 */
function classifyEventDate(evt: GammaEvent, todaySlug: string, tomorrowSlug: string): 'today' | 'tomorrow' | 'other' {
  // Primary: check slug
  if (evt.slug.includes(todaySlug))    return 'today';
  if (evt.slug.includes(tomorrowSlug)) return 'tomorrow';

  // Fallback: check endDate
  const endDate = evt.endDate ? new Date(evt.endDate) : null;
  if (endDate) {
    const todayDate    = new Date();
    const tomorrowDate = new Date(Date.now() + 86_400_000);
    const endDay  = endDate.getUTCDate();
    const endMon  = endDate.getUTCMonth();
    if (endDay === todayDate.getUTCDate()    && endMon === todayDate.getUTCMonth())    return 'today';
    if (endDay === tomorrowDate.getUTCDate() && endMon === tomorrowDate.getUTCMonth()) return 'tomorrow';
  }

  return 'other';
}

// ── Event title / city helpers ────────────────────────────────────────────────

function isTempTitle(title: string): boolean {
  const lower = title.toLowerCase();
  const hasTemp = TEMP_TITLE_PATTERNS.some((p) => lower.includes(p));
  if (!hasTemp) return false;
  return !EXCLUDE_TITLE_PATTERNS.some((p) => lower.includes(p));
}

/**
 * Extract city name from an event title like:
 *   "Highest temperature in Atlanta on August 6?"
 *   "Lowest temperature in NYC on August 6?"
 */
function extractCityFromTitle(title: string): string | null {
  const m = title.match(/(?:highest|lowest) temperature in (.+?) on/i);
  if (!m) return null;
  return m[1].trim();
}

/**
 * Look up coordinates and timezone from our city database.
 * Tries exact match, then substring match on both sides.
 */
function lookupCityCoords(cityName: string): { lat: number; lon: number; tz: string } | null {
  if (!cityName) return null;

  // Direct key lookup
  const entry = CITIES[cityName];
  if (entry) return { lat: entry.lat, lon: entry.lon, tz: entry.tz };

  // Case-insensitive key lookup
  const lower = cityName.toLowerCase();
  for (const [key, val] of Object.entries(CITIES)) {
    if (key.toLowerCase() === lower) return { lat: val.lat, lon: val.lon, tz: val.tz };
    if (val.slug === lower.replace(/\s+/g, '-')) return { lat: val.lat, lon: val.lon, tz: val.tz };
  }

  // Partial match (city name contains known city or vice versa)
  for (const [key, val] of Object.entries(CITIES)) {
    const keyLower = key.toLowerCase();
    if (lower.includes(keyLower) || keyLower.includes(lower)) {
      return { lat: val.lat, lon: val.lon, tz: val.tz };
    }
  }

  return null;
}

// ── JSON field parser ─────────────────────────────────────────────────────────

function parseJsonField<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as T[]; } catch { return []; }
  }
  return [];
}

// ── Bracket parsing ───────────────────────────────────────────────────────────

interface ParsedBracket {
  label:      string;   // original label
  lower:      number | null;
  upper:      number | null;
  type:       'range' | 'below' | 'above';
  unit:       'F' | 'C';
  verified:   boolean;  // false = force WAIT
}

/**
 * Parse a bracket label into structured bounds.
 * Supports: "79°F or below", "80-81°F", "80–81°F", "98°F or higher",
 *            "24–25°C", "24°C or less", "26°C or more".
 * Returns null only if completely unparseable.
 */
function parseBracket(label: string): ParsedBracket | null {
  if (!label) return null;

  // Normalize unicode dashes and whitespace
  const norm = label
    .replace(/\u2013|\u2014/g, '-') // en-dash, em-dash → hyphen
    .trim();

  const unit: 'F' | 'C' = /°c\b/i.test(norm) ? 'C' : 'F';

  // Helper to strip degree symbols and units
  const parseNum = (s: string): number | null => {
    const n = Number(s.replace(/[°fFcC\s]/g, '').trim());
    return Number.isFinite(n) ? n : null;
  };

  // Pattern: "X°F or below" / "X°C or less" / "X°F or lower"
  const belowMatch = norm.match(/^([\d.]+)°[fFcC]?\s+or\s+(?:below|less|lower)/i);
  if (belowMatch) {
    const upper = parseNum(belowMatch[1]);
    if (upper !== null) return { label, lower: null, upper, type: 'below', unit, verified: true };
  }

  // Pattern: "X°F or higher" / "X°C or more" / "X°F or above"
  const aboveMatch = norm.match(/^([\d.]+)°[fFcC]?\s+or\s+(?:higher|more|above)/i);
  if (aboveMatch) {
    const lower = parseNum(aboveMatch[1]);
    if (lower !== null) return { label, lower, upper: null, type: 'above', unit, verified: true };
  }

  // Pattern: "X-Y°F" or "X–Y°F" or "X°F to Y°F"
  const rangeMatch = norm.match(/^([\d.]+)(?:°[fFcC]?)?\s*[-–to]+\s*([\d.]+)°[fFcC]/i);
  if (rangeMatch) {
    const lower = parseNum(rangeMatch[1]);
    const upper = parseNum(rangeMatch[2]);
    if (lower !== null && upper !== null) return { label, lower, upper, type: 'range', unit, verified: true };
  }

  // Pattern: single value "X°F" (exact)
  const exactMatch = norm.match(/^([\d.]+)°[fFcC]/i);
  if (exactMatch) {
    const v = parseNum(exactMatch[1]);
    if (v !== null) return { label, lower: v, upper: v, type: 'range', unit, verified: true };
  }

  // Could not parse — include the bracket but flag as unverified
  return { label, lower: null, upper: null, type: 'range', unit: 'F', verified: false };
}

// ── Gamma API fetchers ────────────────────────────────────────────────────────

async function fetchEventBySlug(slug: string): Promise<GammaEvent | null> {
  try {
    const url = `${GAMMA_BASE}/events?slug=${encodeURIComponent(slug)}`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'BTCBOT-Weather/2.0' },
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as GammaEvent[];
    return Array.isArray(data) && data.length > 0 ? data[0] : null;
  } catch {
    return null;
  }
}

async function fetchEventPage(offset: number): Promise<GammaEvent[]> {
  try {
    const url = `${GAMMA_BASE}/events?active=true&closed=false&limit=100&offset=${offset}&order=createdAt&ascending=false`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'BTCBOT-Weather/2.0' },
      next: { revalidate: 0 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? (data as GammaEvent[]) : [];
  } catch {
    return [];
  }
}

// ── Market extraction from nested event ──────────────────────────────────────

interface ExtractedMarket {
  market:          GammaNestedMarket;
  eventId:         string;
  eventTitle:      string;
  eventSlug:       string;
  eventEndDate:    string;
  bracket:         ParsedBracket | null;
  yesIdx:          number;
  noIdx:           number;
  midPrice:        number;  // outcomePrices[yesIdx] — used for bracket selection
}

/**
 * Extract all valid bracket markets from a temperature parent event.
 * Returns one entry per bracket market that has YES+NO outcomes and token IDs.
 */
function extractMarketsFromEvent(
  evt: GammaEvent,
  diag: DiscoveryDiagnostics,
): ExtractedMarket[] {
  const results: ExtractedMarket[] = [];
  const nestedMarkets = evt.markets ?? [];

  for (const m of nestedMarkets) {
    diag.nestedMarketsFound++;

    // Skip closed or inactive nested markets
    if (m.closed || !m.active) { diag.rejectedCounts.closed++; continue; }
    if (!m.enableOrderBook || !m.acceptingOrders) { diag.rejectedCounts.closed++; continue; }

    // Parse outcomes and token IDs (may arrive as JSON-encoded strings)
    const outcomes  = parseJsonField<string>(m.outcomes);
    const prices    = parseJsonField<string>(m.outcomePrices);
    const tokenIds  = parseJsonField<string>(m.clobTokenIds);

    // Verify we have both YES and NO
    if (outcomes.length < 2 || tokenIds.length < 2) {
      diag.rejectedCounts.missingTokens++;
      continue;
    }

    const yesIdx = outcomes.findIndex((o) => o.toLowerCase() === 'yes');
    const noIdx  = outcomes.findIndex((o) => o.toLowerCase() === 'no');

    if (yesIdx === -1 || noIdx === -1) {
      diag.rejectedCounts.invalidOutcomeMapping++;
      continue;
    }

    if (!tokenIds[yesIdx] || !tokenIds[noIdx]) {
      diag.rejectedCounts.missingTokens++;
      continue;
    }

    // Parse bracket label
    const bracketLabel = m.groupItemTitle ?? '';
    const bracket = parseBracket(bracketLabel);
    if (!bracket) {
      diag.rejectedCounts.unparseableBracket++;
      continue;
    }

    const midPrice = Number(prices[yesIdx] ?? 0.5);

    diag.eligibleMarkets++;

    results.push({
      market:       m,
      eventId:      evt.id,
      eventTitle:   evt.title,
      eventSlug:    evt.slug,
      eventEndDate: evt.endDate || m.endDate,
      bracket,
      yesIdx,
      noIdx,
      midPrice,
    });
  }

  return results;
}

/**
 * From a list of bracket markets for one event, pick the single most relevant
 * one: the bracket whose YES price is closest to 0.5 (most uncertain / liquid).
 */
function pickBestBracket(brackets: ExtractedMarket[]): ExtractedMarket {
  return brackets.reduce((best, curr) => {
    const bestDist = Math.abs(best.midPrice - 0.5);
    const currDist = Math.abs(curr.midPrice - 0.5);
    return currDist < bestDist ? curr : best;
  });
}

// ── Build WeatherMarket from extracted market ─────────────────────────────────

function buildWeatherMarket(
  em:       ExtractedMarket,
  isTomorrow: boolean,
): WeatherMarket {
  const m = em.market;
  const outcomes  = parseJsonField<string>(m.outcomes);
  const prices    = parseJsonField<string>(m.outcomePrices);
  const tokenIds  = parseJsonField<string>(m.clobTokenIds);

  const cityName  = extractCityFromTitle(em.eventTitle);
  const coords    = cityName ? lookupCityCoords(cityName) : null;

  return {
    marketId:         m.id,
    conditionId:      m.conditionId ?? m.id,
    question:         m.question,
    description:      m.description ?? em.eventTitle,
    resolutionSource: m.resolutionSource ?? '',
    endDate:          em.eventEndDate,
    endDateIso:       em.eventEndDate.slice(0, 10),
    slug:             m.slug ?? em.eventSlug,
    polymarketUrl:    `https://polymarket.com/event/${em.eventSlug}`,
    outcomes,
    tokenIds,
    outcomePrices:    prices.map(Number),
    acceptingOrders:  m.acceptingOrders,
    enableOrderBook:  m.enableOrderBook,
    inferredCity:     cityName,
    inferredLat:      coords?.lat ?? null,
    inferredLon:      coords?.lon ?? null,
    inferredTimezone: coords?.tz ?? null,
    parentEventId:    em.eventId,
    parentEventTitle: em.eventTitle,
    bracketLabel:     em.bracket?.label ?? m.groupItemTitle ?? '',
    isTomorrow,
    bracketUnverified: em.bracket ? !em.bracket.verified : true,
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET(): Promise<NextResponse> {
  const diag: DiscoveryDiagnostics = {
    eventsScanned:            0,
    temperatureEventsMatched: 0,
    eligibleEvents:           0,
    nestedMarketsFound:       0,
    eligibleMarkets:          0,
    rejectedCounts: {
      closed:                0,
      wrongDate:             0,
      notTemperature:        0,
      missingTokens:         0,
      invalidOutcomeMapping: 0,
      unparseableBracket:    0,
    },
  };

  try {
    const today    = new Date();
    const tomorrow = new Date(Date.now() + 86_400_000);
    const todaySlug    = buildDateSlug(today);
    const tomorrowSlug = buildDateSlug(tomorrow);

    console.log('[weather/markets] Discovering for today:', todaySlug, '/ tomorrow:', tomorrowSlug);

    // ── Phase 1: Slug-based fetch for today's + tomorrow's events ─────────────
    // Build all candidate slugs from the known-city list
    const candidateSlugs: string[] = [];
    for (const [, entry] of Object.entries(CITIES)) {
      candidateSlugs.push(`highest-temperature-in-${entry.slug}-on-${todaySlug}`);
      if (entry.hasLowest) candidateSlugs.push(`lowest-temperature-in-${entry.slug}-on-${todaySlug}`);
      candidateSlugs.push(`highest-temperature-in-${entry.slug}-on-${tomorrowSlug}`);
      if (entry.hasLowest) candidateSlugs.push(`lowest-temperature-in-${entry.slug}-on-${tomorrowSlug}`);
    }

    // Fetch in parallel batches of 20
    const BATCH = 20;
    const slugEvents: GammaEvent[] = [];
    for (let i = 0; i < candidateSlugs.length; i += BATCH) {
      const batch = candidateSlugs.slice(i, i + BATCH);
      const results = await Promise.all(batch.map(fetchEventBySlug));
      for (const evt of results) {
        if (evt) slugEvents.push(evt);
      }
    }

    // ── Phase 2: Scan recent events (pages 0-24) for supplementary discovery ─
    // This catches cities not in our known list and any future markets
    const recentEvents: GammaEvent[] = [];
    for (let page = 0; page < 25; page++) {
      const batch = await fetchEventPage(page * 100);
      if (!batch.length) break;
      recentEvents.push(...batch);
      // Early exit once we've gone past recent dates
      const last = batch[batch.length - 1];
      if (last?.createdAt && last.createdAt < '2026-08-04') break;
    }

    // ── Merge and deduplicate by event ID ────────────────────────────────────
    const allEvents = [...slugEvents, ...recentEvents];
    const seenIds = new Set<string>();
    const uniqueEvents: GammaEvent[] = [];
    for (const evt of allEvents) {
      if (seenIds.has(evt.id)) continue;
      seenIds.add(evt.id);
      uniqueEvents.push(evt);
    }

    diag.eventsScanned = uniqueEvents.length;
    console.log(`[weather/markets] Total unique events: ${uniqueEvents.length}`);

    // ── Filter events for temperature markers ─────────────────────────────────
    const tempEvents: GammaEvent[] = [];
    for (const evt of uniqueEvents) {
      if (!isTempTitle(evt.title)) { diag.rejectedCounts.notTemperature++; continue; }
      if (evt.closed) { diag.rejectedCounts.closed++; continue; }

      const dateClass = classifyEventDate(evt, todaySlug, tomorrowSlug);
      if (dateClass === 'other') { diag.rejectedCounts.wrongDate++; continue; }

      diag.temperatureEventsMatched++;
      if (!evt.markets || evt.markets.length === 0) continue;

      diag.eligibleEvents++;
      tempEvents.push(evt);
    }

    console.log(`[weather/markets] Temperature events matched: ${diag.temperatureEventsMatched}, eligible: ${diag.eligibleEvents}`);

    // ── Extract and select one bracket per event ──────────────────────────────
    const weatherMarkets: WeatherMarket[] = [];
    const MAX_MARKETS = 10;

    for (const evt of tempEvents) {
      if (weatherMarkets.length >= MAX_MARKETS) break;

      const isTomorrow = classifyEventDate(evt, todaySlug, tomorrowSlug) === 'tomorrow';
      const extracted  = extractMarketsFromEvent(evt, diag);
      if (extracted.length === 0) continue;

      const best = pickBestBracket(extracted);
      weatherMarkets.push(buildWeatherMarket(best, isTomorrow));
    }

    console.log(`[weather/markets] Returning ${weatherMarkets.length} markets. Diagnostics:`, JSON.stringify(diag));

    const response: MarketsApiResponse = {
      ok:          true,
      markets:     weatherMarkets,
      total:       weatherMarkets.length,
      error:       null,
      diagnostics: diag,
    };

    return NextResponse.json(response, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[weather/markets] error:', message);

    const response: MarketsApiResponse = {
      ok:          false,
      markets:     [],
      total:       0,
      error:       message,
      diagnostics: diag,
    };
    return NextResponse.json(response, { status: 500 });
  }
}
