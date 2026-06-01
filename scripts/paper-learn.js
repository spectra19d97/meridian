import fs from "fs";
import os from "os";
import path from "path";
import process from "process";

const SCHEMA_VERSION = "learning_v0.1";
const DEFAULT_LEARNING_FILE = path.join(os.tmpdir(), "meridian-paper-learning", "learning-summary.json");
const POSITIONS_FILE = process.env.PAPER_POSITIONS_FILE || "./paper-positions.json";
const EVENTS_FILE = process.env.PAPER_EVENTS_FILE || "./paper-events.jsonl";
const LEARNING_FILE = process.env.LEARNING_FILE || DEFAULT_LEARNING_FILE;
const STALE_SOURCE_MINUTES = 60;

const LABELS = [
  "Data Healthy",
  "Needs Review",
  "Insufficient Data",
  "Low Confidence",
  "Stale Data",
  "Warning Cluster",
  "Invalid Data",
  "Out Of Range",
  "Unknown",
];

const SENSITIVE_FIELD_PATTERN = /(private|secret|seed|mnemonic|wallet.*key|api.*key|apikey|token|bearer|authorization|auth|password|rpc)/i;
const SECRET_ENV_RE = /\b[A-Z0-9_]*(?:PRIVATE|SECRET|TOKEN|API|RPC)[A-Z0-9_]*=([^\s"',}]+)/gi;

function nowIso() {
  return new Date().toISOString();
}

function redactedString(value) {
  return String(value)
    .replace(SECRET_ENV_RE, (match) => `${match.split("=")[0]}=[REDACTED]`)
    .replace(/\[[\s\d,]{120,}\]/g, "[REDACTED_SECRET_ARRAY]")
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[REDACTED_TOKEN]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/gi, "Bearer [REDACTED]")
    .replace(/([?&](?:api[-_]?key|apikey|token|key)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/\b[1-9A-HJ-NP-Za-km-z]{64,}\b/g, "[REDACTED_BASE58_SECRET]");
}

function sanitize(value, keyName = "") {
  if (value == null) return value;
  if (keyName && SENSITIVE_FIELD_PATTERN.test(keyName)) {
    if (typeof value === "object") return "[REDACTED_SECRET]";
    if (value !== "") return "[REDACTED_SECRET]";
  }
  if (typeof value === "string") return redactedString(value).replace(/\s+/g, " ").trim();
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((entry) => sanitize(entry, keyName));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitize(entry, key)]),
    );
  }
  return null;
}

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== "";
}

function validDate(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function sortedTimestamps(events) {
  return events
    .map((event) => event.ts)
    .filter(Boolean)
    .sort((a, b) => String(a).localeCompare(String(b)));
}

function increment(object, key) {
  const normalized = hasValue(key) ? String(key) : "unknown";
  object[normalized] = (object[normalized] || 0) + 1;
}

function readPositions(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) return { path: resolved, status: "missing", positions: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(resolved, "utf8"));
    const rawPositions = parsed?.positions && typeof parsed.positions === "object"
      ? Object.values(parsed.positions)
      : Array.isArray(parsed)
        ? parsed
        : [];
    return { path: resolved, status: "ok", positions: rawPositions.map((position) => sanitize(position || {})) };
  } catch (error) {
    return { path: resolved, status: "parse_error", positions: [], warning: sanitize(error.message) };
  }
}

function readEvents(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) return { path: resolved, status: "missing", events: [], malformed: 0 };
  const events = [];
  let malformed = 0;
  for (const line of fs.readFileSync(resolved, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      events.push(sanitize(JSON.parse(line)));
    } catch {
      malformed += 1;
    }
  }
  return { path: resolved, status: "ok", events, malformed };
}

function strategyLabel(position, events) {
  return position?.strategy_version || position?.strategy_id || position?.strategy ||
    events.find((event) => event.strategy_version || event.strategy_id || event.strategy)?.strategy_version ||
    events.find((event) => event.strategy_id || event.strategy)?.strategy_id ||
    events.find((event) => event.strategy)?.strategy ||
    null;
}

function poolLabel(position, events, paperId) {
  return position?.pool_name || position?.pool ||
    events.find((event) => event.pool_name || event.pool)?.pool_name ||
    events.find((event) => event.pool)?.pool ||
    paperId;
}

function snapshotFor(event) {
  return isObject(event?.simulator_snapshot) ? event.simulator_snapshot : {};
}

function validationWarnings(event) {
  return Array.isArray(event?.validation?.warnings) ? event.validation.warnings : [];
}

function isStale(event) {
  const snapshot = snapshotFor(event);
  const sourceTs = validDate(snapshot.source_timestamp);
  const eventTs = validDate(event?.ts);
  if (sourceTs == null || eventTs == null) return false;
  return eventTs - sourceTs > STALE_SOURCE_MINUTES * 60 * 1000;
}

function isLowConfidence(event) {
  const confidence = snapshotFor(event).confidence_level;
  return confidence === "low" || confidence === "unknown";
}

