/**
 * Phase 2.1 simulator snapshot schema helpers.
 *
 * Schema-only by design: no filesystem access, no live imports, no valuation
 * math, and no integration with deploy/claim/close paths.
 */

export const SIMULATOR_SCHEMA_VERSION = "2.1.0";

const SIMULATOR_EVENT_TYPES = Object.freeze([
  "paper_snapshot",
  "paper_valuation",
  "paper_simulator_warning",
]);

const CONFIDENCE_LEVELS = Object.freeze(["unknown", "low", "medium", "high"]);
const DATA_SOURCE_LABELS = Object.freeze([
  "unknown",
  "paper_input",
  "recorded_snapshot",
  "manual_import",
  "test_fixture",
]);
const SENSITIVE_FIELD_PATTERN = /(private|secret|seed|mnemonic|wallet.*key|api.*key|apikey|token|bearer|authorization|auth|password|rpc)/i;
const SECRET_ENV_NAMES = Object.freeze([
  [["WALLET", "PRIVATE", "KEY"].join("_")],
  [["PRIVATE", "KEY"].join("_")],
  [["SECRET", "KEY"].join("_")],
  [["API", "KEY"].join("_")],
  [[["OPEN", "AI"].join(""), "API", "KEY"].join("_")],
  [["LLM", "API", "KEY"].join("_")],
  [["HIVEMIND", "API", "KEY"].join("_")],
  [["PUBLIC", "API", "KEY"].join("_")],
].map(([name]) => name));
const SECRET_ENV_VALUE_RE = "[^\\s\"',}]+";
const SECRET_ENV_RE = new RegExp(`\\b(${SECRET_ENV_NAMES.join("|")})=(${SECRET_ENV_VALUE_RE})`, "gi");

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function redactedString(value) {
  return String(value)
    .replace(SECRET_ENV_RE, "$1=[REDACTED]")
    .replace(/\[[\s\d,]{120,}\]/g, "[REDACTED_SECRET_ARRAY]")
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[REDACTED_TOKEN]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/gi, "Bearer [REDACTED]")
    .replace(/([?&](?:api[-_]?key|apikey|token|key)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/\b[1-9A-HJ-NP-Za-km-z]{64,}\b/g, "[REDACTED_BASE58_SECRET]");
}

export function sanitizeSimulatorSnapshot(value, keyName = "") {
  if (value == null) return value;
  if (keyName && SENSITIVE_FIELD_PATTERN.test(keyName)) {
    if (typeof value === "object") return "[REDACTED_SECRET]";
    if (value !== "") return "[REDACTED_SECRET]";
  }
  if (typeof value === "string") return redactedString(value).replace(/\s+/g, " ").trim();
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((entry) => sanitizeSimulatorSnapshot(entry, keyName));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitizeSimulatorSnapshot(entry, key)]),
    );
  }
  return null;
}

