/**
 * Strategy Contract v0.1
 *
 * Machine-readable strategy definitions for future Dry-Run v2 testing.
 * These contracts are declarative by design: they do not deploy, filter,
 * or mutate live trading behavior.
 */

export const CONTRACT_VERSION = "0.1.0";

export const STRATEGY_STATUS = Object.freeze({
  COMMUNITY_HYPOTHESIS: "community_hypothesis",
  PAPER_OBSERVATION: "paper_observation",
  VALIDATED_PAPER_RULE: "validated_paper_rule",
  LIVE_OBSERVATION: "live_observation",
  DEPRECATED_RULE: "deprecated_rule",
});

export const SHARED_POOL_TYPES = Object.freeze([
  "high_efficiency_fee_pool",
  "dump_reversal_candidate",
  "high_vol_fee_farm",
  "organic_quality_pool",
  "thin_tvl_trap",
  "pvp_symbol_risk",
  "killer_pool_memory",
  "stale_or_unknown_data",
]);

export const SHARED_REQUIRED_METRICS = Object.freeze([
  "pool_address",
  "pool_name",
  "strategy_version",
  "bin_step",
  "active_bin",
  "tvl",
  "active_tvl",
  "volume",
  "volume_tvl_ratio",
  "fee_active_tvl_ratio",
  "organic_score",
  "holder_count",
  "bot_holders_pct",
  "top10_pct",
  "volatility",
  "pool_age_hours",
  "recent_price_change",
  "recent_volume_change",
  "pool_memory",
  "source_timestamp",
]);

export const SHARED_SAFETY_RULES = Object.freeze([
  "Reject if private key/secret appears in candidate context.",
  "Reject or quarantine if data is stale.",
  "Treat volatility=0 as unknown/suspicious, not safe.",
  "Reject if pool is marked killer_pool_memory.",
  "Do not promote lessons from suspicious PnL records.",
  "LLM cannot override safety filters.",
]);

const COMMON_EXIT_RULES = Object.freeze([
  "Stop loss if configured threshold is reached.",
  "Close if OOR longer than allowed wait.",
  "Trailing TP only after valid peak and minimum age.",
  "Close or quarantine if PnL source divergence exceeds threshold.",
]);

