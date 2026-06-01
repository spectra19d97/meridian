/**
 * Dry-Run v2 Phase 1 paper trading store.
 *
 * This module is intentionally local-only. It must not import wallet,
 * RPC, DLMM SDK, or any code path that can touch private keys.
 */

import crypto from "crypto";
import fs from "fs";

import { normalizeSimulatorSnapshot, validateSimulatorSnapshot } from "./paper-simulator-schema.js";
import { getStrategyContract } from "./strategy-contract.js";

const PAPER_POSITIONS_FILE = process.env.PAPER_POSITIONS_FILE || "./paper-positions.json";
const PAPER_EVENTS_FILE = process.env.PAPER_EVENTS_FILE || "./paper-events.jsonl";

const EVENT_TYPES = new Set([
  "paper_deploy",
  "paper_reject",
  "paper_hold_note",
  "paper_claim",
  "paper_close",
  "paper_anomaly",
  "paper_snapshot",
  "paper_valuation",
  "paper_simulator_warning",
]);

const SIMULATOR_WARNING_SEVERITIES = new Set(["unknown", "low", "medium", "high"]);

const SHAPE_TO_CONTRACT = {
  spot: "spot_efficiency_v1",
  bid_ask: "bidask_dump_reversal_v1",
};

const SECRET_KEY_PATTERN = /(private|secret|seed|mnemonic|wallet.*key|api.*key|apikey|token|bearer|authorization|auth|password|rpc)/i;

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

function loadPositions() {
  if (!fs.existsSync(PAPER_POSITIONS_FILE)) return { positions: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(PAPER_POSITIONS_FILE, "utf8"));
    return parsed && typeof parsed === "object" && parsed.positions && typeof parsed.positions === "object"
      ? parsed
      : { positions: {} };
  } catch {
    return { positions: {} };
  }
}

function savePositions(data) {
  fs.writeFileSync(PAPER_POSITIONS_FILE, JSON.stringify(data, null, 2));
}

function redactedString(value) {
  return String(value)
    .replace(/\b(WALLET_PRIVATE_KEY|PRIVATE_KEY|SECRET_KEY|API_KEY|OPENAI_API_KEY|LLM_API_KEY|HIVEMIND_API_KEY|PUBLIC_API_KEY)=([^\s"'`,}]+)/gi, "$1=[REDACTED]")
    .replace(/\[[\s\d,]{120,}\]/g, "[REDACTED_SECRET_ARRAY]")
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[REDACTED_API_KEY]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/gi, "Bearer [REDACTED]")
    .replace(/([?&](?:api[-_]?key|apikey|token|key)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/\b[1-9A-HJ-NP-Za-km-z]{64,}\b/g, "[REDACTED_BASE58_SECRET]");
}

export function sanitizePaperPayload(value, keyName = "") {
  if (value == null) return value;
  if (keyName && SECRET_KEY_PATTERN.test(keyName)) {
    if (typeof value === "object") return "[REDACTED_SECRET]";
    if (value !== "") return "[REDACTED_SECRET]";
  }
  if (typeof value === "string") return redactedString(value).replace(/\s+/g, " ").trim();
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((entry) => sanitizePaperPayload(entry, keyName));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitizePaperPayload(entry, key)]),
    );
  }
  return null;
}

function finiteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function listOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function severityOrUnknown(value) {
  if (typeof value !== "string") return "unknown";
  const normalized = value.trim().toLowerCase();
  return SIMULATOR_WARNING_SEVERITIES.has(normalized) ? normalized : "unknown";
}

function textOrDefault(value, fallback) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function strategyVersionFor(input) {
  const explicit = input.strategy_version || input.strategy_contract_id;
  if (explicit) return explicit;
  return SHAPE_TO_CONTRACT[input.shape || input.strategy] || null;
}

function contractFields(contract) {
  if (!contract) return {};
  return {
    default_status: contract.default_status,
    required_event_logging_fields: contract.required_event_logging_fields,
    evaluation_metrics: contract.evaluation_metrics,
  };
}

export function appendPaperEvent(event) {
  const type = EVENT_TYPES.has(event?.type) ? event.type : "paper_anomaly";
  const sanitized = sanitizePaperPayload(event || {});
  const record = {
    event_id: makeId("pevt"),
    ts: nowIso(),
    type,
    paper_id: sanitized.paper_id || null,
    strategy_version: sanitized.strategy_version || null,
    pool: sanitized.pool || null,
    pool_name: sanitized.pool_name || null,
    summary: sanitized.summary || null,
    reason: sanitized.reason || null,
    hard_filters_passed: listOrEmpty(sanitized.hard_filters_passed),
    hard_filters_failed: listOrEmpty(sanitized.hard_filters_failed),
    soft_signals_used: listOrEmpty(sanitized.soft_signals_used),
    metrics_snapshot: sanitized.metrics_snapshot || {},
    strategy_contract_fields: sanitized.strategy_contract_fields || {},
    simulator_snapshot: sanitized.simulator_snapshot || null,
    simulator_warning: sanitized.simulator_warning || null,
    validation: sanitized.validation || null,
    human_review_needed: !!sanitized.human_review_needed,
  };
  fs.appendFileSync(PAPER_EVENTS_FILE, `${JSON.stringify(record)}\n`);
  return record;
}

