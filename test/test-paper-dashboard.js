import assert from "assert/strict";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureScript = path.join(repoRoot, "scripts", "create-paper-fixture.js");
const learnScript = path.join(repoRoot, "scripts", "paper-learn.js");
const dashboardScript = path.join(repoRoot, "scripts", "paper-dashboard.js");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-paper-dashboard-test-"));

const runtimeFiles = ["paper-positions.json", "paper-events.jsonl", "strategy-library.json", "decision-log.json", "learning-summary.json"];
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

function runDashboard(positionsFile, eventsFile, dashboardFile, learningFile) {
  return execFileSync(process.execPath, [dashboardScript], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PAPER_POSITIONS_FILE: positionsFile,
      PAPER_EVENTS_FILE: eventsFile,
      DASHBOARD_FILE: dashboardFile,
      LEARNING_FILE: learningFile,
    },
  });
}

function runDashboardWithoutLearningFile(positionsFile, eventsFile, dashboardFile) {
  const env = {
    ...process.env,
    PAPER_POSITIONS_FILE: positionsFile,
    PAPER_EVENTS_FILE: eventsFile,
    DASHBOARD_FILE: dashboardFile,
  };
  delete env.LEARNING_FILE;
  return execFileSync(process.execPath, [dashboardScript], {
    cwd: repoRoot,
    encoding: "utf8",
    env,
  });
}

function runDashboardWithDefaultPath(positionsFile, eventsFile) {
  const env = {
    ...process.env,
    PAPER_POSITIONS_FILE: positionsFile,
    PAPER_EVENTS_FILE: eventsFile,
  };
  delete env.DASHBOARD_FILE;
  return execFileSync(process.execPath, [dashboardScript], {
    cwd: repoRoot,
    encoding: "utf8",
    env,
  });
}

const positionsFile = path.join(tempDir, "paper-positions.json");
const eventsFile = path.join(tempDir, "paper-events.jsonl");
const learningFile = path.join(tempDir, "learning", "learning-summary.json");
const dashboardFile = path.join(tempDir, "dashboard", "index.html");

runFixture(positionsFile, eventsFile);
fs.appendFileSync(eventsFile, `${JSON.stringify({
  event_id: "pevt_fixture_unsafe_html",
  ts: "2026-01-01T03:00:00.000Z",
  type: "paper_hold_note",
  paper_id: "PAPER_fixture_complete",
  strategy_version: "spot_efficiency_v1",
  pool_name: "SYNTH-COMPLETE-QUOTE",
  summary: "<img src=x onerror=alert(1)> synthetic fixture unsafe local event note",
  reason: "<img src=x onerror=alert(1)> synthetic fixture unsafe local event note",
})}\n`);

runLearn(positionsFile, eventsFile, learningFile);
const learning = JSON.parse(fs.readFileSync(learningFile, "utf8"));
learning.records.push(
  {
    schema_version: "learning_v0.1",
    generated_at: "2026-01-01T04:00:00.000Z",
    paper_id: "PAPER_fixture_warning_cluster",
    pool_name: "SYNTH-WARNING-CLUSTER-QUOTE",
    strategy_version: "spot_efficiency_v1",
    current_review_label: "Warning Cluster",
    review_reasons: ["repeated warnings"],
    learning_flags: ["repeated_warnings"],
    snapshot_count: 1,
    warning_count: 2,
    stale_count: 0,
    low_confidence_count: 0,
    invalid_data_count: 0,
    out_of_range_observation_count: 0,
    synthetic_fixture_detected: true,
    notes: ["This record has repeated warnings.", "PRIVATE_KEY=SHOULD_NOT_RENDER <img src=x onerror=alert(2)>"],
    pnl_layers: { sentinel: 424242 },
  },
  {
    schema_version: "learning_v0.1",
    generated_at: "2026-01-01T04:01:00.000Z",
    paper_id: "PAPER_fixture_invalid_learning",
    pool_name: "SYNTH-INVALID-LEARNING-QUOTE",
    strategy_version: "spot_efficiency_v1",
    current_review_label: "Invalid Data",
    review_reasons: ["invalid local event data"],
    learning_flags: ["invalid_local_event_data"],
    snapshot_count: 1,
    warning_count: 0,
    stale_count: 0,
    low_confidence_count: 0,
    invalid_data_count: 1,
    out_of_range_observation_count: 0,
    synthetic_fixture_detected: true,
    notes: ["This record has invalid local event data."],
  },
  {
    schema_version: "learning_v0.1",
    generated_at: "2026-01-01T04:02:00.000Z",
    paper_id: "PAPER_fixture_oor_learning",
    pool_name: "SYNTH-OOR-LEARNING-QUOTE",
    strategy_version: "spot_efficiency_v1",
    current_review_label: "Out Of Range",
    review_reasons: ["recorded out of range"],
    learning_flags: ["recorded_out_of_range"],
    snapshot_count: 1,
    warning_count: 0,
    stale_count: 0,
    low_confidence_count: 0,
    invalid_data_count: 0,
    out_of_range_observation_count: 1,
    synthetic_fixture_detected: true,
    notes: ["This record was marked out of range by recorded snapshot data."],
  },
  {
    schema_version: "learning_v0.1",
    generated_at: "2026-01-01T04:03:00.000Z",
    paper_id: "PAPER_fixture_needs_review",
    pool_name: "SYNTH-NEEDS-REVIEW-QUOTE",
    strategy_version: "spot_efficiency_v1",
    current_review_label: "Needs Review",
    review_reasons: ["orphan paper event"],
    learning_flags: ["orphan_paper_event"],
    snapshot_count: 1,
    warning_count: 0,
    stale_count: 0,
    low_confidence_count: 0,
    invalid_data_count: 0,
    out_of_range_observation_count: 0,
    synthetic_fixture_detected: true,
    notes: ["This paper record needs review based on local event history."],
  },
);
learning.summary.warning_cluster_count = 1;
learning.summary.invalid_data_count = 1;
learning.summary.out_of_range_count = 1;
learning.summary.needs_review_count = 1;
fs.writeFileSync(learningFile, `${JSON.stringify(learning, null, 2)}\n`);

