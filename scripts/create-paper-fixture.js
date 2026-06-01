import fs from "fs";
import os from "os";
import path from "path";
import process from "process";

const FIXTURE_DIR = path.join(os.tmpdir(), "meridian-paper-fixture");
const DEFAULT_POSITIONS_FILE = path.join(FIXTURE_DIR, "paper-positions.json");
const DEFAULT_EVENTS_FILE = path.join(FIXTURE_DIR, "paper-events.jsonl");

function outputPaths() {
  const hasPositions = !!process.env.PAPER_POSITIONS_FILE;
  const hasEvents = !!process.env.PAPER_EVENTS_FILE;

  if (hasPositions !== hasEvents) {
    throw new Error("Set both PAPER_POSITIONS_FILE and PAPER_EVENTS_FILE, or set neither.");
  }

  return {
    positionsFile: hasPositions ? process.env.PAPER_POSITIONS_FILE : DEFAULT_POSITIONS_FILE,
    eventsFile: hasEvents ? process.env.PAPER_EVENTS_FILE : DEFAULT_EVENTS_FILE,
  };
}

function syntheticPosition({
  id,
  status = "open",
  poolName,
  pool,
  baseMint,
  createdAt,
  updatedAt = createdAt,
  closedAt = null,
  lastEventId,
}) {
  return {
    paper_id: id,
    status,
    created_at: createdAt,
    updated_at: updatedAt,
    closed_at: closedAt,
    pool,
    pool_name: poolName,
    base_mint: baseMint,
    strategy_version: "spot_efficiency_v1",
    strategy_contract_status: "community_hypothesis",
    shape: "spot",
    amount_sol: 0.1,
    bin_step: null,
    entry_active_bin: null,
    bins_below: null,
    bins_above: null,
    entry_range: {
      lower_bin: null,
      upper_bin: null,
      downside_pct: null,
      upside_pct: null,
    },
    source_metrics: {
      fee_active_tvl_ratio: null,
      volume_tvl_ratio: null,
      organic_score: null,
      volatility: null,
    },
    entry_reason: "synthetic fixture paper position",
    risk_flags: ["synthetic_fixture"],
    last_event_id: lastEventId,
  };
}

function event({ id, ts, type, paperId, poolName, summary, reason, snapshot, warning }) {
  return {
    event_id: id,
    ts,
    type,
    paper_id: paperId,
    strategy_version: "spot_efficiency_v1",
    pool: `SyntheticPoolFor${paperId}`,
    pool_name: poolName,
    summary,
    reason,
    hard_filters_passed: [],
    hard_filters_failed: [],
    soft_signals_used: [],
    metrics_snapshot: {},
    strategy_contract_fields: {},
    simulator_snapshot: snapshot || null,
    simulator_warning: warning || null,
    validation: {
      valid: true,
      errors: [],
      warnings: snapshot?.confidence_level === "low" ? ["synthetic fixture low confidence"] : [],
    },
    human_review_needed: snapshot?.confidence_level === "low" || snapshot?.confidence_level === "unknown" || !!warning,
  };
}

function completeSnapshot({ sourceTimestamp, confidence = "high", source = "test_fixture" }) {
  return {
    simulator_version: "2.1.0",
    data_source_label: source,
    confidence_level: confidence,
    source_timestamp: sourceTimestamp,
    active_bin: 120,
    lower_bin: 100,
    upper_bin: 140,
    bin_step: 100,
    price_estimate: {
      token_x_per_token_y: 1.25,
      token_y_per_token_x: null,
      source: "synthetic_fixture",
      confidence_level: confidence,
    },
    inventory_estimate: {
      quote_asset: "QUOTE",
      token_x_amount: 5,
      token_y_amount: null,
      starting_quote_value: 1,
      current_quote_value_naive: null,
    },
    fee_estimate: {
      claimed_fees_quote_value: null,
      unclaimed_fees_quote_value: null,
      source: "synthetic_fixture",
    },
    risk_adjustments: {
      estimated_il_quote_value: null,
      estimated_slippage_quote_value: null,
      latency_penalty_quote_value: null,
      stale_data_penalty_quote_value: null,
    },
    range_state: {
      in_range: true,
      out_of_range: false,
      active_bin_distance_from_range: 0,
      minutes_in_range: 30,
      minutes_out_of_range: null,
    },
    pnl_layers: {
      naive_paper_pnl_quote_value: 424242,
      conservative_adjusted_pnl_quote_value: null,
      uncertainty_score: null,
      calculation_status: "not_calculated",
    },
    divergence_flags: [],
  };
}

