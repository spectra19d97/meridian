import assert from "assert/strict";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureScript = path.join(repoRoot, "scripts", "create-paper-fixture.js");
const dashboardScript = path.join(repoRoot, "scripts", "paper-dashboard.js");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-paper-dashboard-test-"));

const runtimeFiles = ["paper-positions.json", "paper-events.jsonl", "strategy-library.json", "decision-log.json"];
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

function runDashboard(positionsFile, eventsFile, dashboardFile) {
  return execFileSync(process.execPath, [dashboardScript], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PAPER_POSITIONS_FILE: positionsFile,
      PAPER_EVENTS_FILE: eventsFile,
      DASHBOARD_FILE: dashboardFile,
    },
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

const dashboardOutput = runDashboard(positionsFile, eventsFile, dashboardFile);
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
  "Manual local dashboard. Rerun paper:dashboard to refresh. Do not use this as trading evidence.",
  "Data Complete",
  "Partial Data",
  "Low Confidence",
  "Insufficient Data",
  "Needs Review",
  "Synthetic fixture data detected",
]) {
  assert.match(html, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

assert.match(html, /\[REDACTED/);
assert.equal(html.includes("SYNTHETIC_FIXTURE_SECRET_VALUE"), false);
assert.equal(html.includes("pnl_layers"), false);
assert.equal(html.includes("424242"), false);
assert.equal(html.includes("<img src=x onerror=alert(1)>"), false);
assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
assert.equal(html.includes("<script"), false);
assert.equal(html.includes("onclick="), false);
assert.equal(html.includes("<button"), false);

for (const forbiddenLanguage of ["PnL", "profitable", "winrate", "APR", "ROI", "live performance", "safe for live", "strategy edge"]) {
  assert.equal(html.includes(forbiddenLanguage), false, `dashboard must not contain ${forbiddenLanguage}`);
}

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
