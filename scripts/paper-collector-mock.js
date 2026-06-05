import fs from "fs";
import os from "os";
import path from "path";
import process from "process";

const SCHEMA_VERSION = "collector_mock_v0.1";
const DEFAULT_COLLECTOR_SNAPSHOT_FILE = path.join(
  os.tmpdir(),
  "meridian-paper-collector",
  "collector-snapshot.json",
);

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

function outputPath() {
  return path.resolve(process.env.COLLECTOR_SNAPSHOT_FILE || DEFAULT_COLLECTOR_SNAPSHOT_FILE);
}

function snapshot({
  collectedAt,
  sourceLabel,
  confidenceLevel,
  poolIdentifier,
  poolName,
  tokenXSymbol,
  tokenYSymbol,
  binStep,
  activeBin,
  liquiditySignal,
  volumeSignal,
  priceReferenceLabel,
  rangeState,
  dataQualityWarnings,
  rawSourceSummary,
}) {
  return sanitize({
    collector_schema_version: SCHEMA_VERSION,
    collected_at: collectedAt,
    source_type: "local_mock",
    source_label: sourceLabel,
    confidence_level: confidenceLevel,
    pool_identifier: poolIdentifier,
    pool_name: poolName,
    token_x_symbol: tokenXSymbol,
    token_y_symbol: tokenYSymbol,
    bin_step: binStep,
    active_bin: activeBin,
    liquidity_signal: liquiditySignal,
    volume_signal: volumeSignal,
    price_reference_label: priceReferenceLabel,
    range_state: rangeState,
    data_quality_warnings: dataQualityWarnings,
    raw_source_summary: rawSourceSummary,
    synthetic_or_real_source: "synthetic",
  });
}

function mockSnapshots(generatedAt) {
  return [
    snapshot({
      collectedAt: generatedAt,
      sourceLabel: "synthetic_mock_fixture",
      confidenceLevel: "high",
      poolIdentifier: "SyntheticCollectorPoolHigh111111111111111111",
      poolName: "SYNTH-COLLECTOR-HIGH-QUOTE",
      tokenXSymbol: "SYNTH_X_HIGH",
      tokenYSymbol: "SYNTH_Y_HIGH",
      binStep: 100,
      activeBin: 120,
      liquiditySignal: "high",
      volumeSignal: "medium",
      priceReferenceLabel: "synthetic_mock_reference",
      rangeState: "in_range",
      dataQualityWarnings: [],
      rawSourceSummary: "synthetic mock collector snapshot with high confidence local fixture data",
    }),
    snapshot({
      collectedAt: generatedAt,
      sourceLabel: "synthetic_mock_fixture",
      confidenceLevel: "medium",
      poolIdentifier: "SyntheticCollectorPoolMedium111111111111111",
      poolName: "SYNTH-COLLECTOR-MEDIUM-QUOTE",
      tokenXSymbol: "SYNTH_X_MED",
      tokenYSymbol: "SYNTH_Y_MED",
      binStep: 80,
      activeBin: 118,
      liquiditySignal: "medium",
      volumeSignal: "unknown",
      priceReferenceLabel: "synthetic_mock_reference",
      rangeState: "unknown",
      dataQualityWarnings: ["synthetic mock source has partial context"],
      rawSourceSummary: "synthetic mock collector snapshot with partial local fixture data",
    }),
    snapshot({
      collectedAt: generatedAt,
      sourceLabel: "synthetic_mock_fixture",
      confidenceLevel: "low",
      poolIdentifier: "SyntheticCollectorPoolLow111111111111111111",
      poolName: "SYNTH-COLLECTOR-LOW-QUOTE",
      tokenXSymbol: "SYNTH_X_LOW",
      tokenYSymbol: "SYNTH_Y_LOW",
      binStep: 120,
      activeBin: null,
      liquiditySignal: "low",
      volumeSignal: "low",
      priceReferenceLabel: "synthetic_mock_reference",
      rangeState: "unknown",
      dataQualityWarnings: ["synthetic mock confidence is low"],
      rawSourceSummary: "synthetic mock collector snapshot with low confidence warning",
    }),
    snapshot({
      collectedAt: generatedAt,
      sourceLabel: "synthetic_mock_fixture",
      confidenceLevel: "unknown",
      poolIdentifier: "SyntheticCollectorPoolUnknown111111111111",
      poolName: "SYNTH-COLLECTOR-UNKNOWN-QUOTE",
      tokenXSymbol: "SYNTH_X_UNKNOWN",
      tokenYSymbol: "SYNTH_Y_UNKNOWN",
      binStep: null,
      activeBin: null,
      liquiditySignal: "unknown",
      volumeSignal: "unknown",
      priceReferenceLabel: "synthetic_mock_reference",
      rangeState: "unknown",
      dataQualityWarnings: ["synthetic mock source confidence is unknown"],
      rawSourceSummary: "synthetic mock collector snapshot with unknown local fixture data",
    }),
    snapshot({
      collectedAt: generatedAt,
      sourceLabel: "synthetic_mock_fixture",
      confidenceLevel: "medium",
      poolIdentifier: "SyntheticCollectorPoolRange11111111111111",
      poolName: "SYNTH-COLLECTOR-RANGE-QUOTE",
      tokenXSymbol: "SYNTH_X_RANGE",
      tokenYSymbol: "SYNTH_Y_RANGE",
      binStep: 100,
      activeBin: 170,
      liquiditySignal: "medium",
      volumeSignal: "medium",
      priceReferenceLabel: "synthetic_mock_reference",
      rangeState: "out_of_range",
      dataQualityWarnings: ["synthetic mock range state is out_of_range"],
      rawSourceSummary: "synthetic mock collector snapshot with explicit out_of_range state",
    }),
  ];
}

