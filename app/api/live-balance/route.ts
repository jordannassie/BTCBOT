import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export const runtime = "nodejs";

const BOT_ID = "default";
const CLOB_PATH = "/balance-allowance";

function buildPolyHmacSignature(params: {
  secret: string;
  timestamp: number;
  method: string;
  requestPath: string;
  body?: string;
}) {
  const { secret, timestamp, method, requestPath, body } = params;

  const sanitized = secret
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .replace(/[^A-Za-z0-9+/=]/g, "");

  const key = Buffer.from(sanitized, "base64");

  let message = `${timestamp}${method}${requestPath}`;
  if (body !== undefined) message += body;

  const sigB64 = crypto.createHmac("sha256", key).update(message, "utf8").digest("base64");
  return sigB64.replace(/\+/g, "-").replace(/\//g, "_");
}

function parseUsdcToUsd(balanceStr: string): number {
  const s = String(balanceStr ?? "").trim();
  if (!s) return 0;

  if (s.includes(".")) return Number.parseFloat(s);

  const asInt = Number.parseInt(s, 10);
  if (!Number.isFinite(asInt)) return 0;

  if (asInt >= 1_000_000_000) return asInt / 1_000_000;
  return asInt;
}

export async function GET() {
  const supabaseUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  if (!supabaseUrl.startsWith("http") || !serviceKey) {
    return NextResponse.json({ ok: false, error: "Supabase credentials missing" }, { status: 500 });
  }

  const host = (process.env.POLY_CLOB_HOST || "https://clob.polymarket.com").trim();
  const apiKey = (process.env.POLY_CLOB_API_KEY || "").trim();
  const apiSecret = (process.env.POLY_CLOB_API_SECRET || "").trim();
  const passphrase = (process.env.POLY_CLOB_API_PASSPHRASE || "").trim();
  const polyAddress = (process.env.POLY_ADDRESS || "").trim();
  const signatureType = (process.env.POLY_SIGNATURE_TYPE || "2").trim();

  const missing = [];
  if (!apiKey) missing.push("POLY_CLOB_API_KEY");
  if (!apiSecret) missing.push("POLY_CLOB_API_SECRET");
  if (!passphrase) missing.push("POLY_CLOB_API_PASSPHRASE");
  if (!polyAddress) missing.push("POLY_ADDRESS");

  if (missing.length) {
    return NextResponse.json(
      { ok: false, error: `Missing env vars: ${missing.join(", ")}` },
      { status: 500 },
    );
  }

  try {
    const ts = Math.floor(Date.now() / 1000);

    const polySig = buildPolyHmacSignature({
      secret: apiSecret,
      timestamp: ts,
      method: "GET",
      requestPath: CLOB_PATH,
    });

    const url =
      `${host}${CLOB_PATH}` +
      `?asset_type=COLLATERAL&signature_type=${encodeURIComponent(signatureType)}`;

    const resp = await fetch(url, {
      method: "GET",
      headers: {
        POLY_ADDRESS: polyAddress,
        POLY_SIGNATURE: polySig,
        POLY_TIMESTAMP: String(ts),
        POLY_API_KEY: apiKey,
        POLY_PASSPHRASE: passphrase,
      },
      cache: "no-store",
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      return NextResponse.json(
        { ok: false, error: `Polymarket CLOB error: ${resp.status}${txt ? ` — ${txt}` : ""}` },
        { status: 502 },
      );
    }

    const data = (await resp.json()) as any;

    if (data?.error) {
      return NextResponse.json(
        { ok: false, error: `Polymarket CLOB error: ${data.error}` },
        { status: 502 },
      );
    }

    const live_balance_usd = parseUsdcToUsd(data?.balance);
    const live_updated_at = new Date().toISOString();

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const { error: upsertErr } = await supabase
      .from("bot_settings")
      .upsert(
        { bot_id: BOT_ID, live_balance_usd, live_updated_at },
        { onConflict: "bot_id" },
      );

    if (upsertErr) {
      return NextResponse.json({ ok: false, error: upsertErr.message }, { status: 500 });
    }

    const out = NextResponse.json({ ok: true, live_balance_usd, live_updated_at });
    out.headers.set("Cache-Control", "no-store");
    return out;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
