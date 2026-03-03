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

  const RPCS = [
    process.env.POLYGON_RPC_URL?.trim(),
    "https://polygon-rpc.com",
    "https://rpc.ankr.com/polygon",
    "https://polygon-bor.publicnode.com",
    "https://1rpc.io/matic",
  ].filter(Boolean) as string[];

  type ErrorRecord = {
    rpc: string;
    status: number;
    body: string;
  };

  const rpcPost = async (method: string, params: any[]): Promise<any> => {
    let lastError: ErrorRecord | null = null;
    for (const rpcUrl of RPCS) {
      try {
        const resp = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method,
            params,
            id: 1,
          }),
        });

        const body = await resp.text();
        if (resp.ok) {
          const parsed = JSON.parse(body);
          if (parsed.error) {
            lastError = {
              rpc: rpcUrl,
              status: resp.status,
              body: parsed.error.message ?? JSON.stringify(parsed.error),
            };
            continue;
          }
          if (parsed.result === undefined) {
            lastError = {
              rpc: rpcUrl,
              status: resp.status,
              body: "missing result",
            };
            continue;
          }
          return parsed.result;
        } else {
          lastError = {
            rpc: rpcUrl,
            status: resp.status,
            body: body || "no body",
          };
          continue;
        }
      } catch (ex) {
        const message = ex instanceof Error ? ex.message : "unknown";
        lastError = {
          rpc: rpcUrl,
          status: 0,
          body: message,
        };
        continue;
      }
    }
    if (lastError) {
      throw new Error(
        `Polygon RPC error: ${lastError.status} via ${lastError.rpc} — ${lastError.body}`,
      );
    }
    throw new Error("Polygon RPC error: no RPC endpoints available");
  };

  try {
    const balanceHex = await rpcPost("eth_call", [
      {
        to: USDCe_ADDRESS,
        data: formatRequestData(balanceOfSig, funderAddress),
      },
      "latest",
    ]);
    let decimals = 6;
    try {
      const decimalsHex = await rpcPost("eth_call", [
        {
          to: USDCe_ADDRESS,
          data: decimalsSig,
        },
        "latest",
      ]);
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
