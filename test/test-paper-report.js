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
  },
}, null, 2));

fs.writeFileSync(eventsFile, [
  JSON.stringify({ event_id: "pevt_open", ts: "2026-05-30T00:00:00.000Z", type: "paper_deploy", paper_id: "PAPER_open", strategy_version: "spot_efficiency_v1", pool_name: "SAFE-SOL", reason: `deploy ${secret}` }),
  JSON.stringify({ event_id: "pevt_claim", ts: "2026-05-30T00:05:00.000Z", type: "paper_claim", paper_id: "PAPER_open", strategy_version: "spot_efficiency_v1", pool_name: "SAFE-SOL", reason: "claim test" }),
  JSON.stringify({ event_id: "pevt_close", ts: "2026-05-30T01:30:00.000Z", type: "paper_close", paper_id: "PAPER_closed", strategy: "bidask_dump_reversal_v1", pool_name: "CLOSED-SOL", reason: "close test" }),
  JSON.stringify({ event_id: "pevt_reject", ts: "2026-05-30T02:00:00.000Z", type: "paper_reject", paper_id: null, strategy_version: null, pool_name: "REJECTED-SOL", reason: "reject test" }),
  JSON.stringify({ event_id: "pevt_anomaly", ts: "2026-05-30T02:05:00.000Z", type: "paper_anomaly", paper_id: "PAPER_open", strategy_version: "spot_efficiency_v1", pool_name: "SAFE-SOL", reason: "anomaly test" }),
  JSON.stringify({ event_id: "pevt_unknown", ts: "2026-05-30T02:10:00.000Z", type: "unexpected_event", paper_id: "PAPER_open", strategy_version: "spot_efficiency_v1", pool_name: "SAFE-SOL", reason: "unknown test" }),
  "{ malformed jsonl line",
].join("\n"));

const output = runReport(positionsFile, eventsFile);
assert.match(output, /MERIDIAN PAPER \/ DRY-RUN REPORT/);
assert.match(output, /Safety: local files only; no wallet\/RPC\/API\/SDK calls/);
assert.match(output, /Total paper positions: 2/);
assert.match(output, /Open: 1/);
assert.match(output, /Closed: 1/);
assert.match(output, /Deploy events: 1/);
assert.match(output, /Claim events: 1/);
assert.match(output, /Close events: 1/);
assert.match(output, /Anomaly\/reject\/error events: 4/);
assert.match(output, /spot_efficiency_v1: 1/);
assert.match(output, /bidask_dump_reversal_v1: 1/);
assert.match(output, /SAFE-SOL: 1/);
assert.match(output, /CLOSED-SOL: 1/);
assert.match(output, /PAPER_open \| SAFE-SOL \| spot_efficiency_v1 \| 0.5/);
assert.match(output, /PAPER_closed \| CLOSED-SOL \| bidask_dump_reversal_v1 \| close test/);
assert.match(output, /\[REDACTED/);
assert.equal(output.includes("4Nd1mZ"), false);

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