function isOutOfRange(event) {
  return snapshotFor(event)?.range_state?.out_of_range === true;
}

function isSyntheticFixture({ paperId, poolName, events }) {
  return String(paperId || "").includes("fixture") ||
    String(poolName || "").startsWith("SYNTH-") ||
    events.some((event) => `${event.summary || ""} ${event.reason || ""}`.includes("synthetic fixture"));
}

function addUnique(list, value) {
  if (value && !list.includes(value)) list.push(value);
}

function chooseLabel(metrics) {
  if (metrics.invalid_data_count > 0) return "Invalid Data";
  if (metrics.warning_cluster) return "Warning Cluster";
  if (metrics.out_of_range_observation_count > 0) return "Out Of Range";
  if (metrics.stale_count > 0) return "Stale Data";
  if (metrics.low_confidence_count > 0) return "Low Confidence";
  if (metrics.snapshot_count + metrics.valuation_record_count === 0) return "Insufficient Data";
  if (metrics.orphan) return "Needs Review";
  if (metrics.review_reasons.length > 0) return "Needs Review";
  if (metrics.snapshot_count + metrics.valuation_record_count > 0) return "Data Healthy";
  return "Unknown";
}

function notesFor(label) {
  const notes = [];
  if (label === "Low Confidence") notes.push("This paper record needs review because confidence is low or unknown.");
  if (label === "Stale Data") notes.push("This record has stale local snapshot data.");
  if (label === "Warning Cluster") notes.push("This record has repeated warnings.");
  if (label === "Invalid Data") notes.push("This record has invalid local event data.");
  if (label === "Out Of Range") notes.push("This record was marked out of range by recorded snapshot data.");
  if (label === "Insufficient Data") notes.push("This record does not have enough local simulator data yet.");
  if (label === "Data Healthy") notes.push("This record has usable local event data. This is not a trade-quality label.");
  if (label === "Needs Review") notes.push("This paper record needs review based on local event history.");
  if (label === "Unknown") notes.push("This paper record has an unknown local learning state.");
  return notes;
}

function hasRedactedEventText(events) {
  return events.some((event) => `${event.summary || ""} ${event.reason || ""}`.includes("[REDACTED"));
}

function buildRecord({ paperId, position, events, generatedAt, orphan = false }) {
  const timestamps = sortedTimestamps(events);
  const poolName = poolLabel(position, events, paperId);
  const metrics = {
    snapshot_count: events.filter((event) => event.type === "paper_snapshot").length,
    valuation_record_count: events.filter((event) => event.type === "paper_valuation").length,
    warning_count: events.filter((event) => event.type === "paper_simulator_warning").length,
    stale_count: 0,
    low_confidence_count: 0,
    invalid_data_count: 0,
    out_of_range_observation_count: 0,
    validation_warning_count: 0,
    warning_cluster: false,
    orphan,
    review_reasons: [],
  };
  const dataSourceDistribution = {};
  const confidenceDistribution = {};

  for (const event of events) {
    const snapshot = snapshotFor(event);
    if (event.type === "paper_snapshot" || event.type === "paper_valuation") {
      increment(dataSourceDistribution, snapshot.data_source_label || "unknown");
      increment(confidenceDistribution, snapshot.confidence_level || "unknown");
      if (isStale(event)) metrics.stale_count += 1;
      if (isLowConfidence(event)) metrics.low_confidence_count += 1;
      if (isOutOfRange(event)) metrics.out_of_range_observation_count += 1;
    }
    if (event?.validation?.valid === false) metrics.invalid_data_count += 1;
    metrics.validation_warning_count += validationWarnings(event).length;
  }

  metrics.warning_cluster = metrics.warning_count >= 2 || metrics.validation_warning_count >= 2;

  if (orphan) addUnique(metrics.review_reasons, "orphan paper event");
  if (metrics.invalid_data_count > 0) addUnique(metrics.review_reasons, "invalid local event data");
  if (metrics.warning_cluster) addUnique(metrics.review_reasons, "repeated warnings");
  if (metrics.out_of_range_observation_count > 0) addUnique(metrics.review_reasons, "recorded out of range");
  if (metrics.stale_count > 0) addUnique(metrics.review_reasons, "stale local snapshot data");
  if (metrics.low_confidence_count > 0) addUnique(metrics.review_reasons, "low or unknown confidence");
  if (metrics.snapshot_count + metrics.valuation_record_count === 0) addUnique(metrics.review_reasons, "insufficient local simulator data");

  const currentLabel = chooseLabel(metrics);
  const learningFlags = [];
  for (const reason of metrics.review_reasons) addUnique(learningFlags, reason.replace(/\s+/g, "_"));

  const notes = notesFor(currentLabel);
  if (hasRedactedEventText(events)) {
    notes.push("One local event note contained [REDACTED] content.");
  }

  return {
    schema_version: SCHEMA_VERSION,
    generated_at: generatedAt,
    paper_id: paperId,
    pool_name: poolName || null,
    strategy_version: strategyLabel(position, events),
    first_event_ts: timestamps[0] || position?.created_at || null,
    latest_event_ts: timestamps[timestamps.length - 1] || position?.updated_at || null,
    snapshot_count: metrics.snapshot_count,
    valuation_record_count: metrics.valuation_record_count,
    warning_count: metrics.warning_count,
    stale_count: metrics.stale_count,
    low_confidence_count: metrics.low_confidence_count,
    invalid_data_count: metrics.invalid_data_count,
    out_of_range_observation_count: metrics.out_of_range_observation_count,
    last_known_quality_label: currentLabel,
    current_review_label: currentLabel,
    review_reasons: metrics.review_reasons,
    learning_flags: learningFlags,
    data_source_distribution: dataSourceDistribution,
    confidence_distribution: confidenceDistribution,
    synthetic_fixture_detected: isSyntheticFixture({ paperId, poolName, events }),
    notes,
  };
}

