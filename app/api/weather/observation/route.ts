// GET /api/weather/observation?lat=32.9&lon=-97.0&tz=America%2FChicago&city=Dallas
//
// Fetches current weather observations and today's forecast from Open-Meteo.
// Open-Meteo is a free public API — no API key required.
//
// Does NOT require any secret. Does NOT place trades. Read-only.
//
// Parameters:
//   lat  — latitude  (required)
//   lon  — longitude (required)
//   tz   — IANA timezone string (required, e.g. "America/Chicago")
//   city — display name (optional)

import { NextRequest, NextResponse } from 'next/server';
import type { WeatherObservation, ObservationApiResponse } from '@/lib/weather-types';

export const dynamic  = 'force-dynamic';
export const revalidate = 0;

const OPEN_METEO_BASE = 'https://api.open-meteo.com/v1/forecast';
const FETCH_TIMEOUT_MS = 8_000;

// ── Open-Meteo response shape (fields we use) ─────────────────────────────────

interface OpenMeteoResponse {
  timezone:            string;
  current_units?:      Record<string, string>;
  current?: {
    time:              string;
    temperature_2m:    number;
  };
  daily_units?:        Record<string, string>;
  daily?: {
    time:              string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_sum?: number[];
    cloudcover_mean?:   number[];
    windspeed_10m_max?: number[];
  };
}

// ── Converters ────────────────────────────────────────────────────────────────

function cToF(c: number): number {
  return Math.round((c * 9 / 5 + 32) * 10) / 10;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl;

  const latStr = searchParams.get('lat');
  const lonStr = searchParams.get('lon');
  const tz     = searchParams.get('tz')   || 'UTC';
  const city   = searchParams.get('city') || 'Unknown';

  const lat = parseFloat(latStr || '');
  const lon = parseFloat(lonStr || '');

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json(
      {
        ok: false, observation: null,
        error: 'lat and lon are required numeric parameters',
      } satisfies ObservationApiResponse,
      { status: 400 }
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    // Fetch current conditions and today's forecast
    const params = new URLSearchParams({
      latitude:            lat.toString(),
      longitude:           lon.toString(),
      timezone:            tz,
      temperature_unit:    'celsius',
      current:             'temperature_2m',
      daily:               [
        'temperature_2m_max',
        'temperature_2m_min',
        'precipitation_sum',
        'cloudcover_mean',
        'windspeed_10m_max',
      ].join(','),
      forecast_days:       '1',
      timeformat:          'iso8601',
    });

    const url = `${OPEN_METEO_BASE}?${params.toString()}`;
    const res = await fetch(url, {
      signal:  controller.signal,
      headers: { Accept: 'application/json' },
      next:    { revalidate: 0 },
    });

    clearTimeout(timer);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Open-Meteo ${res.status}: ${body.slice(0, 200)}`);
    }

    const data: OpenMeteoResponse = await res.json();

    // Current temperature (Celsius)
    const currentC = data.current?.temperature_2m ?? null;
    const currentF = currentC !== null ? cToF(currentC) : null;

    // Today's daily max / min (Celsius)
    const dailyMax = data.daily?.temperature_2m_max?.[0] ?? null;
    const dailyMin = data.daily?.temperature_2m_min?.[0] ?? null;
    const precipMm   = data.daily?.precipitation_sum?.[0]   ?? null;
    const cloudCover  = data.daily?.cloudcover_mean?.[0]     ?? null;
    const windKph     = data.daily?.windspeed_10m_max?.[0]   ?? null;

    // Determine local time
    const localTime = new Date().toLocaleTimeString('en-US', {
      timeZone:    tz !== 'UTC' ? tz : undefined,
      hour:        '2-digit',
      minute:      '2-digit',
      hour12:      true,
      timeZoneName: 'short',
    });

    const observation: WeatherObservation = {
      city,
      lat,
      lon,
      timezone:      data.timezone || tz,
      localTime,
      currentTempC:  currentC,
      currentTempF:  currentF,
      // Open-Meteo daily max/min = forecast values for today.
      // Since we ask for 1 forecast day, the daily max IS today's forecast.
      // The "observed high" requires hourly data; we use the max so far as proxy.
      observedHighC: currentC,   // Best proxy for observed: current temp
      observedHighF: currentF,
      observedLowC:  dailyMin,
      observedLowF:  dailyMin !== null ? cToF(dailyMin) : null,
      forecastMaxC:  dailyMax,
      forecastMaxF:  dailyMax !== null ? cToF(dailyMax) : null,
      forecastMinC:  dailyMin,
      forecastMinF:  dailyMin !== null ? cToF(dailyMin) : null,
      precipMm,
      cloudCoverPct: cloudCover,
      windKph,
      dataTimestamp: new Date().toISOString(),
      stationNote:   'Open-Meteo model interpolation — not an official station reading',
      error:         null,
    };

    const response: ObservationApiResponse = {
      ok:          true,
      observation,
      error:       null,
    };

    return NextResponse.json(response, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });

  } catch (err) {
    clearTimeout(timer);
    const message = err instanceof Error ? err.message : String(err);
    console.error('[weather/observation] error:', message);

    return NextResponse.json(
      { ok: false, observation: null, error: message } satisfies ObservationApiResponse,
      { status: 500 }
    );
  }
}
