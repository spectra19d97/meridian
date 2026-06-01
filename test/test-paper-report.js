import assert from "assert/strict";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(repoRoot, "scripts", "paper-report.js");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-paper-report-test-"));

const runtimeFiles = ["paper-positions.json", "paper-events.jsonl", "strategy-library.json"];
const runtimeBaseline = new Map(runtimeFiles.map((filename) => {
  const fullPath = path.join(repoRoot, filename);
  if (!fs.existsSync(fullPath)) return [filename, null];
  const stat = fs.statSync(fullPath);
  return [filename, { size: stat.size, mtimeMs: stat.mtimeMs }];
}));

function runReport(positionsFile, eventsFile) {
  return execFileSync(process.execPath, [scriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PAPER_POSITIONS_FILE: positionsFile,
      PAPER_EVENTS_FILE: eventsFile,
    },
  });
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

const positionsFile = path.join(tempDir, "paper-positions.json");
const eventsFile = path.join(tempDir, "paper-events.jsonl");
const secret = "WALLET_PRIVATE_KEY=4Nd1mZFbDq5uE6JkTgq4HdoJ9QdBbrF7yEgJ4ucbBnEXAMPLEPRIVATEKEYVALUE123456789";

fs.writeFileSync(positionsFile, JSON.stringify({
  positions: {
    PAPER_open: {
      paper_id: "PAPER_open",
      status: "open",
      created_at: "2026-05-30T00:00:00.000Z",
      updated_at: "2026-05-30T00:10:00.000Z",
      closed_at: null,
      pool: "PoolOpen1111111111111111111111111111111111",
      pool_name: "SAFE-SOL",
      strategy_version: "spot_efficiency_v1",
      shape: "spot",
      amount_sol: 0.5,
      entry_reason: `safe entry ${secret}`,
      last_event_id: "pevt_open",
    },
    PAPER_closed: {
      paper_id: "PAPER_closed",
      status: "closed",
      created_at: "2026-05-30T01:00:00.000Z",
      updated_at: "2026-05-30T01:30:00.000Z",
      closed_at: "2026-05-30T01:30:00.000Z",
      pool: "PoolClosed11111111111111111111111111111111",
      pool_name: "CLOSED-SOL",
      strategy_id: "bidask_dump_reversal_v1",
      shape: "bid_ask",
      amount_sol: 0.25,
      entry_reason: "closed test",
      last_event_id: "pevt_close",
    },
    PAPER_complete: {
      paper_id: "PAPER_complete",
      status: "open",
      created_at: "2026-05-30T03:00:00.000Z",
      updated_at: "2026-05-30T03:00:00.000Z",
      closed_at: null,
      pool: "PoolComplete111111111111111111111111111111",
      pool_name: "COMPLETE-SOL",
      strategy_version: "spot_efficiency_v1",
      shape: "spot",
      amount_sol: 0.1,
      last_event_id: "pevt_complete_snapshot",
    },
    PAPER_partial: {
      paper_id: "PAPER_partial",
      status: "open",
      created_at: "2026-05-30T03:10:00.000Z",
      updated_at: "2026-05-30T03:10:00.000Z",
      closed_at: null,
      pool: "PoolPartial1111111111111111111111111111111",
      pool_name: "PARTIAL-SOL",
      strategy_version: "spot_efficiency_v1",
      shape: "spot",
      amount_sol: 0.1,
      last_event_id: "pevt_partial_snapshot",
    },
    PAPER_low: {
      paper_id: "PAPER_low",
      status: "open",
      created_at: "2026-05-30T03:20:00.000Z",
      updated_at: "2026-05-30T03:20:00.000Z",
      closed_at: null,
      pool: "PoolLow1111111111111111111111111111111111",
      pool_name: "LOW-SOL",
      strategy_version: "spot_efficiency_v1",
      shape: "spot",
      amount_sol: 0.1,
      last_event_id: "pevt_low_snapshot",
    },
    PAPER_unknown: {
      paper_id: "PAPER_unknown",
      status: "open",
      created_at: "2026-05-30T03:30:00.000Z",
      updated_at: "2026-05-30T03:30:00.000Z",
      closed_at: null,
      pool: "PoolUnknown111111111111111111111111111111",
      pool_name: "UNKNOWN-SOL",
      strategy_version: "spot_efficiency_v1",
      shape: "spot",
      amount_sol: 0.1,
      last_event_id: "pevt_unknown_snapshot",
    },
    PAPER_stale: {
      paper_id: "PAPER_stale",
      status: "open",
      created_at: "2026-05-30T03:40:00.000Z",
      updated_at: "2026-05-30T03:40:00.000Z",
      closed_at: null,
      pool: "PoolStale11111111111111111111111111111111",
      pool_name: "STALE-SOL",
      strategy_version: "spot_efficiency_v1",
      shape: "spot",
      amount_sol: 0.1,
      last_event_id: "pevt_stale_snapshot",
    },
  },
}, null, 2));

