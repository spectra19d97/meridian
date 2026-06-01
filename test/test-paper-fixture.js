import assert from "assert/strict";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureScript = path.join(repoRoot, "scripts", "create-paper-fixture.js");
const reportScript = path.join(repoRoot, "scripts", "paper-report.js");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-paper-fixture-test-"));

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

function runFixtureWithDefaultPaths() {
  const env = { ...process.env };
  delete env.PAPER_POSITIONS_FILE;
  delete env.PAPER_EVENTS_FILE;
  return execFileSync(process.execPath, [fixtureScript], {
    cwd: repoRoot,
    encoding: "utf8",
    env,
  });
}

function runReport(positionsFile, eventsFile) {
  return execFileSync(process.execPath, [reportScript], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PAPER_POSITIONS_FILE: positionsFile,
      PAPER_EVENTS_FILE: eventsFile,
    },
  });
}

const positionsFile = path.join(tempDir, "paper-positions.json");
const eventsFile = path.join(tempDir, "paper-events.jsonl");
const fixtureOutput = runFixture(positionsFile, eventsFile);

assert.match(fixtureOutput, /MERIDIAN SYNTHETIC PAPER FIXTURE/);
assert.match(fixtureOutput, new RegExp(positionsFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.match(fixtureOutput, new RegExp(eventsFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.equal(fs.existsSync(positionsFile), true);
assert.equal(fs.existsSync(eventsFile), true);

const positionsStore = JSON.parse(fs.readFileSync(positionsFile, "utf8"));
const positions = Object.values(positionsStore.positions || {});
assert.equal(positions.length, 7);
assert.ok(positions.every((position) => String(position.paper_id).startsWith("PAPER_")));
assert.ok(positions.every((position) => String(position.pool_name).startsWith("SYNTH-")));
assert.ok(positions.some((position) => position.status === "open"));
assert.ok(positions.some((position) => position.status === "closed"));

const events = fs.readFileSync(eventsFile, "utf8")
  .trim()
  .split(/\r?\n/)
  .map((line) => JSON.parse(line));
assert.ok(events.some((event) => event.type === "paper_snapshot"));
assert.ok(events.some((event) => event.type === "paper_valuation"));
assert.ok(events.some((event) => event.type === "paper_simulator_warning"));
assert.ok(events.every((event) => `${event.summary || ""} ${event.reason || ""}`.includes("synthetic fixture")));
assert.equal(events.some((event) => event.paper_id === "PAPER_fixture_orphan"), false);

const reportOutput = runReport(positionsFile, eventsFile);
for (const expected of [
  "Simulator Snapshot Quality",
  "Data Source Distribution",
  "Confidence Distribution",
  "Positions Needing Review",
  "Snapshot Completeness by Paper Position",
  "Latest Simulator Warnings",
  "Data Complete",
  "Partial Data",
  "Low Confidence",
  "Insufficient Data",
]) {
  assert.match(reportOutput, new RegExp(expected));
}
assert.match(reportOutput, /\[REDACTED/);
assert.equal(reportOutput.includes("SYNTHETIC_FIXTURE_SECRET_VALUE"), false);
assert.equal(reportOutput.includes("424242"), false);
for (const forbiddenLanguage of ["profitable", "winrate", "APR", "ROI", "live performance", "safe for live", "strategy edge"]) {
  assert.equal(reportOutput.includes(forbiddenLanguage), false, `report must not contain ${forbiddenLanguage}`);
}

const defaultOutput = runFixtureWithDefaultPaths();
const defaultPositionsMatch = defaultOutput.match(/Positions: (.*paper-positions\.json)/);
const defaultEventsMatch = defaultOutput.match(/Events: (.*paper-events\.jsonl)/);
assert.ok(defaultPositionsMatch, "default positions path should be printed");
assert.ok(defaultEventsMatch, "default events path should be printed");
assert.ok(path.resolve(defaultPositionsMatch[1]).startsWith(path.resolve(os.tmpdir())));
assert.ok(path.resolve(defaultEventsMatch[1]).startsWith(path.resolve(os.tmpdir())));
assert.notEqual(path.resolve(defaultPositionsMatch[1]), path.join(repoRoot, "paper-positions.json"));
assert.notEqual(path.resolve(defaultEventsMatch[1]), path.join(repoRoot, "paper-events.jsonl"));

const fixtureSource = fs.readFileSync(fixtureScript, "utf8");
for (const forbidden of [
  "tools/dlmm",
  "tools/executor",
  "tools/wallet",
  "agent.js",
  "config.js",
  "getWallet",
  "getConnection",
  "getDLMM",
  "getPool",
  "getActiveBin",
  "fetch(",
  "https.request",
  "http.request",
  "import \"http\"",
  "import \"https\"",
  "require(\"http\")",
  "require(\"https\")",
  "dotenv",
  "user-config.json",
  "logs/",
  "WALLET_PRIVATE_KEY",
  "RPC_URL",
  "@solana/web3.js",
  "@meteora-ag/dlmm",
  "openai",
  "node-cron",
  "Jupiter",
  "OpenAI",
  "sendAndConfirmTransaction",
]) {
  assert.equal(fixtureSource.includes(forbidden), false, `fixture script must not reference ${forbidden}`);
}

assertRepoRuntimeUnchanged();

console.log("Paper fixture tests passed");