function mockWarnings(generatedAt) {
  return [
    sanitize({
      collector_schema_version: SCHEMA_VERSION,
      collected_at: generatedAt,
      source_type: "local_mock",
      severity: "low",
      code: "synthetic_mock_low_confidence",
      summary: "synthetic mock collector warning for low confidence local data",
      details: {
        note: "synthetic mock warning Bearer SYNTHETIC_MOCK_SECRET_VALUE",
      },
      synthetic_or_real_source: "synthetic",
    }),
    sanitize({
      collector_schema_version: SCHEMA_VERSION,
      collected_at: generatedAt,
      source_type: "local_mock",
      severity: "medium",
      code: "synthetic_mock_range_state",
      summary: "synthetic mock collector warning for recorded range state",
      details: {
        note: "synthetic mock warning for out_of_range local fixture state",
      },
      synthetic_or_real_source: "synthetic",
    }),
  ];
}

function buildCollectorSnapshot() {
  const generatedAt = nowIso();
  const snapshots = mockSnapshots(generatedAt);
  const warnings = mockWarnings(generatedAt);

  return {
    collector_schema_version: SCHEMA_VERSION,
    generated_at: generatedAt,
    source_mode: "mock",
    source_type: "local_mock",
    synthetic_or_real_source: "synthetic",
    summary: {
      snapshot_count: snapshots.length,
      warning_count: warnings.length,
      source_mode: "mock",
      synthetic_fixture_detected: true,
    },
    snapshots,
    warnings,
    safety: {
      local_mock_only: true,
      no_real_market_reads: true,
      no_wallet_or_rpc: true,
      no_api_or_sdk_calls: true,
      no_pnl_or_valuation_math: true,
      not_trading_advice: true,
    },
  };
}

function writeCollectorSnapshot() {
  const collectorSnapshot = buildCollectorSnapshot();
  const collectorFile = outputPath();
  fs.mkdirSync(path.dirname(collectorFile), { recursive: true });
  fs.writeFileSync(collectorFile, `${JSON.stringify(collectorSnapshot, null, 2)}\n`);
  return { collectorFile, collectorSnapshot };
}

try {
  const { collectorFile, collectorSnapshot } = writeCollectorSnapshot();
  process.stdout.write([
    "MERIDIAN MOCK PAPER COLLECTOR",
    "Safety: synthetic local mock only; no wallet/RPC/API/SDK calls",
    "",
    `Collector snapshot: ${collectorFile}`,
    `Snapshots: ${collectorSnapshot.summary.snapshot_count}`,
    `Warnings: ${collectorSnapshot.summary.warning_count}`,
    "",
  ].join("\n"));
} catch (error) {
  process.stderr.write(`${sanitize(error.message)}\n`);
  process.exitCode = 1;
}
