import assert from "assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  createUnknownSimulatorSnapshot,
  getSimulatorEventTypes,
  normalizeSimulatorSnapshot,
  sanitizeSimulatorSnapshot,
  validateSimulatorSnapshot,
} from "../paper-simulator-schema.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = path.join(repoRoot, "paper-simulator-schema.js");

const unknown = createUnknownSimulatorSnapshot();
assert.equal(unknown.simulator_version, "2.1.0");
assert.equal(unknown.data_source_label, "unknown");
assert.equal(unknown.confidence_level, "unknown");
assert.equal(unknown.source_timestamp, null);
assert.equal(unknown.active_bin, null);
assert.equal(unknown.lower_bin, null);
assert.equal(unknown.upper_bin, null);
assert.equal(unknown.bin_step, null);
assert.deepEqual(unknown.divergence_flags, []);

for (const [section, fields] of Object.entries({
  price_estimate: ["token_x_per_token_y", "token_y_per_token_x", "source", "confidence_level"],
  inventory_estimate: ["quote_asset", "token_x_amount", "token_y_amount", "starting_quote_value", "current_quote_value_naive"],
  fee_estimate: ["claimed_fees_quote_value", "unclaimed_fees_quote_value", "source"],
  risk_adjustments: ["estimated_il_quote_value", "estimated_slippage_quote_value", "latency_penalty_quote_value", "stale_data_penalty_quote_value"],
  range_state: ["in_range", "out_of_range", "active_bin_distance_from_range", "minutes_in_range", "minutes_out_of_range"],
  pnl_layers: ["naive_paper_pnl_quote_value", "conservative_adjusted_pnl_quote_value", "uncertainty_score", "calculation_status"],
})) {
  assert.equal(typeof unknown[section], "object", `${section} must exist`);
  for (const field of fields) {
    assert.ok(Object.hasOwn(unknown[section], field), `${section}.${field} missing`);
  }
}

const malformedNumbers = normalizeSimulatorSnapshot({
  active_bin: "",
  lower_bin: "not-a-number",
  upper_bin: Number.POSITIVE_INFINITY,
  bin_step: false,
  price_estimate: { token_x_per_token_y: "", token_y_per_token_x: "NaN" },
  inventory_estimate: { starting_quote_value: undefined, current_quote_value_naive: null },
  fee_estimate: { claimed_fees_quote_value: "unknown", unclaimed_fees_quote_value: "" },
  risk_adjustments: { estimated_il_quote_value: "bad", estimated_slippage_quote_value: Number.NaN },
});
assert.equal(malformedNumbers.active_bin, null);
assert.equal(malformedNumbers.lower_bin, null);
assert.equal(malformedNumbers.upper_bin, null);
assert.equal(malformedNumbers.bin_step, null);
assert.equal(malformedNumbers.price_estimate.token_x_per_token_y, null);
assert.equal(malformedNumbers.price_estimate.token_y_per_token_x, null);
assert.equal(malformedNumbers.inventory_estimate.starting_quote_value, null);
assert.equal(malformedNumbers.inventory_estimate.current_quote_value_naive, null);
assert.equal(malformedNumbers.fee_estimate.claimed_fees_quote_value, null);
assert.equal(malformedNumbers.fee_estimate.unclaimed_fees_quote_value, null);
assert.equal(malformedNumbers.risk_adjustments.estimated_il_quote_value, null);
assert.equal(malformedNumbers.risk_adjustments.estimated_slippage_quote_value, null);

const explicitZero = normalizeSimulatorSnapshot({
  active_bin: 0,
  inventory_estimate: { starting_quote_value: 0 },
});
assert.equal(explicitZero.active_bin, 0);
assert.equal(explicitZero.inventory_estimate.starting_quote_value, 0);

assert.equal(normalizeSimulatorSnapshot({ data_source_label: "paper_input" }).data_source_label, "paper_input");
assert.equal(normalizeSimulatorSnapshot({ data_source_label: "recorded_snapshot" }).data_source_label, "recorded_snapshot");
assert.equal(normalizeSimulatorSnapshot({ data_source_label: "manual_import" }).data_source_label, "manual_import");
assert.equal(normalizeSimulatorSnapshot({ data_source_label: "test_fixture" }).data_source_label, "test_fixture");
assert.equal(normalizeSimulatorSnapshot({ data_source_label: "unsupported_source" }).data_source_label, "unknown");
assert.equal(normalizeSimulatorSnapshot({ data_source_label: 123 }).data_source_label, "unknown");
assert.equal(normalizeSimulatorSnapshot({}).data_source_label, "unknown");

const envName = ["WALLET", "PRIVATE", "KEY"].join("_");
const secretValue = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const sanitized = sanitizeSimulatorSnapshot({
  data_source_label: `${envName}=${secretValue}`,
  nested: {
    token: secretValue,
    note: `Bearer ${secretValue}`,
  },
});
assert.match(sanitized.data_source_label, /\[REDACTED/);
assert.equal(sanitized.data_source_label.includes(secretValue), false);
assert.equal(sanitized.nested.token, "[REDACTED_SECRET]");
assert.equal(sanitized.nested.note.includes(secretValue), false);

const secretSnapshot = normalizeSimulatorSnapshot({
  data_source_label: `${envName}=${secretValue}`,
  divergence_flags: [`raw ${secretValue}`],
});
assert.equal(secretSnapshot.data_source_label, "unknown");
assert.equal(secretSnapshot.data_source_label.includes(secretValue), false);
assert.equal(secretSnapshot.divergence_flags[0].includes(secretValue), false);

const malformedNested = normalizeSimulatorSnapshot({
  price_estimate: "bad",
  inventory_estimate: 42,
  fee_estimate: null,
  risk_adjustments: ["bad"],
  range_state: "bad",
  pnl_layers: "bad",
});
assert.equal(malformedNested.price_estimate.token_x_per_token_y, null);
assert.equal(malformedNested.inventory_estimate.quote_asset, "unknown");
assert.equal(malformedNested.fee_estimate.claimed_fees_quote_value, null);
assert.equal(malformedNested.risk_adjustments.estimated_il_quote_value, null);
assert.equal(malformedNested.range_state.in_range, null);
assert.equal(malformedNested.pnl_layers.calculation_status, "not_calculated");

const validation = validateSimulatorSnapshot({
  confidence_level: "unsupported",
  data_source_label: "unsupported_source",
  price_estimate: "bad",
});
assert.equal(validation.valid, true);
assert.match(validation.warnings.join(" | "), /confidence_level/);
assert.match(validation.warnings.join(" | "), /data_source_label/);
assert.match(validation.warnings.join(" | "), /price_estimate/);
assert.equal(validateSimulatorSnapshot("bad").valid, false);

const eventTypes = getSimulatorEventTypes();
assert.ok(eventTypes.includes("paper_snapshot"));
assert.ok(eventTypes.includes("paper_valuation"));
assert.ok(eventTypes.includes("paper_simulator_warning"));
eventTypes.push("mutated");
assert.equal(getSimulatorEventTypes().includes("mutated"), false);

const schemaSource = fs.readFileSync(schemaPath, "utf8");
assert.equal(schemaSource.includes("import "), false, "schema helper must not import modules");
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
  assert.equal(schemaSource.includes(forbidden), false, `schema helper must not reference ${forbidden}`);
}

console.log("Paper simulator schema tests passed");