export function createPaperPosition(input = {}) {
  const sanitized = sanitizePaperPayload(input);
  const timestamp = nowIso();
  const strategyVersion = strategyVersionFor(sanitized);
  const contract = getStrategyContract(strategyVersion);
  const strategyContractFields = contractFields(contract);

  const paperId = makeId("PAPER");
  const position = {
    paper_id: paperId,
    status: "open",
    created_at: timestamp,
    updated_at: timestamp,
    closed_at: null,
    pool: sanitized.pool || sanitized.pool_address || null,
    pool_name: sanitized.pool_name || sanitized.pool || sanitized.pool_address || null,
    base_mint: sanitized.base_mint || null,
    strategy_version: strategyVersion,
    strategy_contract_status: contract?.default_status || null,
    shape: sanitized.shape || sanitized.strategy || null,
    amount_sol: finiteOrNull(sanitized.amount_sol ?? sanitized.amount_y),
    bin_step: finiteOrNull(sanitized.bin_step),
    entry_active_bin: finiteOrNull(sanitized.entry_active_bin ?? sanitized.active_bin),
    bins_below: finiteOrNull(sanitized.bins_below),
    bins_above: finiteOrNull(sanitized.bins_above),
    entry_range: {
      lower_bin: sanitized.entry_range?.lower_bin ?? sanitized.lower_bin ?? null,
      upper_bin: sanitized.entry_range?.upper_bin ?? sanitized.upper_bin ?? null,
      downside_pct: sanitized.entry_range?.downside_pct ?? sanitized.downside_pct ?? null,
      upside_pct: sanitized.entry_range?.upside_pct ?? sanitized.upside_pct ?? null,
    },
    source_metrics: {
      fee_active_tvl_ratio: sanitized.source_metrics?.fee_active_tvl_ratio ?? sanitized.fee_active_tvl_ratio ?? sanitized.fee_tvl_ratio ?? null,
      volume_tvl_ratio: sanitized.source_metrics?.volume_tvl_ratio ?? sanitized.volume_tvl_ratio ?? null,
      organic_score: sanitized.source_metrics?.organic_score ?? sanitized.organic_score ?? null,
      volatility: sanitized.source_metrics?.volatility ?? sanitized.volatility ?? null,
    },
    entry_reason: sanitized.entry_reason || sanitized.reason || null,
    risk_flags: listOrEmpty(sanitized.risk_flags),
    last_event_id: null,
    strategy_contract_fields: strategyContractFields,
  };

  const event = appendPaperEvent({
    type: "paper_deploy",
    paper_id: paperId,
    strategy_version: strategyVersion,
    pool: position.pool,
    pool_name: position.pool_name,
    summary: "Paper deploy recorded",
    reason: position.entry_reason,
    hard_filters_passed: sanitized.hard_filters_passed,
    hard_filters_failed: sanitized.hard_filters_failed,
    soft_signals_used: sanitized.soft_signals_used,
    metrics_snapshot: position.source_metrics,
    strategy_contract_fields: strategyContractFields,
    human_review_needed: !!sanitized.human_review_needed,
  });

  position.last_event_id = event.event_id;

  const store = loadPositions();
  store.positions[paperId] = position;
  savePositions(store);
  return position;
}

export function getPaperPosition(paperId) {
  if (!paperId || !String(paperId).startsWith("PAPER_")) return null;
  const store = loadPositions();
  return store.positions[paperId] || null;
}

export function listPaperPositions({ status, limit } = {}) {
  const max = Number.isFinite(Number(limit)) ? Math.max(1, Number(limit)) : 50;
  const store = loadPositions();
  const positions = Object.values(store.positions)
    .filter((position) => !status || position.status === status)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, max);
  return { count: positions.length, positions };
}