fs.writeFileSync(eventsFile, [
  JSON.stringify({ event_id: "pevt_open", ts: "2026-05-30T00:00:00.000Z", type: "paper_deploy", paper_id: "PAPER_open", strategy_version: "spot_efficiency_v1", pool_name: "SAFE-SOL", reason: `deploy ${secret}` }),
  JSON.stringify({ event_id: "pevt_claim", ts: "2026-05-30T00:05:00.000Z", type: "paper_claim", paper_id: "PAPER_open", strategy_version: "spot_efficiency_v1", pool_name: "SAFE-SOL", reason: "claim test" }),
  JSON.stringify({ event_id: "pevt_close", ts: "2026-05-30T01:30:00.000Z", type: "paper_close", paper_id: "PAPER_closed", strategy: "bidask_dump_reversal_v1", pool_name: "CLOSED-SOL", reason: "close test" }),
  JSON.stringify({ event_id: "pevt_reject", ts: "2026-05-30T02:00:00.000Z", type: "paper_reject", paper_id: null, strategy_version: null, pool_name: "REJECTED-SOL", reason: "reject test" }),
  JSON.stringify({ event_id: "pevt_anomaly", ts: "2026-05-30T02:05:00.000Z", type: "paper_anomaly", paper_id: "PAPER_open", strategy_version: "spot_efficiency_v1", pool_name: "SAFE-SOL", reason: "anomaly test" }),
  JSON.stringify({ event_id: "pevt_snapshot", ts: "2026-05-30T02:06:00.000Z", type: "paper_snapshot", paper_id: "PAPER_open", strategy_version: "spot_efficiency_v1", pool_name: "SAFE-SOL", reason: "snapshot test" }),
  JSON.stringify({ event_id: "pevt_valuation", ts: "2026-05-30T02:07:00.000Z", type: "paper_valuation", paper_id: "PAPER_open", strategy_version: "spot_efficiency_v1", pool_name: "SAFE-SOL", reason: "valuation test" }),
  JSON.stringify({ event_id: "pevt_sim_warning", ts: "2026-05-30T02:08:00.000Z", type: "paper_simulator_warning", paper_id: "PAPER_open", strategy_version: "spot_efficiency_v1", pool_name: "SAFE-SOL", reason: "simulator warning test" }),
  JSON.stringify({
    event_id: "pevt_complete_snapshot",
    ts: "2026-05-30T03:00:00.000Z",
    type: "paper_snapshot",
    paper_id: "PAPER_complete",
    strategy_version: "spot_efficiency_v1",
    pool_name: "COMPLETE-SOL",
    reason: "data quality record",
    simulator_snapshot: {
      source_timestamp: "2026-05-30T02:59:00.000Z",
      confidence_level: "high",
      data_source_label: "paper_input",
      active_bin: 100,
      lower_bin: 90,
      upper_bin: 110,
      bin_step: 100,
      price_estimate: { token_x_per_token_y: 1.1 },
      inventory_estimate: { quote_asset: "SOL", token_x_amount: 5 },
      range_state: { in_range: true },
      pnl_layers: { naive_paper_pnl_quote_value: 9999 },
    },
    validation: { valid: true, errors: [], warnings: [] },
  }),
  JSON.stringify({
    event_id: "pevt_partial_snapshot",
    ts: "2026-05-30T03:10:00.000Z",
    type: "paper_snapshot",
    paper_id: "PAPER_partial",
    strategy_version: "spot_efficiency_v1",
    pool_name: "PARTIAL-SOL",
    reason: "partial snapshot test",
    simulator_snapshot: {
      source_timestamp: "2026-05-30T03:09:00.000Z",
      confidence_level: "medium",
      data_source_label: "manual_import",
      inventory_estimate: { quote_asset: "SOL" },
      price_estimate: {},
      range_state: {},
    },
    validation: { valid: true, errors: [], warnings: [] },
  }),
  JSON.stringify({
    event_id: "pevt_low_snapshot",
    ts: "2026-05-30T03:20:00.000Z",
    type: "paper_snapshot",
    paper_id: "PAPER_low",
    strategy_version: "spot_efficiency_v1",
    pool_name: "LOW-SOL",
    reason: "low confidence snapshot",
    simulator_snapshot: {
      source_timestamp: "2026-05-30T03:19:00.000Z",
      confidence_level: "low",
      data_source_label: "recorded_snapshot",
      active_bin: 120,
      lower_bin: 100,
      upper_bin: 130,
      bin_step: 100,
      price_estimate: { token_y_per_token_x: 0.9 },
      inventory_estimate: { quote_asset: "SOL", starting_quote_value: 1 },
      range_state: { in_range: true },
    },
    validation: { valid: true, errors: [], warnings: ["snapshot confidence is low"] },
  }),
  JSON.stringify({
    event_id: "pevt_unknown_snapshot",
    ts: "2026-05-30T03:30:00.000Z",
    type: "paper_snapshot",
    paper_id: "PAPER_unknown",
    strategy_version: "spot_efficiency_v1",
    pool_name: "UNKNOWN-SOL",
    reason: "unknown confidence and source",
    simulator_snapshot: {
      source_timestamp: "2026-05-30T03:29:00.000Z",
      confidence_level: "unknown",
      data_source_label: "unknown",
      active_bin: 120,
      lower_bin: 100,
      upper_bin: 130,
      bin_step: 100,
      price_estimate: { token_y_per_token_x: 0.9 },
      inventory_estimate: { quote_asset: "SOL", starting_quote_value: 1 },
      range_state: { in_range: true },
    },
    validation: { valid: true, errors: [], warnings: ["snapshot confidence is unknown"] },
  }),
  JSON.stringify({
    event_id: "pevt_stale_snapshot",
    ts: "2026-05-30T05:00:00.000Z",
    type: "paper_snapshot",
    paper_id: "PAPER_stale",
    strategy_version: "spot_efficiency_v1",
    pool_name: "STALE-SOL",
    reason: "stale source timestamp",
    simulator_snapshot: {
      source_timestamp: "2026-05-30T03:30:00.000Z",
      confidence_level: "high",
      data_source_label: "test_fixture",
      active_bin: 120,
      lower_bin: 100,
      upper_bin: 130,
      bin_step: 100,
      price_estimate: { token_y_per_token_x: 0.9 },
      inventory_estimate: { quote_asset: "SOL", starting_quote_value: 1 },
      range_state: { in_range: true },
    },
    validation: { valid: true, errors: [], warnings: [] },
  }),
  JSON.stringify({
    event_id: "pevt_orphan_snapshot",
    ts: "2026-05-30T05:05:00.000Z",
    type: "paper_snapshot",
    paper_id: "PAPER_orphan",
    strategy_version: "spot_efficiency_v1",
    pool_name: "ORPHAN-SOL",
    reason: "orphan simulator event",
    simulator_snapshot: {
      source_timestamp: "2026-05-30T05:04:00.000Z",
      confidence_level: "medium",
      data_source_label: "manual_import",
      active_bin: 1,
      lower_bin: 0,
      upper_bin: 2,
      bin_step: 100,
      price_estimate: { token_x_per_token_y: 1 },
      inventory_estimate: { quote_asset: "SOL", token_x_amount: 1 },
      range_state: { in_range: true },
    },
    validation: { valid: true, errors: [], warnings: [] },
  }),
  JSON.stringify({
    event_id: "pevt_orphan_warning",
    ts: "2026-05-30T05:06:00.000Z",
    type: "paper_simulator_warning",
    paper_id: "PAPER_orphan_warning",
    strategy_version: "spot_efficiency_v1",
    pool_name: "ORPHAN-WARN-SOL",
    reason: `warning ${secret}`,
    simulator_warning: { severity: "high", code: "orphan_warning", details: { note: secret } },
  }),
  JSON.stringify({ event_id: "pevt_unknown", ts: "2026-05-30T02:10:00.000Z", type: "unexpected_event", paper_id: "PAPER_open", strategy_version: "spot_efficiency_v1", pool_name: "SAFE-SOL", reason: "unknown test" }),
  "{ malformed jsonl line",
].join("\n"));

