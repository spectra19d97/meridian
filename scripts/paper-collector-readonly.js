import fs from "fs";
import os from "os";
import path from "path";
import process from "process";

const SCHEMA_VERSION = "collector_readonly_v0.1";
const DEFAULT_READONLY_COLLECTOR_SNAPSHOT_FILE = path.join(
  os.tmpdir(),
  "meridian-paper-collector",
  "readonly-collector-snapshot.json",
);

const SOURCE_ALLOWLIST = Object.freeze({
  dexscreener_solana_tokens_v1: Object.freeze({
    source_type: "public_api_readonly",
    source_label: "dexscreener_solana_tokens_v1",
    base_url: "https://api.dexscreener.com",
    path: "/tokens/v1/solana/So11111111111111111111111111111111111111112,EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    timeout_ms: 8000,
    max_response_bytes: 250000,
  }),
});

const SELECTED_SOURCE = SOURCE_ALLOWLIST.dexscreener_solana_tokens_v1;
const SECRET_ENV_RE = /\b[A-Z0-9_]*(?:PRIVATE|SECRET|API|RPC)[A-Z0-9_]*=([^\s"',}]+)/gi;
const SENSITIVE_FIELD_PATTERN = /(private|secret|seed|mnemonic|wallet.*key|api.*key|apikey|bearer|authorization|auth|password|rpc)/i;

function nowIso() {
  return new Date().toISOString();
}

function redactedString(value) {
  return String(value)
    .replace(SECRET_ENV_RE, (match) => `${match.split("=")[0]}=[REDACTED]`)
    .replace(/\[[\s\d,]{120,}\]/g, "[REDACTED_SECRET_ARRAY]")
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[REDACTED_TOKEN]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/gi, "Bearer [REDACTED]")
    .replace(/([?&](?:api[-_]?key|apikey|key)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/\b[1-9A-HJ-NP-Za-km-z]{64,}\b/g, "[REDACTED_BASE58_SECRET]");
}

function sanitize(value, keyName = "") {
  if (value == null) return value;
  if (keyName && SENSITIVE_FIELD_PATTERN.test(keyName)) {
    if (typeof value === "object") return "[REDACTED_SECRET]";
    if (value !== "") return "[REDACTED_SECRET]";
  }
  if (typeof value === "string") return redactedString(value).replace(/\s+/g, " ").trim();
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((entry) => sanitize(entry, keyName));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitize(entry, key)]),
    );
  }
  return null;
}

function outputPath(env = process.env) {
  return path.resolve(env.READONLY_COLLECTOR_SNAPSHOT_FILE || DEFAULT_READONLY_COLLECTOR_SNAPSHOT_FILE);
}

function sourceUrl(source = SELECTED_SOURCE) {
  return `${source.base_url}${source.path}`;
}

function assertAllowlistedUrl(url, source = SELECTED_SOURCE) {
  const expected = sourceUrl(source);
  if (url !== expected || !url.startsWith(source.base_url)) {
    throw new Error("readonly collector source URL is not allowlisted");
  }
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function signalFromNumber(value, { high, medium }) {
  const number = numberOrNull(value);
  if (number == null) return "unknown";
  if (number >= high) return "high";
  if (number >= medium) return "medium";
  return "low";
}

function tokenSymbol(token) {
  const symbol = sanitize(token?.symbol || "unknown");
  return symbol || "unknown";
}

async function fetchBoundedJson({ fetchImpl, source = SELECTED_SOURCE }) {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is unavailable for readonly collector");
  }

  const url = sourceUrl(source);
  assertAllowlistedUrl(url, source);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), source.timeout_ms);

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const body = await response.text();
    if (body.length > source.max_response_bytes) {
      throw new Error("readonly collector response exceeded size cap");
    }
    if (!response.ok) {
      throw new Error(`readonly collector source returned status ${response.status}`);
    }
    try {
      return JSON.parse(body);
    } catch {
      throw new Error("readonly collector source returned malformed JSON");
    }
  } finally {
    clearTimeout(timeout);
  }
}

function pairsFromResponse(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.pairs)) return payload.pairs;
  return [];
}

function snapshotFromPair(pair, index, collectedAt, source = SELECTED_SOURCE) {
  const baseSymbol = tokenSymbol(pair?.baseToken);
  const quoteSymbol = tokenSymbol(pair?.quoteToken);
  const liquiditySignal = signalFromNumber(pair?.liquidity?.usd, { high: 1000000, medium: 100000 });
  const volumeSignal = signalFromNumber(pair?.volume?.h24, { high: 1000000, medium: 100000 });
  const warnings = [];

  if (pair?.chainId !== "solana") warnings.push("source pair is not marked as solana");
  if (baseSymbol === "unknown" || quoteSymbol === "unknown") warnings.push("token symbol missing");
  if (liquiditySignal === "unknown") warnings.push("liquidity signal unavailable");
  if (volumeSignal === "unknown") warnings.push("volume signal unavailable");

  const confidence = warnings.length === 0
    ? "medium"
    : warnings.length <= 2
      ? "low"
      : "unknown";

  return sanitize({
    collector_schema_version: SCHEMA_VERSION,
    collected_at: collectedAt,
    source_type: source.source_type,
    source_label: source.source_label,
    confidence_level: confidence,
    pool_identifier: `${source.source_label}_pair_${index + 1}`,
    pool_name: `${sanitize(pair?.dexId || "unknown_dex")}:${baseSymbol}/${quoteSymbol}`,
    token_x_symbol: baseSymbol,
    token_y_symbol: quoteSymbol,
    liquidity_signal: liquiditySignal,
    volume_signal: volumeSignal,
    price_reference_label: pair?.priceUsd != null || pair?.priceNative != null
      ? "public_api_price_reference_present"
      : "public_api_price_reference_missing",
    range_state: "unknown",
    data_quality_warnings: warnings,
    raw_source_summary: `public api context for ${baseSymbol}/${quoteSymbol} on ${sanitize(pair?.dexId || "unknown_dex")}`,
    synthetic_or_real_source: "real",
  });
}

