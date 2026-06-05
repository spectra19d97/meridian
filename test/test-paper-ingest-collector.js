import assert from "assert/strict";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ingestScript = path.join(repoRoot, "scripts", "paper-ingest-collector.js");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-paper-ingest-collector-test-"));
const defaultEventsFile = path.join(os.tmpdir(), "meridian-paper-events", "paper-events.jsonl");

const runtimeFiles = [
  "paper-events.jsonl",
  "paper-positions.json",
  "collector-snapshot.json",
  "readonly-collector-snapshot.json",
  "learning-summary.json",
];
const runtimeBaseline = new Map(runtimeFiles.map((filename) => {
  const fullPath = path.join(repoRoot, filename);
  if (!fs.existsSync(fullPath)) return [filename, null];
  const stat = fs.statSync(fullPath);
  return [filename, { size: stat.size, mtimeMs: stat.mtimeMs }];
}));

function assertRepoRuntimeUnchanged() {
  for (const filename of runtimeFiles) {
    const fullPath = path.join(repoRoot, filename);
    const before = runtimeBaseline.get(filename);
    const existsNow = fs.existsSync(fullPath);
    assert.equal(existsNow, before !== null, `${filename} repo-root existence changed`);
    if (before) {
      const after = fs.statSync(fullPath);
      assert.equal(after.size, before.size, `${filename} repo-root size changed`);
      assert.equal(after.mtimeMs, before.mtimeMs, `${filename} repo-root mtime changed`);
    }
  }
}

function runIngest(envOverrides = {}) {
  return execFileSync(process.execPath, [ingestScript], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...envOverrides,
    },
  });
}