export const STRATEGY_CONTRACTS = Object.freeze({
  spot_efficiency_v1: Object.freeze({
    id: "spot_efficiency_v1",
    name: "Spot Efficiency",
    version: "v1",
    contract_type: "deploy_strategy",
    purpose: "Farm fees in pools where price is likely to remain inside the chosen bin range with high range efficiency.",
    allowed_pool_types: Object.freeze([
      "high_efficiency_fee_pool",
      "organic_quality_pool",
      "high_vol_fee_farm",
    ]),
    required_input_metrics: Object.freeze([
      "bin_step",
      "active_bin",
      "fee_active_tvl_ratio",
      "volume_tvl_ratio",
      "volatility",
      "organic_score",
      "holder_count",
      "bot_holders_pct",
      "top10_pct",
      "recent_price_change",
      "recent_volume_change",
      "pool_memory.range_efficiency",
      "pool_memory.recent_oor_count",
      "pool_memory.recent_pnl",
    ]),
    entry_hard_filters: Object.freeze([
      "bin_step must be within 80-125 for v1.",
      "organic_score must be >= 60.",
      "holder_count must be >= 500.",
      "bot_holders_pct must be <= 30.",
      "top10_pct must be <= 60.",
      "fee_active_tvl_ratio must be > 0.",
      "No repeated recent OOR/loss cluster.",
      "No stale/unknown data.",
      "volatility must be non-zero and positive.",
    ]),
    entry_soft_signals: Object.freeze([
      "Historical or paper range efficiency >80%.",
      "Fee flow is persistent, not one-cycle spike.",
      "Smart-wallet or narrative support.",
      "Price is not already escaping the intended range.",
      "Volume is stable or increasing.",
      "Similar pools have positive paper expectancy.",
    ]),
    exit_hard_rules: Object.freeze([
      ...COMMON_EXIT_RULES,
      "Close if pumped far above range and no longer earning fees.",
      "Close if fee/TVL collapses after minimum age.",
    ]),
    allowed_llm_discretion: Object.freeze([
      "Decide whether to hold past normal TP if fees remain strong and position is in range.",
      "Choose between claim-only vs close if fees are high.",
      "Penalize weak narrative or suspicious token behavior.",
      "Cannot override stop loss, OOR timeout, stale data, or PnL quarantine.",
    ]),
    required_event_logging_fields: Object.freeze([
      "strategy_version",
      "pool_type",
      "entry_range",
      "bin_step",
      "entry_active_bin",
      "fee_active_tvl_ratio",
      "volume_tvl_ratio",
      "organic_score",
      "pool_memory_summary",
      "entry_reason",
      "soft_signals_used",
      "hard_filters_passed",
      "hard_filters_failed",
      "llm_reasoning_summary",
    ]),
    evaluation_metrics: Object.freeze([
      "net_realistic_pnl",
      "fees_earned",
      "estimated_il",
      "range_efficiency",
      "minutes_in_range",
      "minutes_oor",
      "fee_share_of_pnl",
      "active_bin_drift",
      "exit_reason",
      "pnl_divergence_rate",
    ]),
    default_status: STRATEGY_STATUS.COMMUNITY_HYPOTHESIS,
    notes_open_questions: Object.freeze([
      "Exact fee/active-TVL and volume/TVL thresholds need paper validation.",
      "Test TP variants: 5%, 8%, 10-12%.",
      "Need compare narrow vs wider ranges for high volatility.",
    ]),
  }),

  bidask_dump_reversal_v1: Object.freeze({
    id: "bidask_dump_reversal_v1",
    name: "Bid-Ask Dump Reversal",
    version: "v1",
    contract_type: "deploy_strategy",
    purpose: "Use Bid-Ask single-side SOL as a paid limit-entry during dumps, then withdraw/exit when reversal appears.",
    allowed_pool_types: Object.freeze([
      "dump_reversal_candidate",
      "organic_quality_pool",
      "high_vol_fee_farm",
    ]),
    required_input_metrics: Object.freeze([
      "bin_step",
      "active_bin",
      "recent_price_change",
      "recent_price_velocity",
      "recent_volume_change",
      "fee_active_tvl_ratio",
      "volume_tvl_ratio",
      "volatility",
      "support_or_reversal_signal",
      "organic_score",
      "pool_memory.recent_pnl",
      "pool_memory.oor_count",
    ]),
    entry_hard_filters: Object.freeze([
      "Single-side SOL only.",
      "bins_above must equal 0 for v1.",
      "Pool must not be in killer_pool_memory.",
      "Must not enter after price already extended upward.",
      "Fee flow must still be active.",
      "Data must not be stale.",
      "volatility must be non-zero and positive.",
      "Reject if TVL/liquidity is too thin for simulated close.",
    ]),
    entry_soft_signals: Object.freeze([
      "Price recently dumped into target zone.",
      "Volume remains alive during dump.",
      "Reversal signal appears or is forming.",
      "Smart-wallet/narrative support.",
      "Pool has prior successful Bid-Ask paper results.",
      "Active bin is near desired lower-range entry zone.",
    ]),
    exit_hard_rules: Object.freeze([
      ...COMMON_EXIT_RULES,
      "Close if dump continues through stop threshold.",
      "Close if position stays idle/OOR beyond timeout.",
      "Withdraw after reversal confirmation or TP.",
      "Do not hold if fee flow collapses and price keeps moving away.",
    ]),
    allowed_llm_discretion: Object.freeze([
      "Judge whether reversal signal is strong enough to keep holding.",
      "Decide claim-only vs close if fees are strong.",
      "Decide whether setup is too late because price already rebounded.",
      "Cannot override stop loss, OOR timeout, or suspicious PnL quarantine.",
    ]),
    required_event_logging_fields: Object.freeze([
      "strategy_version",
      "pool_type",
      "entry_active_bin",
      "lower_bin",
      "upper_bin",
      "dump_context",
      "reversal_signal_summary",
      "fee_active_tvl_ratio",
      "volume_tvl_ratio",
      "entry_reason",
      "why_not_chasing",
      "hard_filters_passed",
      "hard_filters_failed",
      "llm_reasoning_summary",
    ]),
    evaluation_metrics: Object.freeze([
      "entry_fill_quality",
      "fees_earned_while_waiting",
      "reversal_capture",
      "max_adverse_excursion",
      "idle_oor_time",
      "net_realistic_pnl",
      "slippage_penalty",
      "close_quality",
      "false_reversal_rate",
    ]),
    default_status: STRATEGY_STATUS.COMMUNITY_HYPOTHESIS,
    notes_open_questions: Object.freeze([
      "Need define exact reversal signal inputs.",
      "Need compare entry before reversal vs after confirmation.",
      "Need simulate limit-sell exit separately later.",
    ]),
  }),

  strict_fee_tvl_v1: Object.freeze({
    id: "strict_fee_tvl_v1",
    name: "Strict Fee/TVL",
    version: "v1",
    contract_type: "screening_overlay",
    purpose: "Test whether stricter fee intensity and volume/TVL gates improve expectancy and reduce low-yield traps.",
    allowed_pool_types: Object.freeze([
      "high_efficiency_fee_pool",
      "high_vol_fee_farm",
      "organic_quality_pool",
    ]),
    required_input_metrics: Object.freeze([
      "fee_active_tvl_ratio",
      "volume_tvl_ratio",
      "volume",
      "active_tvl",
      "tvl",
      "recent_fee_change",
      "recent_volume_change",
      "bin_step",
      "volatility",
      "organic_score",
      "pool_memory.fee_capture",
      "pool_memory.recent_pnl",
    ]),
    entry_hard_filters: Object.freeze([
      "fee_active_tvl_ratio must exceed strict strategy threshold.",
      "volume_tvl_ratio must exceed strict strategy threshold.",
      "Recent volume must not be collapsing sharply.",
      "minTokenFeesSol or equivalent global fee quality must pass.",
      "Reject fee/TVL = 0.",
      "Reject stale data.",
      "Reject volatility=0.",
      "Reject killer pool memory.",
    ]),
    entry_soft_signals: Object.freeze([
      "Fee/TVL is sustained across multiple snapshots.",
      "Volume is broad and organic, not one spike.",
      "Pool has good prior fee capture.",
      "Organic score and holder quality are strong.",
      "Similar fee/TVL pools have positive paper expectancy.",
    ]),
    exit_hard_rules: Object.freeze([
      ...COMMON_EXIT_RULES,
      "Close if fee/TVL collapses after minimum age.",
      "Close if volume collapses and PnL is not protected.",
      "Apply TP, stop loss, OOR, and trailing TP rules.",
    ]),
    allowed_llm_discretion: Object.freeze([
      "Choose Spot vs Bid-Ask candidate variant if both pass.",
      "Hold high-fee in-range position beyond TP if drawdown risk is acceptable.",
      "Cannot override fee collapse, stale data, or safety blocks.",
    ]),
    required_event_logging_fields: Object.freeze([
      "strategy_version",
      "pool_type",
      "fee_active_tvl_ratio",
      "volume_tvl_ratio",
      "recent_fee_change",
      "recent_volume_change",
      "fee_persistence_summary",
      "entry_reason",
      "hard_filters_passed",
      "hard_filters_failed",
      "llm_reasoning_summary",
    ]),
    evaluation_metrics: Object.freeze([
      "avoided_low_yield_losers",
      "missed_winners_due_to_strict_filters",
      "fee_persistence",
      "net_realistic_pnl",
      "fee_share_of_pnl",
      "win_rate",
      "expectancy",
      "drawdown",
    ]),
    default_status: STRATEGY_STATUS.COMMUNITY_HYPOTHESIS,
    notes_open_questions: Object.freeze([
      "Exact strict thresholds should be tested, not hard-assumed.",
      "Need compare against looser baseline screener.",
    ]),
  }),

  anti_killer_pool_guard_v1: Object.freeze({
    id: "anti_killer_pool_guard_v1",
    name: "Anti Killer Pool Guard",
    version: "v1",
    contract_type: "overlay_guard",
    purpose: "Prevent repeated redeploy into pools/tokens that show recurring bad behavior.",
    allowed_pool_types: Object.freeze([
      "killer_pool_memory",
      "stale_or_unknown_data",
      "thin_tvl_trap",
      "pvp_symbol_risk",
    ]),
    blocks_pool_types: Object.freeze([
      "killer_pool_memory",
      "stale_or_unknown_data",
      "repeated_thin_tvl_trap",
      "repeated_pvp_symbol_risk_if_losses_observed",
    ]),
    required_input_metrics: Object.freeze([
      "pool_memory.recent_deploy_count",
      "pool_memory.recent_pnl",
      "pool_memory.recent_oor_count",
      "pool_memory.range_efficiency",
      "pool_memory.instant_close_count",
      "pool_memory.pnl_divergence_count",
      "pool_memory.close_reasons",
      "pool_memory.last_loss_ts",
      "pool_memory.cooldown_until",
      "base_mint_memory",
    ]),
    entry_hard_filters: Object.freeze([
      "Block if pool is on cooldown.",
      "Block if repeated OOR count exceeds threshold.",
      "Block if repeated losses exceed threshold.",
      "Block if range efficiency is consistently poor.",
      "Block if repeated PnL divergence exists.",
      "Block if prior closes were instant/bug-like until reviewed.",
      "Block if token/base mint has active safety blacklist.",
    ]),
    entry_soft_signals: Object.freeze([
      "Prior bad pattern may be ignored only after cooldown expires and market regime changes.",
      "HiveMind/community positive signal can request paper-only retest, not live deploy.",
      "Strong new fee/volume regime can downgrade block to paper-only.",
    ]),
    exit_hard_rules: Object.freeze([
      "If an open position enters known killer pattern, close or require human review.",
      "If same failure repeats in paper mode, strengthen cooldown.",
      "If PnL source is suspicious, stop lesson generation.",
    ]),
    allowed_llm_discretion: Object.freeze([
      "Explain whether bad history is still relevant.",
      "Recommend paper-only retest after cooldown.",
      "Cannot override active safety cooldown for live deploy.",
    ]),
    required_event_logging_fields: Object.freeze([
      "strategy_version",
      "guard_triggered",
      "pool_memory_summary",
      "base_mint_memory_summary",
      "block_reason",
      "cooldown_until",
      "evidence_count",
      "llm_reasoning_summary",
      "human_review_needed",
    ]),
    evaluation_metrics: Object.freeze([
      "avoided_losses",
      "missed_winners",
      "false_positive_block_rate",
      "repeated_loss_reduction",
      "cooldown_effectiveness",
      "paper_retest_recovery_rate",
    ]),
    default_status: STRATEGY_STATUS.COMMUNITY_HYPOTHESIS,
    notes_open_questions: Object.freeze([
      "Need define thresholds for OOR count, loss count, and cooldown duration.",
      "BABYTROLL and Coinini are good historical cases for testing this guard.",
    ]),
  }),
});

