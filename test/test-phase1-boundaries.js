import assert from "assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-phase1-boundary-"));
const originalCwd = process.cwd();
const originalFetch = globalThis.fetch;
let passed = false;
const repoRuntimeBaseline = new Map(
  ["paper-positions.json", "paper-events.jsonl", "strategy-library.json"].map((filename) => {
    const fullPath = path.join(repoRoot, filename);
    if (!fs.existsSync(fullPath)) return [filename, null];
    const stat = fs.statSync(fullPath);
    return [filename, { size: stat.size, mtimeMs: stat.mtimeMs }];
  }),
);

function moduleUrl(relativePath) {
  return pathToFileURL(path.join(repoRoot, relativePath)).href;
}

function resetRuntimeFiles() {
  process.env.PAPER_POSITIONS_FILE = path.join(tempDir, "paper-positions.json");
  process.env.PAPER_EVENTS_FILE = path.join(tempDir, "paper-events.jsonl");
}

function assertNoWorkspaceRuntimeFiles() {
  for (const filename of ["paper-positions.json", "paper-events.jsonl", "strategy-library.json"]) {
    const fullPath = path.join(repoRoot, filename);
    const before = repoRuntimeBaseline.get(filename);
    const existsNow = fs.existsSync(fullPath);
    assert.equal(existsNow, before !== null, `${filename} repo-root existence changed`);
    if (before) {
      const after = fs.statSync(fullPath);
      assert.equal(after.size, before.size, `${filename} repo-root size changed`);
      assert.equal(after.mtimeMs, before.mtimeMs, `${filename} repo-root mtime changed`);
    }
  }
}

process.chdir(tempDir);
resetRuntimeFiles();
process.env.WALLET_PRIVATE_KEY = bs58.encode(Keypair.generate().secretKey);
process.env.RPC_URL = "https://boundary.invalid/rpc?api-key=boundary-test";
process.env.HELIUS_API_KEY = "boundary-test-helius";
process.env.DRY_RUN = "true";
globalThis.fetch = async (url) => {
  throw new Error(`BOUNDARY_VIOLATION_FETCH:${String(url).replace(/[?&][^=\s]+=[^&\s]+/g, "$1=[REDACTED]")}`);
};

