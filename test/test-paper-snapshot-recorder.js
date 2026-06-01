import assert from "assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-paper-snapshot-test-"));
const positionsFile = path.join(tempDir, "paper-positions.json");
const eventsFile = path.join(tempDir, "paper-events.jsonl");

const runtimeFiles = ["paper-positions.json", "paper-events.jsonl", "strategy-library.json"];
const runtimeBaseline = new Map(runtimeFiles.map((filename) => {
  const fullPath = path.join(repoRoot, filename);
  if (!fs.existsSync(fullPath)) return [filename, null];
  const stat = fs.statSync(fullPath);
  return [filename, { size: stat.size, mtimeMs: stat.mtimeMs }];
}));

process.env.PAPER_POSITIONS_FILE = positionsFile;
process.env.PAPER_EVENTS_FILE = eventsFile;

const paperTradingUrl = `${pathToFileURL(path.join(repoRoot, "paper-trading.js")).href}?snapshot_test=${Date.now()}`;
const {
  appendPaperSnapshotEvent,
  appendPaperSimulatorWarning,
  appendPaperValuationEvent,
  createPaperPosition,
} = await import(paperTradingUrl);

function readEvents() {
  if (!fs.existsSync(eventsFile)) return [];
  return fs.readFileSync(eventsFile, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

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

const secretName = ["WALLET", "PRIVATE", "KEY"].join("_");
const secretValue = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const paper = createPaperPosition({
  pool: "SnapshotPool11111111111111111111111111111111",
  pool_name: "SNAPSHOT-SOL",
  strategy: "spot",
  amount_sol: 0.5,
  reason: "snapshot recorder test",
});
assert.match(paper.paper_id, /^PAPER_/);

const validSnapshot = appendPaperSnapshotEvent(paper.paper_id, {
  simulator_version: "2.1.0",
  data_source_label: "test_fixture",
  confidence_level: "high",
  source_timestamp: "2026-06-01T00:00:00.000Z",
  active_bin: 100,
  lower_bin: 90,
  upper_bin: 110,
  bin_step: 100,
  price_estimate: {
    token_x_per_token_y: 1.25,
    source: "test_fixture",
    confidence_level: "high",
  },
  inventory_estimate: {
    quote_asset: "SOL",
    token_x_amount: 10,
    token_y_amount: 2,
    starting_quote_value: 0.5,
    current_quote_value_naive: 0.5,
  },
}, `snapshot note ${secretName}=${secretValue}`);
assert.equal(validSnapshot.event.type, "paper_snapshot");
assert.equal(validSnapshot.event.summary, "Paper simulator snapshot recorded from provided input");
assert.equal(validSnapshot.event.paper_id, paper.paper_id);
assert.equal(validSnapshot.event.simulator_snapshot.active_bin, 100);
assert.equal(validSnapshot.event.validation.valid, true);
assert.equal(validSnapshot.event.human_review_needed, false);
assert.equal(JSON.stringify(validSnapshot.event).includes(secretValue), false);

const valuation = appendPaperValuationEvent(paper.paper_id, {
  data_source_label: "test_fixture",
  confidence_level: "high",
  source_timestamp: "2026-06-01T00:01:00.000Z",
  inventory_estimate: {
    quote_asset: "SOL",
    starting_quote_value: 0.5,
    current_quote_value_naive: 0.5,
  },
}, "valuation note");
assert.equal(valuation.event.type, "paper_valuation");
assert.equal(valuation.event.summary, "Paper valuation snapshot recorded from provided input");
assert.equal(valuation.event.validation.valid, true);
assert.equal(valuation.event.human_review_needed, false);
assert.equal(valuation.event.summary.includes("calculated"), false);
assert.equal(valuation.event.summary.includes("computed"), false);
assert.equal(valuation.event.summary.includes("profit"), false);
assert.equal(valuation.event.summary.includes("performance"), false);

const warning = appendPaperSimulatorWarning(paper.paper_id, {
  severity: "critical",
  code: "secret_warning",
  message: `warning ${secretName}=${secretValue}`,
  details: {
    token: secretValue,
  },
});
assert.equal(warning.event.type, "paper_simulator_warning");
assert.equal(warning.event.human_review_needed, true);
assert.equal(warning.event.simulator_warning.severity, "unknown");
assert.equal(warning.event.simulator_warning.code, "secret_warning");
assert.equal(JSON.stringify(warning.event).includes(secretValue), false);

const warningSnapshot = appendPaperSnapshotEvent(paper.paper_id, {
  data_source_label: "test_fixture",
  confidence_level: "medium",
  price_estimate: "malformed",
}, "missing timestamp and malformed nested object");
assert.equal(warningSnapshot.event.type, "paper_snapshot");
assert.equal(warningSnapshot.event.human_review_needed, true);
assert.match(warningSnapshot.event.validation.warnings.join(" | "), /source_timestamp/);
assert.match(warningSnapshot.event.validation.warnings.join(" | "), /price_estimate/);

const lowConfidence = appendPaperSnapshotEvent(paper.paper_id, {
  data_source_label: "test_fixture",
  confidence_level: "low",
  source_timestamp: "2026-06-01T00:02:00.000Z",
}, "low confidence snapshot");
assert.equal(lowConfidence.event.human_review_needed, true);
assert.match(lowConfidence.event.validation.warnings.join(" | "), /snapshot confidence is low/);

const beforeUnknownConfidenceCount = readEvents().length;
const unknownConfidence = appendPaperSnapshotEvent(paper.paper_id, {
  data_source_label: "test_fixture",
  confidence_level: "unknown",
  source_timestamp: "2026-06-01T00:02:30.000Z",
}, "unknown confidence snapshot");
assert.equal(unknownConfidence.event.type, "paper_snapshot");
assert.equal(unknownConfidence.event.human_review_needed, true);
assert.match(unknownConfidence.event.validation.warnings.join(" | "), /snapshot confidence is unknown/);
assert.equal(readEvents().length, beforeUnknownConfidenceCount + 1);

const unknownNumeric = appendPaperSnapshotEvent(paper.paper_id, {
  data_source_label: "test_fixture",
  confidence_level: "high",
  source_timestamp: "2026-06-01T00:03:00.000Z",
  active_bin: "",
  price_estimate: {
    token_x_per_token_y: "not-a-number",
  },
}, "unknown numeric snapshot");
assert.equal(unknownNumeric.event.simulator_snapshot.active_bin, null);
assert.equal(unknownNumeric.event.simulator_snapshot.price_estimate.token_x_per_token_y, null);

const beforeRejectCount = readEvents().length;
const nonPaperReject = appendPaperSnapshotEvent("LIVE_POSITION_ADDRESS", {
  data_source_label: "test_fixture",
  confidence_level: "high",
  source_timestamp: "2026-06-01T00:04:00.000Z",
});
assert.equal(nonPaperReject.error, "paper_id must start with PAPER_");
assert.equal(readEvents().length, beforeRejectCount);

const missingPaperReject = appendPaperSnapshotEvent("PAPER_missing", {
  data_source_label: "test_fixture",
  confidence_level: "high",
  source_timestamp: "2026-06-01T00:05:00.000Z",
});
assert.match(missingPaperReject.error, /not found/);
assert.equal(readEvents().length, beforeRejectCount);

const invalidSnapshot = appendPaperSnapshotEvent(paper.paper_id, "bad snapshot input");
assert.equal(invalidSnapshot.error, "simulator snapshot validation failed");
assert.equal(readEvents().length, beforeRejectCount);

const invalidValuation = appendPaperValuationEvent(paper.paper_id, "bad valuation input");
assert.equal(invalidValuation.error, "simulator snapshot validation failed");
assert.equal(readEvents().length, beforeRejectCount);

const events = readEvents();
assert.ok(events.some((event) => event.type === "paper_deploy"));
assert.ok(events.some((event) => event.type === "paper_snapshot"));
assert.ok(events.some((event) => event.type === "paper_valuation"));
assert.ok(events.some((event) => event.type === "paper_simulator_warning"));
assert.equal(events.filter((event) => event.type === "paper_snapshot").length, 5);
assert.equal(events.filter((event) => event.type === "paper_valuation").length, 1);
assert.equal(events.filter((event) => event.type === "paper_simulator_warning").length, 1);

const paperTradingSource = fs.readFileSync(path.join(repoRoot, "paper-trading.js"), "utf8");
for (const forbidden of [
  "@solana/web3.js",
  "@meteora-ag/dlmm",
  "tools/dlmm",
  "tools/wallet",
  "tools/executor",
  "agent.js",
  "config.js",
  "getWallet",
  "getConnection",
  "getDLMM",
  "getPool(",
  "getActiveBin",
  "sendAndConfirmTransaction",
  "fetch(",
  "Jupiter",
]) {
  assert.equal(paperTradingSource.includes(forbidden), false, `paper-trading must not reference ${forbidden}`);
}

assertRepoRuntimeUnchanged();

console.log("Paper snapshot recorder tests passed");
