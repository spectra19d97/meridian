import assert from "assert/strict";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const collectorScript = path.join(repoRoot, "scripts", "paper-collector-mock.js");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-paper-collector-test-"));
const defaultCollectorFile = path.join(os.tmpdir(), "meridian-paper-collector", "collector-snapshot.json");

const runtimeFiles = [
  "paper-positions.json",
  "paper-events.jsonl",
  "strategy-library.json",
  "decision-log.json",
  "learning-summary.json",
  "collector-snapshot.json",
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

function runCollector(collectorFile) {
  const env = { ...process.env };
  if (collectorFile) {
    env.COLLECTOR_SNAPSHOT_FILE = collectorFile;
  } else {
    delete env.COLLECTOR_SNAPSHOT_FILE;
  }

  return execFileSync(process.execPath, [collectorScript], {
    cwd: repoRoot,
    encoding: "utf8",
    env,
  });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const explicitCollectorFile = path.join(tempDir, "collector", "collector-snapshot.json");
const explicitOutput = runCollector(explicitCollectorFile);

assert.match(explicitOutput, /MERIDIAN MOCK PAPER COLLECTOR/);
assert.match(explicitOutput, /Safety: synthetic local mock only; no wallet\/RPC\/API\/SDK calls/);
assert.match(explicitOutput, new RegExp(explicitCollectorFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.equal(fs.existsSync(explicitCollectorFile), true);
assert.equal(fs.existsSync(path.join(repoRoot, "collector-snapshot.json")), false);

const collector = readJson(explicitCollectorFile);
assert.equal(collector.collector_schema_version, "collector_mock_v0.1");
assert.match(collector.generated_at, /^\d{4}-\d{2}-\d{2}T/);
assert.equal(collector.source_mode, "mock");
assert.equal(collector.source_type, "local_mock");
assert.equal(collector.synthetic_or_real_source, "synthetic");
assert.equal(collector.summary.snapshot_count, collector.snapshots.length);
assert.equal(collector.summary.warning_count, collector.warnings.length);
assert.equal(collector.summary.source_mode, "mock");
assert.equal(collector.summary.synthetic_fixture_detected, true);
assert.equal(collector.safety.local_mock_only, true);
assert.equal(collector.safety.no_real_market_reads, true);
assert.equal(collector.safety.no_wallet_or_rpc, true);
assert.equal(collector.safety.no_api_or_sdk_calls, true);
assert.equal(collector.safety.no_pnl_or_valuation_math, true);
assert.equal(collector.safety.not_trading_advice, true);

assert.equal(collector.snapshots.length, 5);
assert.ok(collector.snapshots.some((snapshot) => snapshot.confidence_level === "high" && snapshot.range_state === "in_range"));
assert.ok(collector.snapshots.some((snapshot) => snapshot.confidence_level === "medium" && snapshot.range_state === "unknown"));
assert.ok(collector.snapshots.some((snapshot) => snapshot.confidence_level === "low"));
assert.ok(collector.snapshots.some((snapshot) => snapshot.confidence_level === "unknown"));
assert.ok(collector.snapshots.some((snapshot) => snapshot.range_state === "out_of_range"));

for (const snapshot of collector.snapshots) {
  for (const field of [
    "collector_schema_version",
    "collected_at",
    "source_type",
    "source_label",
    "confidence_level",
    "pool_identifier",
    "pool_name",
    "token_x_symbol",
    "token_y_symbol",
    "bin_step",
    "active_bin",
    "liquidity_signal",
    "volume_signal",
    "price_reference_label",
    "range_state",
    "data_quality_warnings",
    "raw_source_summary",
    "synthetic_or_real_source",
  ]) {
    assert.ok(Object.hasOwn(snapshot, field), `snapshot should include ${field}`);
  }
  assert.equal(snapshot.collector_schema_version, "collector_mock_v0.1");
  assert.equal(snapshot.source_type, "local_mock");
  assert.equal(snapshot.source_label, "synthetic_mock_fixture");
  assert.equal(snapshot.synthetic_or_real_source, "synthetic");
  assert.ok(["high", "medium", "low", "unknown"].includes(snapshot.confidence_level));
  assert.ok(["high", "medium", "low", "unknown"].includes(snapshot.liquidity_signal));
  assert.ok(["high", "medium", "low", "unknown"].includes(snapshot.volume_signal));
  assert.ok(["in_range", "out_of_range", "unknown"].includes(snapshot.range_state));
  assert.ok(String(snapshot.pool_identifier).startsWith("SyntheticCollectorPool"));
  assert.ok(String(snapshot.pool_name).startsWith("SYNTH-COLLECTOR-"));
}

const serializedCollector = JSON.stringify(collector);
assert.equal(serializedCollector.includes("SYNTHETIC_MOCK_SECRET_VALUE"), false);
assert.match(serializedCollector, /\[REDACTED/);

const forbiddenJsonSnippets = [
  "\"pnl\"",
  "\"apr\"",
  "\"roi\"",
  "\"winrate\"",
  "\"profit_loss\"",
  "\"profitability\"",
  "\"strategy_score\"",
  "\"edge\"",
  "\"live_readiness\"",
  "\"wallet_balance\"",
  "\"transaction_state\"",
  "\"quote_value_total\"",
  "\"trading_recommendation\"",
  "\"deploy_recommendation\"",
  "profitability claim",
  "strategy ranking",
  "live readiness",
  "trading recommendation",
  "deploy recommendation",
];
const lowerSerializedCollector = serializedCollector.toLowerCase();
for (const forbidden of forbiddenJsonSnippets) {
  assert.equal(lowerSerializedCollector.includes(forbidden), false, `collector JSON must not contain ${forbidden}`);
}

const defaultOutput = runCollector();
const defaultPathMatch = defaultOutput.match(/Collector snapshot: (.*collector-snapshot\.json)/);
assert.ok(defaultPathMatch, "default collector path should be printed");
const printedDefaultPath = path.resolve(defaultPathMatch[1]);
assert.equal(printedDefaultPath, path.resolve(defaultCollectorFile));
assert.ok(printedDefaultPath.startsWith(path.resolve(os.tmpdir())));
assert.equal(fs.existsSync(printedDefaultPath), true);
assert.notEqual(printedDefaultPath, path.join(repoRoot, "collector-snapshot.json"));

const packageJson = readJson(path.join(repoRoot, "package.json"));
assert.equal(packageJson.scripts["paper:collect:mock"], "node scripts/paper-collector-mock.js");

const collectorSource = fs.readFileSync(collectorScript, "utf8");
for (const forbidden of [
  "tools/dlmm",
  "tools/wallet",
  "tools/executor",
  "agent.js",
  "config.js",
  "@solana/web3.js",
  "@meteora-ag/dlmm",
  "openai",
  "node-cron",
  "dotenv",
  "fetch(",
  "http.request",
  "https.request",
  "import \"http\"",
  "import \"https\"",
  "require(\"http\")",
  "require(\"https\")",
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
]) {
  assert.equal(collectorSource.includes(forbidden), false, `collector script must not reference ${forbidden}`);
}

assertRepoRuntimeUnchanged();

console.log("Paper mock collector tests passed");