function summarize(records) {
  const summary = {
    total_records: records.length,
    data_healthy_count: 0,
    needs_review_count: 0,
    insufficient_data_count: 0,
    low_confidence_count: 0,
    stale_data_count: 0,
    warning_cluster_count: 0,
    invalid_data_count: 0,
    out_of_range_count: 0,
    unknown_count: 0,
    synthetic_fixture_detected: records.some((record) => record.synthetic_fixture_detected),
  };

  for (const record of records) {
    if (record.current_review_label === "Data Healthy") summary.data_healthy_count += 1;
    if (record.current_review_label === "Needs Review") summary.needs_review_count += 1;
    if (record.current_review_label === "Insufficient Data") summary.insufficient_data_count += 1;
    if (record.current_review_label === "Low Confidence") summary.low_confidence_count += 1;
    if (record.current_review_label === "Stale Data") summary.stale_data_count += 1;
    if (record.current_review_label === "Warning Cluster") summary.warning_cluster_count += 1;
    if (record.current_review_label === "Invalid Data") summary.invalid_data_count += 1;
    if (record.current_review_label === "Out Of Range") summary.out_of_range_count += 1;
    if (record.current_review_label === "Unknown") summary.unknown_count += 1;
  }

  return summary;
}

function buildLearningSummary() {
  const generatedAt = nowIso();
  const positionsResult = readPositions(POSITIONS_FILE);
  const eventsResult = readEvents(EVENTS_FILE);
  const positions = positionsResult.positions;
  const events = eventsResult.events.filter((event) => String(event.paper_id || "").startsWith("PAPER_"));
  const positionById = new Map(positions.map((position) => [position.paper_id, position]));
  const eventsByPaperId = new Map();

  for (const event of events) {
    const paperId = event.paper_id;
    if (!eventsByPaperId.has(paperId)) eventsByPaperId.set(paperId, []);
    eventsByPaperId.get(paperId).push(event);
  }

  const paperIds = new Set([...positionById.keys(), ...eventsByPaperId.keys()]);
  const records = [...paperIds]
    .sort()
    .map((paperId) => buildRecord({
      paperId,
      position: positionById.get(paperId) || null,
      events: eventsByPaperId.get(paperId) || [],
      generatedAt,
      orphan: !positionById.has(paperId),
    }));

  return {
    schema_version: SCHEMA_VERSION,
    generated_at: generatedAt,
    source_files: {
      positions: positionsResult.path,
      events: eventsResult.path,
      positions_status: positionsResult.status,
      events_status: eventsResult.status,
      malformed_event_lines: eventsResult.malformed,
    },
    summary: summarize(records),
    records,
    safety: {
      local_files_only: true,
      no_live_calls: true,
      no_pnl_or_valuation_math: true,
      not_trading_advice: true,
    },
  };
}

try {
  const learning = buildLearningSummary();
  const outputPath = path.resolve(LEARNING_FILE);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(learning, null, 2)}\n`);

  const lines = [
    "MERIDIAN PAPER LEARNING SUMMARY",
    "Safety: local files only; no wallet/RPC/API/SDK calls",
    "",
    `Learning file: ${outputPath}`,
    `Total records: ${learning.summary.total_records}`,
    `Data Healthy: ${learning.summary.data_healthy_count}`,
    `Needs Review: ${learning.summary.needs_review_count}`,
    `Insufficient Data: ${learning.summary.insufficient_data_count}`,
    `Low Confidence: ${learning.summary.low_confidence_count}`,
    `Stale Data: ${learning.summary.stale_data_count}`,
    `Warning Cluster: ${learning.summary.warning_cluster_count}`,
    `Invalid Data: ${learning.summary.invalid_data_count}`,
    `Out Of Range: ${learning.summary.out_of_range_count}`,
    `Unknown: ${learning.summary.unknown_count}`,
    "",
  ];
  process.stdout.write(lines.join("\n"));
} catch (error) {
  process.stderr.write(`${sanitize(error.message)}\n`);
  process.exitCode = 1;
}