export function closePaperPosition(paperId, reason = "paper close") {
  if (!paperId || !String(paperId).startsWith("PAPER_")) {
    return { error: "paper_id must start with PAPER_" };
  }
  const store = loadPositions();
  const position = store.positions[paperId];
  if (!position) return { error: `Paper position ${paperId} not found` };
  if (position.status === "closed") return { error: `Paper position ${paperId} is already closed`, position };

  const event = appendPaperEvent({
    type: "paper_close",
    paper_id: paperId,
    strategy_version: position.strategy_version,
    pool: position.pool,
    pool_name: position.pool_name,
    summary: "Paper position closed",
    reason,
    strategy_contract_fields: position.strategy_contract_fields,
  });

  position.status = "closed";
  position.updated_at = event.ts;
  position.closed_at = event.ts;
  position.last_event_id = event.event_id;
  store.positions[paperId] = position;
  savePositions(store);
  return { position, event };
}

export function claimPaperFees(paperId, note = "paper claim") {
  if (!paperId || !String(paperId).startsWith("PAPER_")) {
    return { error: "paper_id must start with PAPER_" };
  }
  const position = getPaperPosition(paperId);
  if (!position) return { error: `Paper position ${paperId} not found` };
  if (position.status === "closed") return { error: `Paper position ${paperId} is already closed` };

  return appendPaperEvent({
    type: "paper_claim",
    paper_id: paperId,
    strategy_version: position.strategy_version,
    pool: position.pool,
    pool_name: position.pool_name,
    summary: "Paper fee claim recorded",
    reason: note,
    strategy_contract_fields: position.strategy_contract_fields,
  });
}

function paperPositionForRecorder(paperId) {
  if (!paperId || !String(paperId).startsWith("PAPER_")) {
    return { error: "paper_id must start with PAPER_" };
  }
  const position = getPaperPosition(paperId);
  if (!position) return { error: `Paper position ${paperId} not found` };
  return { position };
}

function validationWithRecorderWarnings(validation, snapshot) {
  const warnings = [...listOrEmpty(validation?.warnings)];
  if (snapshot?.confidence_level === "low" || snapshot?.confidence_level === "unknown") {
    warnings.push(`snapshot confidence is ${snapshot.confidence_level}`);
  }
  return {
    valid: !!validation?.valid,
    errors: listOrEmpty(validation?.errors),
    warnings,
  };
}

function appendSimulatorSnapshotEvent({ paperId, snapshotInput, note, type, summary }) {
  const lookup = paperPositionForRecorder(paperId);
  if (lookup.error) return lookup;

  const validation = validateSimulatorSnapshot(snapshotInput);
  if (!validation.valid) {
    return { error: "simulator snapshot validation failed", validation };
  }

  const snapshot = normalizeSimulatorSnapshot(snapshotInput);
  const eventValidation = validationWithRecorderWarnings(validation, snapshot);
  const position = lookup.position;

  const event = appendPaperEvent({
    type,
    paper_id: paperId,
    strategy_version: position.strategy_version,
    pool: position.pool,
    pool_name: position.pool_name,
    summary,
    reason: note,
    simulator_snapshot: snapshot,
    validation: eventValidation,
    strategy_contract_fields: position.strategy_contract_fields,
    human_review_needed: eventValidation.warnings.length > 0,
  });

  return { event, validation: eventValidation };
}

export function appendPaperSnapshotEvent(paperId, snapshotInput = {}, note = "") {
  return appendSimulatorSnapshotEvent({
    paperId,
    snapshotInput,
    note,
    type: "paper_snapshot",
    summary: "Paper simulator snapshot recorded from provided input",
  });
}

export function appendPaperValuationEvent(paperId, snapshotInput = {}, note = "") {
  return appendSimulatorSnapshotEvent({
    paperId,
    snapshotInput,
    note,
    type: "paper_valuation",
    summary: "Paper valuation snapshot recorded from provided input",
  });
}

export function appendPaperSimulatorWarning(paperId, warningInput = {}) {
  const lookup = paperPositionForRecorder(paperId);
  if (lookup.error) return lookup;

  const source = objectOrEmpty(sanitizePaperPayload(warningInput));
  const simulatorWarning = {
    severity: severityOrUnknown(source.severity),
    code: textOrDefault(source.code, "unknown"),
    details: objectOrEmpty(source.details),
  };
  const reason = textOrDefault(source.reason || source.message, "paper simulator warning");
  const position = lookup.position;

  const event = appendPaperEvent({
    type: "paper_simulator_warning",
    paper_id: paperId,
    strategy_version: position.strategy_version,
    pool: position.pool,
    pool_name: position.pool_name,
    summary: "Paper simulator warning recorded",
    reason,
    simulator_warning: simulatorWarning,
    validation: {
      valid: true,
      errors: [],
      warnings: [],
    },
    strategy_contract_fields: position.strategy_contract_fields,
    human_review_needed: true,
  });

  return { event };
}