function readEvents(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readonlyCollectorSnapshot() {
  return {
    collector_schema_version: "collector_readonly_v0.1",
    generated_at: "2026-01-01T00:00:00.000Z",
    source_mode: "readonly",
    source_type: "public_api_readonly",
    source_label: "dexscreener_solana_tokens_v1",
    synthetic_or_real_source: "real",
    summary: {
      snapshot_count: 2,
      warning_count: 1,
      source_mode: "readonly",
      source_label: "dexscreener_solana_tokens_v1",
    },
    snapshots: [
      {
        collector_schema_version: "collector_readonly_v0.1",
        collected_at: "2026-01-01T00:00:01.000Z",
        source_type: "public_api_readonly",
        source_label: "dexscreener_solana_tokens_v1",
        confidence_level: "medium",
        pool_identifier: "dexscreener_solana_tokens_v1_pair_1",
        pool_name: "raydium:SOL/USDC",
        token_x_symbol: "SOL",
        token_y_symbol: "USDC",
        liquidity_signal: "high",
        volume_signal: "medium",
        price_reference_label: "public_api_price_reference_present",
        range_state: "unknown",
        data_quality_warnings: [],
        raw_source_summary: "readonly context Bearer SHOULD_NOT_RENDER",
        synthetic_or_real_source: "real",
      },
      {
        collector_schema_version: "collector_readonly_v0.1",
        collected_at: "2026-01-01T00:00:02.000Z",
        source_type: "public_api_readonly",
        source_label: "dexscreener_solana_tokens_v1",
        confidence_level: "low",
        pool_identifier: "dexscreener_solana_tokens_v1_pair_2",
        pool_name: "orca:SOL/USDT",
        token_x_symbol: "SOL",
        token_y_symbol: "USDT",
        liquidity_signal: "unknown",
        volume_signal: "unknown",
        price_reference_label: "public_api_price_reference_missing",
        range_state: "unknown",
        data_quality_warnings: ["liquidity signal unavailable"],
        raw_source_summary: "readonly partial source",
        synthetic_or_real_source: "real",
      },
    ],
    warnings: [
      {
        collector_schema_version: "collector_readonly_v0.1",
        collected_at: "2026-01-01T00:00:03.000Z",
        source_type: "public_api_readonly",
        source_label: "dexscreener_solana_tokens_v1",
        severity: "low",
        code: "partial_snapshot_context",
        summary: "collector warning PRIVATE_KEY=SHOULD_NOT_RENDER",
        details: {
          note: "API_KEY=SHOULD_NOT_RENDER",
        },
        synthetic_or_real_source: "real",
      },
    ],
    safety: {
      read_only: true,
      public_source_only: true,
    },
  };
}

function mockCollectorSnapshot() {
  return {
    collector_schema_version: "collector_mock_v0.1",
    generated_at: "2026-01-01T01:00:00.000Z",
    source_mode: "mock",
    source_type: "local_mock",
    synthetic_or_real_source: "synthetic",
    summary: {
      snapshot_count: 1,
      warning_count: 1,
      source_mode: "mock",
      synthetic_fixture_detected: true,
    },
    snapshots: [
      {
        collector_schema_version: "collector_mock_v0.1",
        collected_at: "2026-01-01T01:00:01.000Z",
        source_type: "local_mock",
        source_label: "synthetic_mock_fixture",
        confidence_level: "high",
        pool_identifier: "SyntheticCollectorPoolHigh111111111111111111",
        pool_name: "SYNTH-COLLECTOR-HIGH-QUOTE",
        token_x_symbol: "SYNTH_X_HIGH",
        token_y_symbol: "SYNTH_Y_HIGH",
        liquidity_signal: "high",
        volume_signal: "medium",
        range_state: "in_range",
        data_quality_warnings: [],
        raw_source_summary: "synthetic local collector context",
        synthetic_or_real_source: "synthetic",
      },
    ],
    warnings: [
      {
        collector_schema_version: "collector_mock_v0.1",
        collected_at: "2026-01-01T01:00:02.000Z",
        source_type: "local_mock",
        source_label: "synthetic_mock_fixture",
        severity: "low",
        code: "synthetic_warning",
        summary: "synthetic collector warning",
        details: {},
        synthetic_or_real_source: "synthetic",
      },
    ],
    safety: {
      local_mock_only: true,
    },
  };
}

const readonlyCollectorFile = path.join(tempDir, "collector", "readonly-collector-snapshot.json");
const readonlyEventsFile = path.join(tempDir, "events", "paper-events.jsonl");
writeJson(readonlyCollectorFile, readonlyCollectorSnapshot());

const readonlyOutput = runIngest({
  COLLECTOR_SNAPSHOT_FILE: readonlyCollectorFile,
  PAPER_EVENTS_FILE: readonlyEventsFile,
});
assert.match(readonlyOutput, /MERIDIAN COLLECTOR INGEST/);
assert.match(readonlyOutput, /Safety: local collector file ingestion only; no fetch\/wallet\/RPC\/API\/SDK calls/);
assert.match(readonlyOutput, /Collector snapshots: 2/);
assert.match(readonlyOutput, /Collector warnings: 1/);

const readonlyEvents = readEvents(readonlyEventsFile);
assert.equal(readonlyEvents.length, 3);
assert.equal(readonlyEvents.filter((event) => event.type === "paper_collector_snapshot").length, 2);
assert.equal(readonlyEvents.filter((event) => event.type === "paper_data_quality_warning").length, 1);

for (const event of readonlyEvents) {
  assert.equal(event.paper_id, null);
  assert.equal(event.human_review_needed, true);
  assert.ok(String(event.event_id).startsWith("pevt_collector_"));
  assert.ok(String(event.collector_context_id).startsWith("collector_context_"));
  assert.ok(!JSON.stringify(event).includes("PAPER_"), "ingest must not create fake PAPER_ ids");
}

const firstSnapshotEvent = readonlyEvents.find((event) => event.type === "paper_collector_snapshot");
assert.equal(firstSnapshotEvent.pool, "dexscreener_solana_tokens_v1_pair_1");
assert.equal(firstSnapshotEvent.pool_name, "raydium:SOL/USDC");
assert.equal(firstSnapshotEvent.collector_source.source_mode, "readonly");
assert.equal(firstSnapshotEvent.collector_source.source_type, "public_api_readonly");
assert.equal(firstSnapshotEvent.collector_source.source_label, "dexscreener_solana_tokens_v1");
assert.equal(firstSnapshotEvent.collector_source.synthetic_or_real_source, "real");
assert.equal(firstSnapshotEvent.collector_snapshot.confidence_level, "medium");
assert.equal(firstSnapshotEvent.collector_snapshot.token_x_symbol, "SOL");
assert.equal(firstSnapshotEvent.collector_snapshot.token_y_symbol, "USDC");
assert.equal(firstSnapshotEvent.collector_snapshot.liquidity_signal, "high");
assert.equal(firstSnapshotEvent.collector_snapshot.volume_signal, "medium");
assert.equal(firstSnapshotEvent.collector_snapshot.range_state, "unknown");
assert.deepEqual(firstSnapshotEvent.collector_snapshot.data_quality_warnings, []);

const warningEvent = readonlyEvents.find((event) => event.type === "paper_data_quality_warning");
assert.equal(warningEvent.collector_source.source_label, "dexscreener_solana_tokens_v1");
assert.equal(warningEvent.collector_warning.code, "partial_snapshot_context");
assert.deepEqual(warningEvent.validation.warnings, ["collector warning"]);

const readonlySerialized = JSON.stringify(readonlyEvents);
assert.equal(readonlySerialized.includes("SHOULD_NOT_RENDER"), false);
assert.match(readonlySerialized, /\[REDACTED/);

const mockCollectorFile = path.join(tempDir, "collector", "collector-snapshot.json");
const mockEventsFile = path.join(tempDir, "events", "mock-paper-events.jsonl");
writeJson(mockCollectorFile, mockCollectorSnapshot());
runIngest({
  COLLECTOR_SNAPSHOT_FILE: mockCollectorFile,
  PAPER_EVENTS_FILE: mockEventsFile,
});
const mockEvents = readEvents(mockEventsFile);
assert.equal(mockEvents.filter((event) => event.type === "paper_collector_snapshot").length, 1);
assert.equal(mockEvents.filter((event) => event.type === "paper_data_quality_warning").length, 1);
assert.equal(mockEvents[0].collector_source.source_mode, "mock");
assert.equal(mockEvents[0].collector_source.source_type, "local_mock");
assert.equal(mockEvents[0].collector_source.synthetic_or_real_source, "synthetic");

const malformedCollectorFile = path.join(tempDir, "collector", "malformed.json");
const malformedEventsFile = path.join(tempDir, "events", "malformed-paper-events.jsonl");
fs.writeFileSync(malformedCollectorFile, "{not json");
const malformedOutput = runIngest({
  COLLECTOR_SNAPSHOT_FILE: malformedCollectorFile,
  PAPER_EVENTS_FILE: malformedEventsFile,
});
assert.match(malformedOutput, /Malformed collector snapshot warnings: 1/);
const malformedEvents = readEvents(malformedEventsFile);
assert.equal(malformedEvents.length, 1);
assert.equal(malformedEvents[0].type, "paper_data_quality_warning");
assert.equal(malformedEvents[0].human_review_needed, true);
assert.equal(malformedEvents[0].validation.valid, false);

const missingEventsFile = path.join(tempDir, "events", "missing-paper-events.jsonl");
const missingOutput = runIngest({
  COLLECTOR_SNAPSHOT_FILE: path.join(tempDir, "collector", "missing.json"),
  PAPER_EVENTS_FILE: missingEventsFile,
});
assert.match(missingOutput, /No collector snapshot found/);
assert.equal(fs.existsSync(missingEventsFile), false);

const defaultCollectorDir = path.join(os.tmpdir(), "meridian-paper-collector");
const defaultReadonlyCollectorFile = path.join(defaultCollectorDir, "readonly-collector-snapshot.json");
fs.mkdirSync(defaultCollectorDir, { recursive: true });
writeJson(defaultReadonlyCollectorFile, readonlyCollectorSnapshot());
const defaultOutput = runIngest({
  COLLECTOR_SNAPSHOT_FILE: "",
  READONLY_COLLECTOR_SNAPSHOT_FILE: "",
  PAPER_EVENTS_FILE: "",
});
assert.match(defaultOutput, new RegExp(defaultEventsFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.equal(fs.existsSync(defaultEventsFile), true);
assert.ok(path.resolve(defaultEventsFile).startsWith(path.resolve(os.tmpdir())));
assert.notEqual(path.resolve(defaultEventsFile), path.join(repoRoot, "paper-events.jsonl"));

const forbiddenOutputText = [
  "PnL",
  "valuation",
  "APR",
  "ROI",
  "winrate",
  "profitability",
  "strategy score",
  "edge",
  "live readiness",
  "wallet balance",
  "transaction state",
  "quote-value totals",
  "trading recommendation",
  "deploy recommendation",
  "private key",
  "transaction signature",
];
const allGeneratedEvents = [
  ...readonlyEvents,
  ...mockEvents,
  ...malformedEvents,
  ...readEvents(defaultEventsFile),
];
const lowerOutput = JSON.stringify(allGeneratedEvents).toLowerCase();
for (const forbidden of forbiddenOutputText) {
  assert.equal(lowerOutput.includes(forbidden.toLowerCase()), false, `ingested events must not contain ${forbidden}`);
}

const packageJson = readJson(path.join(repoRoot, "package.json"));
assert.equal(packageJson.scripts["paper:ingest:collector"], "node scripts/paper-ingest-collector.js");

const ingestSource = fs.readFileSync(ingestScript, "utf8");
for (const forbidden of [
  "fetch(",
  "http.request",
  "https.request",
  "import \"http\"",
  "import \"https\"",
  "require(\"http\")",
  "require(\"https\")",
  "tools/wallet",
  "tools/executor",
  "tools/dlmm",
  "agent.js",
  "config.js",
  "@solana/web3.js",
  "@meteora-ag/dlmm",
  "openai",
  "dotenv",
  "node-cron",
  "getWallet",
  "getConnection",
  "getDLMM",
  "getPool",
  "getActiveBin",
  "sendAndConfirmTransaction",
  "Jupiter",
  "RPC_URL",
  "WALLET_PRIVATE_KEY",
  "user-config.json",
  "logs/",
  "deploy",
  "claim",
  "close",
  "swap",
]) {
  assert.equal(ingestSource.includes(forbidden), false, `ingest script must not reference ${forbidden}`);
}

assertRepoRuntimeUnchanged();

console.log("Paper collector ingest tests passed");
