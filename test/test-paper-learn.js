import assert from "assert/strict";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureScript = path.join(repoRoot, "scripts", "create-paper-fixture.js");
const learnScript = path.join(repoRoot, "scripts", "paper-learn.js");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-paper-learn-test-"));

const runtimeFiles = [
  "paper-positions.json",
  "paper-events.jsonl",
  "strategy-library.json",
  "decision-log.json",
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

function runFixture(positionsFile, eventsFile) {
  return execFileSync(process.execPath, [fixtureScript], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PAPER_POSITIONS_FILE: positionsFile,
      PAPER_EVENTS_FILE: eventsFile,
    },
  });
}

function runLearn(positionsFile, eventsFile, learningFile) {
  return execFileSync(process.execPath, [learnScript], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PAPER_POSITIONS_FILE: positionsFile,
      PAPER_EVENTS_FILE: eventsFile,
      LEARNING_FILE: learningFile,
    },
  });
}

function runLearnWithDefaultPath(positionsFile, eventsFile) {
  const env = {
    ...process.env,
    PAPER_POSITIONS_FILE: positionsFile,
    PAPER_EVENTS_FILE: eventsFile,
  };
  delete env.LEARNING_FILE;
  return execFileSync(process.execPath, [learnScript], {
    cwd: repoRoot,
    encoding: "utf8",
    env,
  });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function appendEvent(eventsFile, event) {
  fs.appendFileSync(eventsFile, `${JSON.stringify(event)}\n`);
}

function addPosition(positionsFile, position) {
  const store = readJson(positionsFile);
  store.positions[position.paper_id] = position;
  fs.writeFileSync(positionsFile, `${JSON.stringify(store, null, 2)}\n`);
}

function basePosition(id, poolName) {
  return {
    paper_id: id,
    status: "open",
    created_at: "2026-01-01T01:00:00.000Z",
    updated_at: "2026-01-01T01:00:00.000Z",
    closed_at: null,
    pool: `SyntheticPoolFor${id}`,
    pool_name: poolName,
    base_mint: `SyntheticBaseMintFor${id}`,
    strategy_version: "spot_efficiency_v1",
    strategy_contract_status: "community_hypothesis",
    shape: "spot",
    amount_sol: 0.1,
    risk_flags: ["synthetic_fixture"],
    last_event_id: null,
  };
}

function completeSnapshot(overrides = {}) {
  return {
    simulator_version: "2.1.0",
    data_source_label: "test_fixture",
    confidence_level: "high",
    source_timestamp: "2026-01-01T01:00:00.000Z",
    active_bin: 120,
    lower_bin: 100,
    upper_bin: 140,
    bin_step: 100,
    price_estimate: {
      token_x_per_token_y: 1.25,
      token_y_per_token_x: null,
      source: "synthetic_fixture",
      confidence_level: "high",
    },
    inventory_estimate: {
      quote_asset: "QUOTE",
      token_x_amount: 5,
      token_y_amount: null,
      starting_quote_value: 1,
      current_quote_value_naive: null,
    },
    fee_estimate: {},
    risk_adjustments: {},
    range_state: {
      in_range: true,
      out_of_range: false,
      active_bin_distance_from_range: 0,
    },
    divergence_flags: [],
    ...overrides,
  };
}

function recordById(summary, paperId) {
  return summary.records.find((record) => record.paper_id === paperId);
}

const positionsFile = path.join(tempDir, "paper-positions.json");
const eventsFile = path.join(tempDir, "paper-events.jsonl");
const learningFile = path.join(tempDir, "learning", "learning-summary.json");

runFixture(positionsFile, eventsFile);

appendEvent(eventsFile, {
  event_id: "pevt_fixture_warning_second",
  ts: "2026-01-01T00:36:00.000Z",
  type: "paper_simulator_warning",
  paper_id: "PAPER_fixture_warning",
  strategy_version: "spot_efficiency_v1",
  pool_name: "SYNTH-WARNING-QUOTE",
  summary: "synthetic fixture repeated warning",
  reason: "synthetic fixture repeated warning",
  simulator_warning: { severity: "medium", code: "synthetic_repeated_warning" },
  validation: { valid: true, errors: [], warnings: [] },
});

addPosition(positionsFile, basePosition("PAPER_fixture_invalid", "SYNTH-INVALID-QUOTE"));
appendEvent(eventsFile, {
  event_id: "pevt_fixture_invalid",
  ts: "2026-01-01T01:01:00.000Z",
  type: "paper_snapshot",
  paper_id: "PAPER_fixture_invalid",
  strategy_version: "spot_efficiency_v1",
  pool_name: "SYNTH-INVALID-QUOTE",
  summary: "synthetic fixture invalid local event data",
  reason: "synthetic fixture invalid validation",
  simulator_snapshot: completeSnapshot(),
  validation: { valid: false, errors: ["synthetic invalid fixture"], warnings: [] },
});

addPosition(positionsFile, basePosition("PAPER_fixture_oor", "SYNTH-OOR-QUOTE"));
appendEvent(eventsFile, {
  event_id: "pevt_fixture_oor",
  ts: "2026-01-01T01:02:00.000Z",
  type: "paper_snapshot",
  paper_id: "PAPER_fixture_oor",
  strategy_version: "spot_efficiency_v1",
  pool_name: "SYNTH-OOR-QUOTE",
  summary: "synthetic fixture out of range observation",
  reason: "synthetic fixture range state observation",
  simulator_snapshot: completeSnapshot({
    range_state: {
      in_range: false,
      out_of_range: true,
      active_bin_distance_from_range: 5,
    },
  }),
  validation: { valid: true, errors: [], warnings: [] },
});

appendEvent(eventsFile, {
  event_id: "pevt_fixture_orphan",
  ts: "2026-01-01T01:03:00.000Z",
  type: "paper_snapshot",
  paper_id: "PAPER_fixture_orphan",
  strategy_version: "spot_efficiency_v1",
  pool_name: "SYNTH-ORPHAN-QUOTE",
  summary: "synthetic fixture orphan event",
  reason: "PRIVATE_KEY=SHOULD_NOT_RENDER synthetic fixture orphan event",
  simulator_snapshot: completeSnapshot(),
  validation: { valid: true, errors: [], warnings: [] },
});

const learnOutput = runLearn(positionsFile, eventsFile, learningFile);
assert.match(learnOutput, /MERIDIAN PAPER LEARNING SUMMARY/);
assert.match(learnOutput, /Safety: local files only; no wallet\/RPC\/API\/SDK calls/);
assert.match(learnOutput, new RegExp(learningFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.equal(fs.existsSync(learningFile), true);

const summary = readJson(learningFile);
assert.equal(summary.schema_version, "learning_v0.1");
assert.equal(summary.safety.local_files_only, true);
assert.equal(summary.safety.no_live_calls, true);
assert.equal(summary.safety.no_pnl_or_valuation_math, true);
assert.equal(summary.safety.not_trading_advice, true);
assert.ok(summary.records.length >= 10);
assert.equal(summary.summary.synthetic_fixture_detected, true);

assert.equal(recordById(summary, "PAPER_fixture_complete").current_review_label, "Data Healthy");
assert.equal(recordById(summary, "PAPER_fixture_closed").current_review_label, "Insufficient Data");
assert.equal(recordById(summary, "PAPER_fixture_lowconf").current_review_label, "Low Confidence");
assert.equal(recordById(summary, "PAPER_fixture_unknown").current_review_label, "Low Confidence");
assert.equal(recordById(summary, "PAPER_fixture_stale").current_review_label, "Stale Data");
assert.equal(recordById(summary, "PAPER_fixture_warning").current_review_label, "Warning Cluster");
assert.equal(recordById(summary, "PAPER_fixture_invalid").current_review_label, "Invalid Data");
assert.equal(recordById(summary, "PAPER_fixture_oor").current_review_label, "Out Of Range");
assert.equal(recordById(summary, "PAPER_fixture_orphan").current_review_label, "Needs Review");

assert.ok(recordById(summary, "PAPER_fixture_warning").notes.includes("This record has repeated warnings."));
assert.ok(recordById(summary, "PAPER_fixture_lowconf").notes.includes("This paper record needs review because confidence is low or unknown."));
assert.ok(recordById(summary, "PAPER_fixture_complete").notes.includes("This record has usable local event data. This is not a trade-quality label."));
assert.equal(JSON.stringify(summary).includes("SHOULD_NOT_RENDER"), false);
assert.match(JSON.stringify(summary), /\[REDACTED/);

const forbiddenOutputTerms = [
  "\"pnl\"",
  "\"apr\"",
  "\"roi\"",
  "\"winrate\"",
  "\"profitability\"",
  "\"strategy_score\"",
  "\"edge\"",
  "\"live_readiness\"",
  "\"wallet_balance\"",
  "\"transaction_state\"",
  "\"quote_value_total\"",
];
const serializedSummary = JSON.stringify(summary).toLowerCase();
for (const forbidden of forbiddenOutputTerms) {
  assert.equal(serializedSummary.includes(forbidden), false, `learning output must not contain ${forbidden}`);
}

const defaultOutput = runLearnWithDefaultPath(positionsFile, eventsFile);
const defaultPathMatch = defaultOutput.match(/Learning file: (.*learning-summary\.json)/);
assert.ok(defaultPathMatch, "default learning path should be printed");
const defaultLearningPath = path.resolve(defaultPathMatch[1]);
assert.ok(defaultLearningPath.startsWith(path.resolve(os.tmpdir())));
assert.equal(defaultLearningPath.endsWith(path.join("meridian-paper-learning", "learning-summary.json")), true);
assert.notEqual(defaultLearningPath, path.join(repoRoot, "learning-summary.json"));

const packageJson = readJson(path.join(repoRoot, "package.json"));
assert.equal(packageJson.scripts["paper:learn"], "node scripts/paper-learn.js");

const learnSource = fs.readFileSync(learnScript, "utf8");
for (const forbidden of [
  "tools/dlmm",
  "tools/executor",
  "tools/wallet",
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
  "user-config.json",
  "logs/",
  "RPC_URL",
  "WALLET_PRIVATE_KEY",
]) {
  assert.equal(learnSource.includes(forbidden), false, `learning script must not reference ${forbidden}`);
}

assertRepoRuntimeUnchanged();

console.log("Paper learning tests passed");