function partialSnapshot() {
  return {
    simulator_version: "2.1.0",
    data_source_label: "test_fixture",
    confidence_level: "medium",
    source_timestamp: "2026-01-01T00:10:00.000Z",
    active_bin: null,
    lower_bin: null,
    upper_bin: null,
    bin_step: null,
    price_estimate: {},
    inventory_estimate: {
      quote_asset: "QUOTE",
    },
    fee_estimate: {},
    risk_adjustments: {},
    range_state: {},
    divergence_flags: [],
  };
}

function buildFixture() {
  const positions = {
    PAPER_fixture_complete: syntheticPosition({
      id: "PAPER_fixture_complete",
      poolName: "SYNTH-COMPLETE-QUOTE",
      pool: "SyntheticPoolComplete111111111111111111111111",
      baseMint: "SyntheticBaseMintComplete11111111111111111111",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastEventId: "pevt_fixture_complete_snapshot",
    }),
    PAPER_fixture_partial: syntheticPosition({
      id: "PAPER_fixture_partial",
      poolName: "SYNTH-PARTIAL-QUOTE",
      pool: "SyntheticPoolPartial111111111111111111111111",
      baseMint: "SyntheticBaseMintPartial11111111111111111111",
      createdAt: "2026-01-01T00:05:00.000Z",
      lastEventId: "pevt_fixture_partial_snapshot",
    }),
    PAPER_fixture_lowconf: syntheticPosition({
      id: "PAPER_fixture_lowconf",
      poolName: "SYNTH-LOWCONF-QUOTE",
      pool: "SyntheticPoolLowconf111111111111111111111111",
      baseMint: "SyntheticBaseMintLowconf11111111111111111111",
      createdAt: "2026-01-01T00:10:00.000Z",
      lastEventId: "pevt_fixture_lowconf_snapshot",
    }),
    PAPER_fixture_unknown: syntheticPosition({
      id: "PAPER_fixture_unknown",
      poolName: "SYNTH-UNKNOWN-QUOTE",
      pool: "SyntheticPoolUnknown111111111111111111111111",
      baseMint: "SyntheticBaseMintUnknown11111111111111111111",
      createdAt: "2026-01-01T00:15:00.000Z",
      lastEventId: "pevt_fixture_unknown_snapshot",
    }),
    PAPER_fixture_stale: syntheticPosition({
      id: "PAPER_fixture_stale",
      poolName: "SYNTH-STALE-QUOTE",
      pool: "SyntheticPoolStale111111111111111111111111",
      baseMint: "SyntheticBaseMintStale11111111111111111111",
      createdAt: "2026-01-01T00:20:00.000Z",
      lastEventId: "pevt_fixture_stale_snapshot",
    }),
    PAPER_fixture_warning: syntheticPosition({
      id: "PAPER_fixture_warning",
      poolName: "SYNTH-WARNING-QUOTE",
      pool: "SyntheticPoolWarning111111111111111111111111",
      baseMint: "SyntheticBaseMintWarning11111111111111111111",
      createdAt: "2026-01-01T00:25:00.000Z",
      lastEventId: "pevt_fixture_warning",
    }),
    PAPER_fixture_closed: syntheticPosition({
      id: "PAPER_fixture_closed",
      status: "closed",
      poolName: "SYNTH-CLOSED-QUOTE",
      pool: "SyntheticPoolClosed111111111111111111111111",
      baseMint: "SyntheticBaseMintClosed11111111111111111111",
      createdAt: "2026-01-01T00:30:00.000Z",
      updatedAt: "2026-01-01T00:40:00.000Z",
      closedAt: "2026-01-01T00:40:00.000Z",
      lastEventId: "pevt_fixture_closed",
    }),
  };

  const events = [
    event({
      id: "pevt_fixture_complete_snapshot",
      ts: "2026-01-01T00:30:00.000Z",
      type: "paper_snapshot",
      paperId: "PAPER_fixture_complete",
      poolName: "SYNTH-COMPLETE-QUOTE",
      summary: "synthetic fixture paper snapshot recorded from provided input",
      reason: "synthetic fixture data complete snapshot",
      snapshot: completeSnapshot({ sourceTimestamp: "2026-01-01T00:29:00.000Z" }),
    }),
    event({
      id: "pevt_fixture_complete_valuation",
      ts: "2026-01-01T00:31:00.000Z",
      type: "paper_valuation",
      paperId: "PAPER_fixture_complete",
      poolName: "SYNTH-COMPLETE-QUOTE",
      summary: "Paper valuation snapshot recorded from synthetic provided input",
      reason: "synthetic fixture provided valuation record",
      snapshot: completeSnapshot({ sourceTimestamp: "2026-01-01T00:30:00.000Z" }),
    }),
    event({
      id: "pevt_fixture_partial_snapshot",
      ts: "2026-01-01T00:32:00.000Z",
      type: "paper_snapshot",
      paperId: "PAPER_fixture_partial",
      poolName: "SYNTH-PARTIAL-QUOTE",
      summary: "synthetic fixture paper snapshot recorded from provided input",
      reason: "synthetic fixture partial data snapshot",
      snapshot: partialSnapshot(),
    }),
    event({
      id: "pevt_fixture_lowconf_snapshot",
      ts: "2026-01-01T00:33:00.000Z",
      type: "paper_snapshot",
      paperId: "PAPER_fixture_lowconf",
      poolName: "SYNTH-LOWCONF-QUOTE",
      summary: "synthetic fixture paper snapshot recorded from provided input",
      reason: "synthetic fixture low confidence snapshot",
      snapshot: completeSnapshot({ sourceTimestamp: "2026-01-01T00:32:00.000Z", confidence: "low" }),
    }),
    event({
      id: "pevt_fixture_unknown_snapshot",
      ts: "2026-01-01T00:34:00.000Z",
      type: "paper_snapshot",
      paperId: "PAPER_fixture_unknown",
      poolName: "SYNTH-UNKNOWN-QUOTE",
      summary: "synthetic fixture paper snapshot recorded from provided input",
      reason: "synthetic fixture unknown source snapshot",
      snapshot: completeSnapshot({ sourceTimestamp: "2026-01-01T00:33:00.000Z", confidence: "unknown", source: "unknown" }),
    }),
    event({
      id: "pevt_fixture_stale_snapshot",
      ts: "2026-01-01T02:00:00.000Z",
      type: "paper_snapshot",
      paperId: "PAPER_fixture_stale",
      poolName: "SYNTH-STALE-QUOTE",
      summary: "synthetic fixture paper snapshot recorded from provided input",
      reason: "synthetic fixture stale source timestamp snapshot",
      snapshot: completeSnapshot({ sourceTimestamp: "2026-01-01T00:30:00.000Z" }),
    }),
    event({
      id: "pevt_fixture_warning",
      ts: "2026-01-01T00:35:00.000Z",
      type: "paper_simulator_warning",
      paperId: "PAPER_fixture_warning",
      poolName: "SYNTH-WARNING-QUOTE",
      summary: "synthetic fixture paper simulator warning recorded",
      reason: "synthetic fixture warning Bearer SYNTHETIC_FIXTURE_SECRET_VALUE",
      warning: {
        severity: "medium",
        code: "synthetic_fixture_warning",
        details: {
          note: "synthetic fixture warning Bearer SYNTHETIC_FIXTURE_SECRET_VALUE",
        },
      },
    }),
    event({
      id: "pevt_fixture_closed",
      ts: "2026-01-01T00:40:00.000Z",
      type: "paper_close",
      paperId: "PAPER_fixture_closed",
      poolName: "SYNTH-CLOSED-QUOTE",
      summary: "synthetic fixture paper position closed",
      reason: "synthetic fixture closed paper position",
    }),
  ];

  return { positions, events };
}