function warningRecord({ collectedAt, severity = "medium", code, summary, details = {} }, source = SELECTED_SOURCE) {
  return sanitize({
    collector_schema_version: SCHEMA_VERSION,
    collected_at: collectedAt,
    source_type: source.source_type,
    source_label: source.source_label,
    severity,
    code,
    summary,
    details,
    synthetic_or_real_source: "real",
  });
}

function buildCollectorSnapshot({ generatedAt, snapshots, warnings, source = SELECTED_SOURCE }) {
  return sanitize({
    collector_schema_version: SCHEMA_VERSION,
    generated_at: generatedAt,
    source_mode: "readonly",
    source_type: source.source_type,
    source_label: source.source_label,
    synthetic_or_real_source: "real",
    summary: {
      snapshot_count: snapshots.length,
      warning_count: warnings.length,
      source_mode: "readonly",
      source_label: source.source_label,
    },
    snapshots,
    warnings,
    safety: {
      read_only: true,
      public_source_only: true,
      no_sensitive_material: true,
      no_transactions: true,
      local_output_only: true,
      not_action_advice: true,
    },
  });
}

async function collectReadonlySnapshot({ fetchImpl = globalThis.fetch, source = SELECTED_SOURCE } = {}) {
  const generatedAt = nowIso();
  const warnings = [];
  let snapshots = [];

  try {
    const payload = await fetchBoundedJson({ fetchImpl, source });
    const pairs = pairsFromResponse(payload).filter((pair) => pair?.chainId === "solana").slice(0, 5);
    if (pairs.length === 0) {
      warnings.push(warningRecord({
        collectedAt: generatedAt,
        severity: "medium",
        code: "empty_source_response",
        summary: "public api readonly source returned no usable solana pair context",
      }, source));
    }
    snapshots = pairs.map((pair, index) => snapshotFromPair(pair, index, generatedAt, source));
    for (const snapshot of snapshots) {
      if (snapshot.data_quality_warnings.length > 0) {
        warnings.push(warningRecord({
          collectedAt: generatedAt,
          severity: "low",
          code: "partial_snapshot_context",
          summary: `public api readonly snapshot has partial context for ${snapshot.pool_name}`,
          details: { warnings: snapshot.data_quality_warnings },
        }, source));
      }
    }
  } catch (error) {
    warnings.push(warningRecord({
      collectedAt: generatedAt,
      severity: "high",
      code: "source_read_failed",
      summary: "public api readonly source could not be read safely",
      details: { message: sanitize(error.message) },
    }, source));
  }

  return buildCollectorSnapshot({ generatedAt, snapshots, warnings, source });
}

async function runCollector({
  env = process.env,
  fetchImpl = globalThis.fetch,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  try {
    if (env.READ_ONLY_COLLECTOR_ENABLED !== "true") {
      stdout.write([
        "MERIDIAN READONLY PAPER COLLECTOR",
        "Disabled: set READ_ONLY_COLLECTOR_ENABLED=true to collect public read-only market context.",
        "No collector snapshot was written.",
        "",
      ].join("\n"));
      return { status: "disabled", outputFile: null, collectorSnapshot: null };
    }

    const collectorSnapshot = await collectReadonlySnapshot({ fetchImpl });
    const outputFile = outputPath(env);
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, `${JSON.stringify(collectorSnapshot, null, 2)}\n`);

    stdout.write([
      "MERIDIAN READONLY PAPER COLLECTOR",
      "Safety: public API read-only; no wallet/RPC/SDK/transaction calls",
      "",
      `Source: ${SELECTED_SOURCE.source_label}`,
      `Collector snapshot: ${outputFile}`,
      `Snapshots: ${collectorSnapshot.summary.snapshot_count}`,
      `Warnings: ${collectorSnapshot.summary.warning_count}`,
      "",
    ].join("\n"));
    return { status: "ok", outputFile, collectorSnapshot };
  } catch (error) {
    stderr.write(`${sanitize(error.message)}\n`);
    return { status: "error", outputFile: null, collectorSnapshot: null };
  }
}

if (process.argv[1] && path.basename(process.argv[1]) === "paper-collector-readonly.js") {
  runCollector().then((result) => {
    if (result.status === "error") process.exitCode = 1;
  });
}

export {
  SOURCE_ALLOWLIST,
  buildCollectorSnapshot,
  collectReadonlySnapshot,
  fetchBoundedJson,
  outputPath,
  runCollector,
  sanitize,
};
