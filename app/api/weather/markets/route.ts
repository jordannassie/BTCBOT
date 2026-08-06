// GET /api/weather/markets
//
// Discovers active same-day temperature bracket markets on Polymarket via the
// public Gamma API.  No authentication required — all data is publicly readable.
//
// Does NOT place trades. Does NOT write to any database. Read-only.
//
// Strategy:
//   1. Fetch up to 500 markets from Gamma API (active, not closed).
//   2. Filter by temperature-related keywords in question/description text.
//   3. Filter by end date ≤ 48 h from now (same-day and next-day markets).
//   4. Filter by acceptingOrders = true and enableOrderBook = true.
//   5. Parse outcome names and token IDs from the actual API response.
//   6. Infer city name and coordinates for weather lookup where possible.
//
// Returns MarketsApiResponse (see lib/weather-types.ts).

import { NextResponse } from 'next/server';
import type { WeatherMarket, MarketsApiResponse } from '@/lib/weather-types';

export const dynamic  = 'force-dynamic';
export const revalidate = 0;

const GAMMA_BASE  = 'https://gamma-api.polymarket.com';
const PAGE_LIMIT  = 100;
const MAX_PAGES   = 10;
const HORIZON_MS  = 48 * 60 * 60 * 1000; // 48 hours

// Temperature-related keywords for inclusion filtering
const TEMP_KEYWORDS = [
  '°f', '°c', 'fahrenheit', 'celsius',
  'temperature', 'daily high', 'daily low',
  'high temp', 'low temp', 'heat index',
  'high will', 'low will', 'degrees',
  'exceed', 'reach.*°', 'above.*°', 'below.*°',
];

// Terms that indicate a non-weather market (skip these even if temperature keyword matched)
const EXCLUDE_PATTERNS = [
  'nba', 'nfl', 'nhl', 'mlb', 'premier league', 'champions league',
  'heat vs', 'heat win', 'miami heat',
  'hurricane', 'tornado', 'earthquake', 'volcano', 'meteor',
  'pandemic', 'global warming', 'hottest year', 'hottest on record',
  'sea ice', 'climate change', 'arctic', 'superconductor',
  'room-temp', 'room temp', 'rent freeze', 'body temperature',
];

// Known city → coordinates + timezone for weather lookup
const CITY_COORDS: Record<string, { lat: number; lon: number; tz: string }> = {
  dallas:          { lat: 32.8998, lon: -97.0403, tz: 'America/Chicago'    },
  'new york':      { lat: 40.7128, lon: -74.0060, tz: 'America/New_York'   },
  'new york city': { lat: 40.7128, lon: -74.0060, tz: 'America/New_York'   },
  nyc:             { lat: 40.7128, lon: -74.0060, tz: 'America/New_York'   },
  chicago:         { lat: 41.8781, lon: -87.6298, tz: 'America/Chicago'    },
  'los angeles':   { lat: 34.0522, lon: -118.2437, tz: 'America/Los_Angeles' },
  la:              { lat: 34.0522, lon: -118.2437, tz: 'America/Los_Angeles' },
  phoenix:         { lat: 33.4484, lon: -112.0740, tz: 'America/Phoenix'   },
  miami:           { lat: 25.7617, lon: -80.1918, tz: 'America/New_York'   },
  houston:         { lat: 29.7604, lon: -95.3698, tz: 'America/Chicago'    },
  atlanta:         { lat: 33.7490, lon: -84.3880, tz: 'America/New_York'   },
  seattle:         { lat: 47.6062, lon: -122.3321, tz: 'America/Los_Angeles' },
  denver:          { lat: 39.7392, lon: -104.9903, tz: 'America/Denver'    },
  boston:          { lat: 42.3601, lon: -71.0589, tz: 'America/New_York'   },
  washington:      { lat: 38.9072, lon: -77.0369, tz: 'America/New_York'   },
  dc:              { lat: 38.9072, lon: -77.0369, tz: 'America/New_York'   },
  'las vegas':     { lat: 36.1699, lon: -115.1398, tz: 'America/Los_Angeles' },
  london:          { lat: 51.5074, lon: -0.1278,  tz: 'Europe/London'      },
  paris:           { lat: 48.8566, lon:  2.3522,  tz: 'Europe/Paris'       },
  tokyo:           { lat: 35.6762, lon: 139.6503, tz: 'Asia/Tokyo'         },
  sydney:          { lat: -33.8688, lon: 151.2093, tz: 'Australia/Sydney'  },
  toronto:         { lat: 43.6532, lon: -79.3832, tz: 'America/Toronto'    },
  minneapolis:     { lat: 44.9778, lon: -93.2650, tz: 'America/Chicago'    },
  'salt lake':     { lat: 40.7608, lon: -111.8910, tz: 'America/Denver'    },
  orlando:         { lat: 28.5383, lon: -81.3792, tz: 'America/New_York'   },
  nashville:       { lat: 36.1627, lon: -86.7816, tz: 'America/Chicago'    },
  portland:        { lat: 45.5231, lon: -122.6765, tz: 'America/Los_Angeles' },
  memphis:         { lat: 35.1495, lon: -90.0490, tz: 'America/Chicago'    },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function isTemperatureMarket(question: string, description: string): boolean {
  const text = (question + ' ' + (description || '')).toLowerCase();
  const hasKeyword = TEMP_KEYWORDS.some((kw) => {
    // Simple inclusion check (regex patterns simplified to includes)
    const plain = kw.replace(/\.\*/g, '').replace(/\\/g, '');
    return text.includes(plain);
  });
  if (!hasKeyword) return false;
  const hasExclusion = EXCLUDE_PATTERNS.some((ex) => text.includes(ex));
  return !hasExclusion;
}

function inferCity(question: string): { city: string | null; lat: number | null; lon: number | null; tz: string | null } {
  const lower = question.toLowerCase();
  for (const [name, coords] of Object.entries(CITY_COORDS)) {
    if (lower.includes(name)) {
      return { city: name, ...coords };
    }
  }
  return { city: null, lat: null, lon: null, tz: null };
}

function parseJsonField<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as T[]; } catch { return []; }
  }
  return [];
}