function finiteOrNull(value) {
  if (value === "" || value == null || typeof value === "boolean") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stringOrUnknown(value) {
  if (typeof value !== "string") return "unknown";
  const trimmed = value.trim();
  return trimmed ? trimmed : "unknown";
}

function stringOrNull(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function confidenceOrUnknown(value) {
  const normalized = stringOrUnknown(value).toLowerCase();
  return CONFIDENCE_LEVELS.includes(normalized) ? normalized : "unknown";
}

function dataSourceLabelOrUnknown(value) {
  const normalized = stringOrUnknown(value).toLowerCase();
  return DATA_SOURCE_LABELS.includes(normalized) ? normalized : "unknown";
}

function booleanOrNull(value) {
  return typeof value === "boolean" ? value : null;
}

function objectOrEmpty(value) {
  return isPlainObject(value) ? value : {};
}

function listOfStrings(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => sanitizeSimulatorSnapshot(entry))
    .filter((entry) => entry != null && entry !== "")
    .map((entry) => String(entry));
}

function unknownSnapshot() {
  return {
    simulator_version: SIMULATOR_SCHEMA_VERSION,
    data_source_label: "unknown",
    confidence_level: "unknown",
    source_timestamp: null,
    active_bin: null,
    lower_bin: null,
    upper_bin: null,
    bin_step: null,
    price_estimate: {
      token_x_per_token_y: null,
      token_y_per_token_x: null,
      source: "unknown",
      confidence_level: "unknown",
    },
    inventory_estimate: {
      quote_asset: "unknown",
      token_x_amount: null,
      token_y_amount: null,
      starting_quote_value: null,
      current_quote_value_naive: null,
    },
    fee_estimate: {
      claimed_fees_quote_value: null,
      unclaimed_fees_quote_value: null,
      source: "unknown",
    },
    risk_adjustments: {
      estimated_il_quote_value: null,
      estimated_slippage_quote_value: null,
      latency_penalty_quote_value: null,
      stale_data_penalty_quote_value: null,
    },
    range_state: {
      in_range: null,
      out_of_range: null,
      active_bin_distance_from_range: null,
      minutes_in_range: null,
      minutes_out_of_range: null,
    },
    pnl_layers: {
      naive_paper_pnl_quote_value: null,
      conservative_adjusted_pnl_quote_value: null,
      uncertainty_score: null,
      calculation_status: "not_calculated",
    },
    divergence_flags: [],
  };
}

export function normalizeSimulatorSnapshot(input = {}) {
  const sanitized = sanitizeSimulatorSnapshot(input);
  const source = objectOrEmpty(sanitized);
  const price = objectOrEmpty(source.price_estimate);
  const inventory = objectOrEmpty(source.inventory_estimate);
  const fees = objectOrEmpty(source.fee_estimate);
  const risks = objectOrEmpty(source.risk_adjustments);
  const range = objectOrEmpty(source.range_state);
  const layers = objectOrEmpty(source.pnl_layers);

  return {
    simulator_version: stringOrUnknown(source.simulator_version) === "unknown"
      ? SIMULATOR_SCHEMA_VERSION
      : stringOrUnknown(source.simulator_version),
    data_source_label: dataSourceLabelOrUnknown(source.data_source_label),
    confidence_level: confidenceOrUnknown(source.confidence_level),
    source_timestamp: stringOrNull(source.source_timestamp),
    active_bin: finiteOrNull(source.active_bin),
    lower_bin: finiteOrNull(source.lower_bin),
    upper_bin: finiteOrNull(source.upper_bin),
    bin_step: finiteOrNull(source.bin_step),
    price_estimate: {
      token_x_per_token_y: finiteOrNull(price.token_x_per_token_y),
      token_y_per_token_x: finiteOrNull(price.token_y_per_token_x),
      source: stringOrUnknown(price.source),
      confidence_level: confidenceOrUnknown(price.confidence_level ?? price.confidence),
    },
    inventory_estimate: {
      quote_asset: stringOrUnknown(inventory.quote_asset),
      token_x_amount: finiteOrNull(inventory.token_x_amount),
      token_y_amount: finiteOrNull(inventory.token_y_amount),
      starting_quote_value: finiteOrNull(inventory.starting_quote_value),
      current_quote_value_naive: finiteOrNull(inventory.current_quote_value_naive),
    },
    fee_estimate: {
      claimed_fees_quote_value: finiteOrNull(fees.claimed_fees_quote_value),
      unclaimed_fees_quote_value: finiteOrNull(fees.unclaimed_fees_quote_value),
      source: stringOrUnknown(fees.source),
    },
    risk_adjustments: {
      estimated_il_quote_value: finiteOrNull(risks.estimated_il_quote_value),
      estimated_slippage_quote_value: finiteOrNull(risks.estimated_slippage_quote_value),
      latency_penalty_quote_value: finiteOrNull(risks.latency_penalty_quote_value),
      stale_data_penalty_quote_value: finiteOrNull(risks.stale_data_penalty_quote_value),
    },
    range_state: {
      in_range: booleanOrNull(range.in_range),
      out_of_range: booleanOrNull(range.out_of_range),
      active_bin_distance_from_range: finiteOrNull(range.active_bin_distance_from_range),
      minutes_in_range: finiteOrNull(range.minutes_in_range),
      minutes_out_of_range: finiteOrNull(range.minutes_out_of_range),
    },
    pnl_layers: {
      naive_paper_pnl_quote_value: finiteOrNull(layers.naive_paper_pnl_quote_value),
      conservative_adjusted_pnl_quote_value: finiteOrNull(layers.conservative_adjusted_pnl_quote_value),
      uncertainty_score: finiteOrNull(layers.uncertainty_score),
      calculation_status: stringOrUnknown(layers.calculation_status) === "unknown"
        ? "not_calculated"
        : stringOrUnknown(layers.calculation_status),
    },
    divergence_flags: listOfStrings(source.divergence_flags),
  };
}

export function createUnknownSimulatorSnapshot(overrides = {}) {
  return normalizeSimulatorSnapshot({ ...unknownSnapshot(), ...objectOrEmpty(overrides) });
}

export function validateSimulatorSnapshot(input = {}) {
  const errors = [];
  const warnings = [];

  if (!isPlainObject(input)) {
    errors.push("snapshot must be an object");
  } else {
    if (input.confidence_level != null && confidenceOrUnknown(input.confidence_level) === "unknown" && input.confidence_level !== "unknown") {
      warnings.push("confidence_level is unknown or unsupported");
    }
    if (input.data_source_label != null && dataSourceLabelOrUnknown(input.data_source_label) === "unknown" && input.data_source_label !== "unknown") {
      warnings.push("data_source_label is unknown or unsupported");
    }
    if (!input.source_timestamp) warnings.push("source_timestamp is missing");
    for (const key of ["price_estimate", "inventory_estimate", "fee_estimate", "risk_adjustments", "range_state", "pnl_layers"]) {
      if (input[key] != null && !isPlainObject(input[key])) {
        warnings.push(`${key} was not an object and was normalized to defaults`);
      }
    }
  }

  const snapshot = normalizeSimulatorSnapshot(input);
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    snapshot,
  };
}

export function getSimulatorEventTypes() {
  return [...SIMULATOR_EVENT_TYPES];
}
