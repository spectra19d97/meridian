import assert from "assert/strict";

import {
  getStrategyContract,
  listStrategyContracts,
  SHARED_POOL_TYPES,
  SHARED_REQUIRED_METRICS,
  SHARED_SAFETY_RULES,
  STRATEGY_CONTRACTS,
  validateStrategyContract,
} from "../strategy-contract.js";
import { tools } from "../tools/definitions.js";

const REQUIRED_CONTRACT_KEYS = [
  "id",
  "name",
  "version",
  "purpose",
  "allowed_pool_types",
  "required_input_metrics",
  "entry_hard_filters",
  "entry_soft_signals",
  "exit_hard_rules",
  "allowed_llm_discretion",
  "required_event_logging_fields",
  "evaluation_metrics",
  "default_status",
  "notes_open_questions",
];

const expectedStrategies = [
  "spot_efficiency_v1",
  "bidask_dump_reversal_v1",
  "strict_fee_tvl_v1",
  "anti_killer_pool_guard_v1",
];

assert.deepEqual(
  Object.keys(STRATEGY_CONTRACTS).sort(),
  expectedStrategies.sort(),
  "Strategy Contract v0.1 should include the four required strategy contracts",
);

assert.ok(SHARED_POOL_TYPES.includes("high_efficiency_fee_pool"));
assert.ok(SHARED_POOL_TYPES.includes("killer_pool_memory"));
assert.ok(SHARED_REQUIRED_METRICS.includes("source_timestamp"));
assert.ok(
  SHARED_SAFETY_RULES.some((rule) => rule.includes("volatility=0")),
  "Shared safety rules should explicitly treat volatility=0 as suspicious",
);

for (const id of expectedStrategies) {
  const contract = getStrategyContract(id);
  for (const key of REQUIRED_CONTRACT_KEYS) {
    assert.ok(contract[key] != null, `${id} is missing required key ${key}`);
  }
  assert.equal(contract.id, id);
  assert.equal(contract.default_status, "community_hypothesis");
  assert.deepEqual(validateStrategyContract(contract), []);
}

const spot = getStrategyContract("spot_efficiency_v1");
assert.ok(spot.entry_hard_filters.includes("bin_step must be within 80-125 for v1."));
assert.ok(spot.required_event_logging_fields.includes("pool_memory_summary"));

const bidAsk = getStrategyContract("bidask_dump_reversal_v1");
assert.ok(bidAsk.entry_hard_filters.includes("Single-side SOL only."));
assert.ok(bidAsk.required_event_logging_fields.includes("why_not_chasing"));

const strictFee = getStrategyContract("strict_fee_tvl_v1");
assert.ok(strictFee.evaluation_metrics.includes("missed_winners_due_to_strict_filters"));

const guard = getStrategyContract("anti_killer_pool_guard_v1");
assert.equal(guard.contract_type, "overlay_guard");
assert.ok(guard.entry_hard_filters.includes("Block if pool is on cooldown."));

assert.equal(getStrategyContract("missing_strategy"), null);
assert.equal(listStrategyContracts().length, expectedStrategies.length);

const toolNames = tools.map((tool) => tool.function.name);
assert.ok(toolNames.includes("list_strategy_contracts"));
assert.ok(toolNames.includes("get_strategy_contract"));

console.log("Strategy contract tests passed");