const output = runReport(positionsFile, eventsFile);
assert.match(output, /MERIDIAN PAPER \/ DRY-RUN REPORT/);
assert.match(output, /Safety: local files only; no wallet\/RPC\/API\/SDK calls/);
assert.match(output, /Total paper positions: 7/);
assert.match(output, /Open: 6/);
assert.match(output, /Closed: 1/);
assert.match(output, /Deploy events: 1/);
assert.match(output, /Claim events: 1/);
assert.match(output, /Close events: 1/);
assert.match(output, /Snapshot events: 7/);
assert.match(output, /Valuation snapshot events: 1/);
assert.match(output, /Simulator warning events: 2/);
assert.match(output, /Anomaly\/reject\/error events: 6/);
assert.match(output, /spot_efficiency_v1: 6/);
assert.match(output, /bidask_dump_reversal_v1: 1/);
assert.match(output, /SAFE-SOL: 1/);
assert.match(output, /CLOSED-SOL: 1/);
assert.match(output, /PAPER_open \| SAFE-SOL \| spot_efficiency_v1 \| 0.5/);
assert.match(output, /PAPER_closed \| CLOSED-SOL \| bidask_dump_reversal_v1 \| Insufficient Data/);
assert.match(output, /paper_snapshot \| PAPER_complete \| COMPLETE-SOL \| spot_efficiency_v1 \| data quality record/);
assert.match(output, /paper_valuation \| PAPER_open \| SAFE-SOL \| spot_efficiency_v1 \| valuation test/);
assert.match(output, /paper_simulator_warning \| PAPER_open \| SAFE-SOL \| spot_efficiency_v1 \| simulator warning test/);
assert.match(output, /Simulator Snapshot Quality:/);
assert.match(output, /Positions with simulator data: 6/);
assert.match(output, /Data Complete: 2/);
assert.match(output, /Partial Data: 3/);
assert.match(output, /Low Confidence: 3/);
assert.match(output, /Insufficient Data: 1/);
assert.match(output, /Needs review: 8/);
assert.match(output, /Data Source Distribution:/);
assert.match(output, /paper_input: 1/);
assert.match(output, /recorded_snapshot: 1/);
assert.match(output, /manual_import: 1/);
assert.match(output, /test_fixture: 1/);
assert.match(output, /unknown: 3/);
assert.match(output, /Confidence Distribution:/);
assert.match(output, /high: 2/);
assert.match(output, /medium: 1/);
assert.match(output, /low: 1/);
assert.match(output, /unknown: 3/);
assert.match(output, /Positions Needing Review:/);
assert.match(output, /PAPER_low \| LOW-SOL \| spot_efficiency_v1 \| Low Confidence \| confidence low, validation warnings/);
assert.match(output, /PAPER_unknown \| UNKNOWN-SOL \| spot_efficiency_v1 \| Low Confidence \| confidence unknown, data source unknown, validation warnings/);
assert.match(output, /PAPER_orphan \| ORPHAN-SOL \| spot_efficiency_v1 \| Partial Data \| orphan simulator event/);
assert.match(output, /PAPER_stale \| STALE-SOL \| spot_efficiency_v1 \| Data Complete \| stale source timestamp/);
assert.match(output, /Snapshot Completeness by Paper Position:/);
assert.match(output, /PAPER_complete \| COMPLETE-SOL \| 2026-05-30T03:00:00.000Z \| Data Complete \| needs_review=false \| missing: none/);
assert.match(output, /PAPER_partial \| PARTIAL-SOL \| 2026-05-30T03:10:00.000Z \| Partial Data \| needs_review=true \| missing: active_bin, range, bin_step, price estimate, inventory estimate, range_state/);
assert.match(output, /PAPER_closed \| CLOSED-SOL \| none \| Insufficient Data \| needs_review=true/);
assert.match(output, /Latest Simulator Warnings:/);
assert.match(output, /PAPER_orphan_warning \| ORPHAN-WARN-SOL \| high \| orphan_warning \| warning WALLET_PRIVATE_KEY=\[REDACTED\]/);
assert.match(output, /\[REDACTED/);
assert.equal(output.includes("4Nd1mZ"), false);
assert.equal(output.includes("9999"), false);
for (const forbiddenLanguage of ["profitable", "winrate", "APR", "ROI", "live performance", "safe for live"]) {
  assert.equal(output.includes(forbiddenLanguage), false, `report must not contain ${forbiddenLanguage}`);
}

const missingOutput = runReport(
  path.join(tempDir, "missing-positions.json"),
  path.join(tempDir, "missing-events.jsonl"),
);
assert.match(missingOutput, /Positions: .*missing/);
assert.match(missingOutput, /Events: .*missing/);
assert.match(missingOutput, /Total paper positions: 0/);

const malformedPositions = path.join(tempDir, "malformed-positions.json");
fs.writeFileSync(malformedPositions, "{ malformed json");
const malformedOutput = runReport(malformedPositions, eventsFile);
assert.match(malformedOutput, /Positions: .*parse_error/);
assert.match(malformedOutput, /Total paper positions: 0/);

const scriptSource = fs.readFileSync(scriptPath, "utf8");
for (const forbidden of [
  "fetch(",
  "http",
  "https",
  "dotenv",
  "\".env\"",
  "'.env'",
  "\"./.env\"",
  "'./.env'",
  "user-config.json",
  "logs/",
  "WALLET_PRIVATE_KEY",
  "RPC_URL",
  "PRIVATE_KEY",
  "SECRET_KEY",
  "API_KEY",
  "LLM_API_KEY",
  "OPENAI_API_KEY",
  "@solana/web3.js",
  "@meteora-ag/dlmm",
  "openai",
  "node-cron",
  "tools/dlmm",
  "tools/wallet",
  "tools/executor",
  "agent.js",
  "index.js",
  "getWallet",
  "getConnection",
  "Jupiter",
  "OpenAI",
]) {
  assert.equal(scriptSource.includes(forbidden), false, `paper report must not reference ${forbidden}`);
}

assertRepoRuntimeUnchanged();

console.log("Paper report tests passed");