const REQUIRED_CONTRACT_KEYS = Object.freeze([
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
]);

export function listStrategyContracts() {
  return Object.values(STRATEGY_CONTRACTS).map((contract) => ({
    id: contract.id,
    name: contract.name,
    version: contract.version,
    contract_type: contract.contract_type,
    purpose: contract.purpose,
    default_status: contract.default_status,
  }));
}

export function getStrategyContract(id) {
  if (!id) return null;
  return STRATEGY_CONTRACTS[id] || null;
}

export function validateStrategyContract(contract) {
  const errors = [];
  if (!contract || typeof contract !== "object") return ["Contract must be an object."];

  for (const key of REQUIRED_CONTRACT_KEYS) {
    if (contract[key] == null) errors.push(`Missing required key: ${key}`);
  }

  if (contract.id && !STRATEGY_CONTRACTS[contract.id]) {
    errors.push(`Unknown strategy id: ${contract.id}`);
  }

  for (const poolType of contract.allowed_pool_types || []) {
    if (!SHARED_POOL_TYPES.includes(poolType)) {
      errors.push(`Unknown pool type: ${poolType}`);
    }
  }

  if (contract.default_status && !Object.values(STRATEGY_STATUS).includes(contract.default_status)) {
    errors.push(`Unknown default status: ${contract.default_status}`);
  }

  return errors;
}
