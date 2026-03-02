import { NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";

const CLOB_PATH = "/balance-allowance";

function mask(s: string, keep = 4) {
  const v = (s || "").trim();
  if (!v) return { present: false, len: 0, last4: "" };
  return { present: true, len: v.length, last4: v.slice(-keep) };
}

function maskAddr(a: string) {
  const v = (a || "").trim();
  if (!v) return { present: false, len: 0, last6: "" };
  return { present: true, len: v.length, last6: v.slice(-6) };
}

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

export async function GET() {
  const host = (process.env.POLY_CLOB_HOST || "https://clob.polymarket.com").trim();
  const apiKey = (process.env.POLY_CLOB_API_KEY || "").trim();
  const apiSecret = (process.env.POLY_CLOB_API_SECRET || "").trim();
  const passphrase = (process.env.POLY_CLOB_API_PASSPHRASE || "").trim();
  const polyAddress = (process.env.POLY_ADDRESS || "").trim();
  const signatureType = (process.env.POLY_SIGNATURE_TYPE || "2").trim();

  const envReport = {
    POLY_CLOB_HOST: host,
    POLY_SIGNATURE_TYPE: signatureType,
    POLY_ADDRESS: maskAddr(polyAddress),
    POLY_CLOB_API_KEY: mask(apiKey),
    POLY_CLOB_API_SECRET: mask(apiSecret),
    POLY_CLOB_API_PASSPHRASE: mask(passphrase),
  };

  const missing = [];
  if (!apiKey) missing.push("POLY_CLOB_API_KEY");
  if (!apiSecret) missing.push("POLY_CLOB_API_SECRET");
  if (!passphrase) missing.push("POLY_CLOB_API_PASSPHRASE");
  if (!polyAddress) missing.push("POLY_ADDRESS");

  if (missing.length) {
    return NextResponse.json({ ok: false, envReport, missing }, { status: 500 });
  }

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

  let httpStatus = 0;
  let bodyText = "";

  try {
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

    httpStatus = resp.status;
    bodyText = (await resp.text().catch(() => "")) || "";
  } catch (e) {
    bodyText = e instanceof Error ? e.message : "Unknown error";
  }

  const truncated = bodyText.length > 500 ? bodyText.slice(0, 500) + "…(truncated)" : bodyText;

  return NextResponse.json({
    ok: httpStatus >= 200 && httpStatus < 300,
    envReport,
    request: { url, signedPath: CLOB_PATH, timestamp: ts },
    httpStatus,
    responseBody: truncated,
  });
}
