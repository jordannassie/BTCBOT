import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const BOT_ID = "default";
const USDCe_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";

const HEX_ZERO = "0x";

const balanceOfSig = "0x70a08231";
const decimalsSig = "0x313ce567";

const formatRequestData = (methodSig: string, address: string) => {
  const clean = address.toLowerCase().startsWith("0x")
    ? address.slice(2)
    : address;
  return methodSig + clean.padStart(64, "0");
};

const hexToBigInt = (value: string) => {
  if (!value || value === "0x") return 0n;
  return BigInt(value);
};

export async function GET() {
  const supabaseUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  if (!supabaseUrl.startsWith("http") || !serviceKey) {
    return NextResponse.json({ ok: false, error: "Supabase credentials missing" }, { status: 500 });
  }

  const funderAddress =
    (process.env.POLY_FUNDER_ADDRESS || process.env.POLY_ADDRESS || "").trim();
  if (!funderAddress) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Missing POLY_FUNDER_ADDRESS (your Polymarket proxy wallet address from polymarket.com/settings profile dropdown)",
      },
      { status: 500 },
    );
  }

  const rpcUrl = (process.env.POLYGON_RPC_URL || "https://polygon-rpc.com").trim();

  const callRpc = async (data: string) => {
    const resp = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_call",
        params: [
          {
            to: USDCe_ADDRESS,
            data,
          },
          "latest",
        ],
        id: 1,
      }),
    });
    if (!resp.ok) {
      throw new Error(`Polygon RPC error: ${resp.status}`);
    }
    const body = await resp.json();
    if (body.error) throw new Error(`Polygon RPC error: ${body.error.message || body.error}`);
    return body.result;
  };

  try {
    const balanceHex = await callRpc(formatRequestData(balanceOfSig, funderAddress));
    let decimals = 6;
    try {
      const decimalsHex = await callRpc(decimalsSig);
      const decBig = hexToBigInt(decimalsHex);
      decimals = Number(decBig);
    } catch {
      decimals = 6;
    }

    const balanceBig = hexToBigInt(balanceHex);
    const live_balance_usd = Number(
      (Number(balanceBig) / Math.pow(10, decimals)).toFixed(decimals),
    );
    const live_updated_at = new Date().toISOString();

    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const { error: upsertErr } = await supabase
      .from("bot_settings")
      .upsert(
        { bot_id: BOT_ID, live_balance_usd, live_updated_at },
        { onConflict: "bot_id" },
      );

    const resp = NextResponse.json({
      ok: true,
      source: "onchain-usdce",
      funder: funderAddress,
      live_balance_usd,
      live_updated_at,
      warning: upsertErr ? upsertErr.message : undefined,
    });
    resp.headers.set("Cache-Control", "no-store");
    return resp;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