const dashboardOutput = runDashboard(positionsFile, eventsFile, dashboardFile, learningFile);
assert.match(dashboardOutput, /MERIDIAN PAPER DASHBOARD/);
assert.match(dashboardOutput, new RegExp(dashboardFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.equal(fs.existsSync(dashboardFile), true);
assert.equal(fs.existsSync(path.join(repoRoot, "paper-dashboard.html")), false);
assert.equal(fs.existsSync(path.join(repoRoot, "index.html")), false);

const html = fs.readFileSync(dashboardFile, "utf8");
for (const expected of [
  "MERIDIAN PAPER / DRY-RUN DASHBOARD",
  "Local paper files only. Data-quality view only. Not a trading interface.",
  "Summary",
  "Strategy Usage",
  "Pool Usage",
  "Simulator Snapshot Quality",
  "Data Source Distribution",
  "Confidence Distribution",
  "Positions Needing Review",
  "Open Positions",
  "Snapshot Completeness by Paper Position",
  "Latest Simulator Warnings",
  "Latest Paper Events",
  "Learning Summary",
  "Learning Labels",
  "Review Priority",
  "Warning Clusters",
  "Latest Learning Notes",
  "Learning Records",
  "Manual local dashboard. Rerun paper:dashboard to refresh. Do not use this as trading evidence.",
  "Data Complete",
  "Partial Data",
  "Low Confidence",
  "Insufficient Data",
  "Needs Review",
  "Data Healthy",
  "Stale Data",
  "Warning Cluster",
  "Invalid Data",
  "Out Of Range",
  "Local paper data only. Data-health view only. Not trading advice.",
  "Synthetic fixture data detected",
]) {
  assert.match(html, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

assert.match(html, /\[REDACTED/);
assert.equal(html.includes("SYNTHETIC_FIXTURE_SECRET_VALUE"), false);
assert.equal(html.includes("SHOULD_NOT_RENDER"), false);
assert.equal(html.includes("pnl_layers"), false);
assert.equal(html.includes("424242"), false);
assert.equal(html.includes("<img src=x onerror=alert(1)>"), false);
assert.equal(html.includes("<img src=x onerror=alert(2)>"), false);
assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
assert.match(html, /&lt;img src=x onerror=alert\(2\)&gt;/);
assert.equal(html.includes("<script"), false);
assert.equal(html.includes("onclick="), false);
assert.equal(html.includes("<button"), false);

for (const forbiddenLanguage of [
  "PnL",
  "APR",
  "ROI",
  "winrate",
  "profitability",
  "strategy ranking",
  "live readiness",
  "trade recommendation",
  "deploy recommendation",
  "wallet balance",
  "real transaction state",
  "quote-value aggregation",
  "profitable",
  "safe for live",
  "strategy edge",
]) {
  assert.equal(html.includes(forbiddenLanguage), false, `dashboard must not contain ${forbiddenLanguage}`);
}

const missingLearningDashboardFile = path.join(tempDir, "dashboard-missing-learning", "index.html");
runDashboard(positionsFile, eventsFile, missingLearningDashboardFile, path.join(tempDir, "missing-learning-summary.json"));
const missingLearningHtml = fs.readFileSync(missingLearningDashboardFile, "utf8");
assert.match(missingLearningHtml, /Learning summary: missing/);

const malformedLearningFile = path.join(tempDir, "learning", "malformed-learning-summary.json");
const malformedDashboardFile = path.join(tempDir, "dashboard-malformed-learning", "index.html");
fs.writeFileSync(malformedLearningFile, "{ not json");
runDashboard(positionsFile, eventsFile, malformedDashboardFile, malformedLearningFile);
const malformedLearningHtml = fs.readFileSync(malformedDashboardFile, "utf8");
assert.match(malformedLearningHtml, /Learning file unreadable/);

const defaultOutput = runDashboardWithDefaultPath(positionsFile, eventsFile);
const defaultPathMatch = defaultOutput.match(/Dashboard: (.*index\.html)/);
assert.ok(defaultPathMatch, "default dashboard path should be printed");
const defaultDashboardPath = path.resolve(defaultPathMatch[1]);
assert.ok(defaultDashboardPath.startsWith(path.resolve(os.tmpdir())));
assert.equal(defaultDashboardPath.endsWith(path.join("meridian-paper-dashboard", "index.html")), true);
assert.notEqual(defaultDashboardPath, path.join(repoRoot, "index.html"));
assert.notEqual(defaultDashboardPath, path.join(repoRoot, "paper-dashboard.html"));

const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
assert.equal(packageJson.scripts["paper:dashboard"], "node scripts/paper-dashboard.js");

const dashboardSource = fs.readFileSync(dashboardScript, "utf8");
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
  assert.equal(dashboardSource.includes(forbidden), false, `dashboard script must not reference ${forbidden}`);
}

assertRepoRuntimeUnchanged();

console.log("Paper dashboard tests passed");