function writeFixture() {
  const { positionsFile, eventsFile } = outputPaths();
  const fixture = buildFixture();

  fs.mkdirSync(path.dirname(positionsFile), { recursive: true });
  fs.mkdirSync(path.dirname(eventsFile), { recursive: true });
  fs.writeFileSync(positionsFile, `${JSON.stringify({ positions: fixture.positions }, null, 2)}\n`);
  fs.writeFileSync(eventsFile, `${fixture.events.map((item) => JSON.stringify(item)).join("\n")}\n`);

  return { positionsFile, eventsFile, positionCount: Object.keys(fixture.positions).length, eventCount: fixture.events.length };
}

try {
  const result = writeFixture();
  process.stdout.write([
    "MERIDIAN SYNTHETIC PAPER FIXTURE",
    "Safety: synthetic local files only; no wallet/RPC/API/SDK calls",
    "",
    `Positions: ${result.positionsFile}`,
    `Events: ${result.eventsFile}`,
    `Paper positions: ${result.positionCount}`,
    `Paper events: ${result.eventCount}`,
    "",
    "Run report with:",
    `$env:PAPER_POSITIONS_FILE="${result.positionsFile}"`,
    `$env:PAPER_EVENTS_FILE="${result.eventsFile}"`,
    "npm run paper:report",
    "",
  ].join("\n"));
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