function buildPolymarketUrl(slug: string): string {
  return `https://polymarket.com/event/${slug}`;
}

// ── Gamma API fetcher ─────────────────────────────────────────────────────────

interface GammaMarket {
  id:              string;
  conditionId:     string;
  question:        string;
  description:     string | null;
  resolutionSource: string | null;
  endDate:         string;
  endDateIso:      string;
  slug:            string;
  outcomes:        string | string[];
  outcomePrices:   string | string[];
  clobTokenIds:    string | string[];
  active:          boolean;
  closed:          boolean;
  enableOrderBook: boolean;
  acceptingOrders: boolean;
}

async function fetchGammaPage(offset: number): Promise<GammaMarket[]> {
  const url = `${GAMMA_BASE}/markets?active=true&closed=false&limit=${PAGE_LIMIT}&offset=${offset}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'BTCBOT-Weather/1.0' },
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error(`Gamma API error ${res.status}`);
  return (await res.json()) as GammaMarket[];
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET(): Promise<NextResponse> {
  const now    = Date.now();
  const cutoff = now + HORIZON_MS;

  try {
    const allMarkets: GammaMarket[] = [];

    // Paginate through Gamma API to collect all active markets
    for (let page = 0; page < MAX_PAGES; page++) {
      const batch = await fetchGammaPage(page * PAGE_LIMIT);
      if (!batch || batch.length === 0) break;
      allMarkets.push(...batch);
      if (batch.length < PAGE_LIMIT) break;
    }

    // Filter and transform
    const weatherMarkets: WeatherMarket[] = [];

    for (const m of allMarkets) {
      const question    = m.question    || '';
      const description = m.description || '';
      const endDate     = m.endDate     || '';
      const endMs       = endDate ? new Date(endDate).getTime() : 0;

      // Must be a temperature market
      if (!isTemperatureMarket(question, description)) continue;

      // Must close within 48 hours (still open)
      if (!endMs || endMs < now || endMs > cutoff) continue;

      // Must have order book enabled
      if (!m.enableOrderBook || !m.acceptingOrders) continue;

      // Parse outcomes and token IDs (may arrive as JSON-encoded strings)
      const outcomes:    string[] = parseJsonField<string>(m.outcomes);
      const prices:      string[] = parseJsonField<string>(m.outcomePrices);
      const tokenIds:    string[] = parseJsonField<string>(m.clobTokenIds);

      // Must have at least 2 outcomes
      if (outcomes.length < 2 || tokenIds.length < 2) continue;

      // Infer city location
      const cityInfo = inferCity(question);

      // Deduplicate by conditionId
      if (weatherMarkets.some((w) => w.conditionId === m.conditionId)) continue;

      weatherMarkets.push({
        marketId:         m.id,
        conditionId:      m.conditionId,
        question,
        description,
        resolutionSource: m.resolutionSource || '',
        endDate,
        endDateIso:       m.endDateIso || endDate.slice(0, 10),
        slug:             m.slug,
        polymarketUrl:    buildPolymarketUrl(m.slug),
        outcomes,
        tokenIds,
        outcomePrices:    prices.map(Number),
        acceptingOrders:  m.acceptingOrders,
        enableOrderBook:  m.enableOrderBook,
        inferredCity:     cityInfo.city,
        inferredLat:      cityInfo.lat,
        inferredLon:      cityInfo.lon,
        inferredTimezone: cityInfo.tz,
      });

      if (weatherMarkets.length >= 10) break;  // Limit per refresh
    }

    const response: MarketsApiResponse = {
      ok:      true,
      markets: weatherMarkets,
      total:   weatherMarkets.length,
      error:   null,
    };

    return NextResponse.json(response, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[weather/markets] error:', message);

    const response: MarketsApiResponse = {
      ok:      false,
      markets: [],
      total:   0,
      error:   message,
    };
    return NextResponse.json(response, { status: 500 });
  }
}