try {
  const { deployPosition, claimFees, closePosition } = await import(moduleUrl("tools/dlmm.js"));
  const { executeTool } = await import(moduleUrl("tools/executor.js"));
  const { createPaperPosition, getPaperPosition } = await import(moduleUrl("paper-trading.js"));
  const { tools } = await import(moduleUrl("tools/definitions.js"));

  const directDeploy = await deployPosition({
    pool_address: "FakePoolForDirectBoundary11111111111111111111",
    amount_y: 0.5,
    strategy: "spot",
    bins_below: 50,
    bins_above: 0,
    bin_step: 100,
    volatility: 1.2,
  });
  assert.equal(directDeploy.dry_run, true);
  assert.match(directDeploy.position, /^PAPER_/);
  assert.equal(directDeploy.paper_position.entry_active_bin, null);
  assert.equal(directDeploy.paper_position.entry_range.lower_bin, null);
  assert.equal(directDeploy.paper_position.entry_range.upper_bin, null);

  const executorDeploy = await executeTool("deploy_position", {
    pool_address: "FakePoolForExecutorBoundary111111111111111111",
    amount_y: 0.5,
    strategy: "spot",
    bins_below: 50,
    bins_above: 0,
    bin_step: 100,
    volatility: 1.2,
  });
  assert.equal(executorDeploy.dry_run, true);
  assert.match(executorDeploy.position, /^PAPER_/);
  assert.equal(executorDeploy.paper_position.entry_active_bin, null);

  const paper = createPaperPosition({
    pool: "PoolBoundary1111111111111111111111111111111",
    pool_name: "BOUNDARY-SOL",
    strategy: "spot",
    amount_y: 0.25,
    bins_below: 50,
    bins_above: 0,
  });

  delete process.env.DRY_RUN;
  const closeWithoutDryRun = await executeTool("close_paper_position", { paper_id: paper.paper_id, reason: "should reject" });
  assert.match(closeWithoutDryRun.error, /only available when DRY_RUN=true/);
  const claimWithoutDryRun = await executeTool("claim_paper_fees", { paper_id: paper.paper_id, note: "should reject" });
  assert.match(claimWithoutDryRun.error, /only available when DRY_RUN=true/);

  process.env.DRY_RUN = "true";
  const closeNonPaper = await executeTool("close_paper_position", { paper_id: "LIVE_POSITION_ADDRESS" });
  assert.equal(closeNonPaper.error, "paper_id must start with PAPER_");
  const claimNonPaper = await executeTool("claim_paper_fees", { paper_id: "LIVE_POSITION_ADDRESS" });
  assert.equal(claimNonPaper.error, "paper_id must start with PAPER_");

  const paperClaim = await executeTool("claim_paper_fees", { paper_id: paper.paper_id, note: "boundary claim" });
  assert.equal(paperClaim.type, "paper_claim");
  const paperClose = await executeTool("close_paper_position", { paper_id: paper.paper_id, reason: "boundary close" });
  assert.equal(paperClose.position.status, "closed");
  assert.equal(getPaperPosition(paper.paper_id).status, "closed");

  const dlmmPaper = createPaperPosition({
    pool: "PoolDlmmBoundary111111111111111111111111111",
    pool_name: "DLMM-BOUNDARY-SOL",
    strategy: "bid_ask",
    amount_y: 0.25,
    bins_below: 50,
    bins_above: 0,
  });
  const dlmmClaim = await claimFees({ position_address: dlmmPaper.paper_id });
  assert.equal(dlmmClaim.dry_run, true);
  assert.equal(dlmmClaim.paper_event.type, "paper_claim");
  const dlmmClose = await closePosition({ position_address: dlmmPaper.paper_id, reason: "boundary dlmm close" });
  assert.equal(dlmmClose.dry_run, true);
  assert.equal(dlmmClose.paper_event.type, "paper_close");

  const toolNames = tools.map((tool) => tool.function.name);
  for (const name of ["list_paper_positions", "get_paper_position", "close_paper_position", "claim_paper_fees"]) {
    assert.ok(toolNames.includes(name), `${name} definition missing`);
  }

  const agentSource = fs.readFileSync(path.join(repoRoot, "agent.js"), "utf8");
  const managerTools = agentSource.match(/const MANAGER_TOOLS\s*=\s*new Set\(\[([^\]]*)\]\)/s)?.[1] || "";
  const screenerTools = agentSource.match(/const SCREENER_TOOLS\s*=\s*new Set\(\[([^\]]*)\]\)/s)?.[1] || "";
  for (const paperTool of ["list_paper_positions", "get_paper_position", "close_paper_position", "claim_paper_fees"]) {
    assert.equal(managerTools.includes(paperTool), false, `${paperTool} must not be exposed to MANAGER`);
    assert.equal(screenerTools.includes(paperTool), false, `${paperTool} must not be exposed to SCREENER`);
  }
  assert.match(agentSource, /close:\s+new Set\(\[[^\]]*"close_paper_position"/s);
  assert.match(agentSource, /claim:\s+new Set\(\[[^\]]*"claim_paper_fees"/s);
  assert.match(agentSource, /positions:\s+new Set\(\[[^\]]*"list_paper_positions"/s);
  assert.match(agentSource, /performance:\s+new Set\(\[[^\]]*"list_paper_positions"/s);

  assertNoWorkspaceRuntimeFiles();
  passed = true;
} finally {
  globalThis.fetch = originalFetch;
  process.chdir(originalCwd);
}

if (passed) {
  console.log("Phase 1 boundary tests passed");
  process.exit(0);
}
