import assert from "assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-paper-test-"));
process.env.PAPER_POSITIONS_FILE = path.join(tempDir, "paper-positions.json");
process.env.PAPER_EVENTS_FILE = path.join(tempDir, "paper-events.jsonl");

const {
  appendPaperEvent,
  claimPaperFees,
  closePaperPosition,
  createPaperPosition,
  getPaperPosition,
  listPaperPositions,
  sanitizePaperPayload,
} = await import("../paper-trading.js");
const { claimFees, closePosition } = await import("../tools/dlmm.js");
const { executeTool } = await import("../tools/executor.js");
const { tools } = await import("../tools/definitions.js");

const secret = "WALLET_PRIVATE_KEY=4Nd1mZFbDq5uE6JkTgq4HdoJ9QdBbrF7yEgJ4ucbBnEXAMPLEPRIVATEKEYVALUE123456789";
const jsonSecret = "[12,34,56,78,90,12,34,56,78,90,12,34,56,78,90,12,34,56,78,90,12,34,56,78,90,12,34,56,78,90,12,34,56,78,90,12,34,56,78,90,12,34,56,78,90,12,34,56,78,90,12,34,56,78,90,12,34,56,78,90,12,34,56,78,90,12,34,56,78,90]";

const sanitized = sanitizePaperPayload({
  reason: `testing ${secret}`,
  metrics: {
    api: "OPENAI_API_KEY=sk-test1234567890abcdefghijklmnopqrst",
    keypair: jsonSecret,
    walletKey: "plain-secret-value-that-should-never-survive",
    bearer: "Bearer abcdefghijklmnopqrstuvwxyz1234567890",
    rpc: "https://example.rpc/?api-key=abcdef1234567890",
  },
});

assert.equal(sanitized.reason.includes("4Nd1mZ"), false);
assert.equal(JSON.stringify(sanitized).includes("sk-test"), false);
assert.equal(JSON.stringify(sanitized).includes("12,34,56"), false);
assert.equal(JSON.stringify(sanitized).includes("abcdef1234567890"), false);
assert.equal(JSON.stringify(sanitized).includes("plain-secret-value"), false);
assert.equal(JSON.stringify(sanitized).includes("abcdefghijklmnopqrstuvwxyz"), false);

const created = createPaperPosition({
  pool: "Pool111111111111111111111111111111111111111",
  pool_name: "TEST-SOL",
  base_mint: "Base111111111111111111111111111111111111111",
  strategy_version: "spot_efficiency_v1",
  shape: "spot",
  amount_sol: 0.5,
  bin_step: 100,
  entry_active_bin: -123,
  bins_below: 50,
  bins_above: 0,
  entry_range: { lower_bin: -173, upper_bin: -123 },
  source_metrics: {
    fee_active_tvl_ratio: 0.2,
    volume_tvl_ratio: 5,
    organic_score: 72,
    volatility: 2.4,
  },
  entry_reason: `safe paper entry ${secret}`,
  risk_flags: [`contains secret ${jsonSecret}`],
  hard_filters_passed: ["bin_step ok"],
});

assert.match(created.paper_id, /^PAPER_/);
assert.equal(created.status, "open");
assert.equal(created.strategy_contract_status, "community_hypothesis");
assert.equal(created.strategy_contract_fields.required_event_logging_fields.includes("strategy_version"), true);
assert.equal(created.entry_reason.includes("4Nd1mZ"), false);
assert.equal(created.risk_flags[0].includes("12,34"), false);

const loaded = getPaperPosition(created.paper_id);
assert.equal(loaded.paper_id, created.paper_id);
assert.equal(listPaperPositions({ status: "open" }).positions.length, 1);

const customEvent = appendPaperEvent({
  type: "paper_hold_note",
  paper_id: created.paper_id,
  strategy_version: "spot_efficiency_v1",
  pool: created.pool,
  pool_name: created.pool_name,
  reason: secret,
  metrics_snapshot: { nested: jsonSecret },
});
assert.match(customEvent.event_id, /^pevt_/);

const claim = claimPaperFees(created.paper_id, `claim note ${secret}`);
assert.equal(claim.paper_id, created.paper_id);
assert.equal(claim.type, "paper_claim");

const closed = closePaperPosition(created.paper_id, `closing ${secret}`);
assert.equal(closed.position.status, "closed");
assert.ok(closed.position.closed_at);
assert.equal(closed.event.type, "paper_close");
const secondClose = closePaperPosition(created.paper_id, "duplicate close should not mutate");
assert.equal(secondClose.error, `Paper position ${created.paper_id} is already closed`);

assert.equal(listPaperPositions({ status: "open" }).positions.length, 0);
assert.equal(listPaperPositions({ status: "closed" }).positions.length, 1);
assert.equal(getPaperPosition("LIVE_NOT_PAPER"), null);

const files = [
  fs.readFileSync(process.env.PAPER_POSITIONS_FILE, "utf8"),
  fs.readFileSync(process.env.PAPER_EVENTS_FILE, "utf8"),
].join("\n");
assert.equal(files.includes("4Nd1mZ"), false);
assert.equal(files.includes("sk-test"), false);
assert.equal(files.includes("12,34,56"), false);

const integration = createPaperPosition({
  pool: "Pool222222222222222222222222222222222222222",
  pool_name: "INTEGRATION-SOL",
  strategy: "bid_ask",
  amount_y: 0.25,
  bins_below: 50,
  bins_above: 0,
});
process.env.DRY_RUN = "true";
const dlmmClaim = await claimFees({ position_address: integration.paper_id });
assert.equal(dlmmClaim.dry_run, true);
assert.equal(dlmmClaim.paper_event.type, "paper_claim");

const dlmmClose = await closePosition({ position_address: integration.paper_id, reason: `close with ${secret}` });
assert.equal(dlmmClose.dry_run, true);
assert.equal(dlmmClose.paper_event.type, "paper_close");
assert.equal(getPaperPosition(integration.paper_id).status, "closed");

const nonPaperClaim = await claimFees({ position_address: "LIVE_POSITION_ADDRESS" });
assert.equal(nonPaperClaim.would_claim, "LIVE_POSITION_ADDRESS");

const { deployPosition } = await import("../tools/dlmm.js");
const paperDeploy = await deployPosition({
  pool_address: "FakePoolForPaperOnly1111111111111111111111111",
  amount_y: 0.5,
  strategy: "spot",
  bins_below: 50,
  bins_above: 0,
  bin_step: 100,
  volatility: 1.2,
  fee_tvl_ratio: 0.3,
  organic_score: 70,
});
assert.equal(paperDeploy.dry_run, true);
assert.match(paperDeploy.position, /^PAPER_/);
assert.equal(paperDeploy.paper_position.entry_active_bin, null);
assert.equal(paperDeploy.paper_position.entry_range.lower_bin, null);

const executorDeploy = await executeTool("deploy_position", {
  pool_address: "FakePoolForExecutorPaperOnly11111111111111111111",
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

const toolNames = tools.map((tool) => tool.function.name);
for (const name of ["list_paper_positions", "get_paper_position", "close_paper_position", "claim_paper_fees"]) {
  assert.ok(toolNames.includes(name), `${name} tool definition missing`);
}

console.log("Paper trading tests passed");
process.exit(0);
