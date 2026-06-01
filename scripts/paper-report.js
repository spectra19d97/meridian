import fs from "fs";
import path from "path";
import process from "process";

const POSITIONS_FILE = process.env.PAPER_POSITIONS_FILE || "./paper-positions.json";
const EVENTS_FILE = process.env.PAPER_EVENTS_FILE || "./paper-events.jsonl";

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

const DATA_SOURCE_LABELS = ["paper_input", "recorded_snapshot", "manual_import", "test_fixture", "unknown"];
const CONFIDENCE_LABELS = ["high", "medium", "low", "unknown"];
const SIMULATOR_EVENT_TYPES = new Set(["paper_snapshot", "paper_valuation"]);
const STALE_SOURCE_MINUTES = 60;

const SENSITIVE_FIELD_PATTERN = /(private|secret|seed|mnemonic|wallet.*key|api.*key|apikey|token|bearer|authorization|auth|password|rpc)/i;
const SECRET_ENV_NAMES = [
  ["WALLET", "PRIVATE", "KEY"].join("_"),
  ["PRIVATE", "KEY"].join("_"),
  ["SECRET", "KEY"].join("_"),
  ["API", "KEY"].join("_"),
  ["OPENAI", "API", "KEY"].join("_"),
  ["LLM", "API", "KEY"].join("_"),
  ["HIVEMIND", "API", "KEY"].join("_"),
  ["PUBLIC", "API", "KEY"].join("_"),
];
const SECRET_ENV_VALUE_RE = "[^\\s\"',}]+";
const SECRET_ENV_RE = new RegExp(`\\b(${SECRET_ENV_NAMES.join("|")})=(${SECRET_ENV_VALUE_RE})`, "gi");

function redactedString(value) {
  return String(value)
    .replace(SECRET_ENV_RE, "$1=[REDACTED]")
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

function label(value, fallback = "unknown") {
  const sanitized = sanitize(value);
  if (sanitized == null || sanitized === "") return fallback;
  return String(sanitized);
}

function strategyLabel(record) {
  return label(record?.strategy_version || record?.strategy || record?.strategy_id);
}

function readPositions(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    return { path: resolved, status: "missing", positions: [], warning: "missing" };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(resolved, "utf8"));
    const rawPositions = parsed?.positions && typeof parsed.positions === "object"
      ? Object.values(parsed.positions)
      : Array.isArray(parsed)
        ? parsed
        : [];
    return {
      path: resolved,
      status: "ok",
      positions: rawPositions.map((position) => sanitize(position || {})),
      warning: null,
    };
  } catch (error) {
    return {
      path: resolved,
      status: "parse_error",
      positions: [],
      warning: sanitize(error.message),
    };
  }
}

function readEvents(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    return { path: resolved, status: "missing", events: [], malformed: 0, warning: "missing" };
  }

  const events = [];
  let malformed = 0;
  const lines = fs.readFileSync(resolved, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const event = sanitize(JSON.parse(line));
      if (!EVENT_TYPES.has(event?.type)) {
        events.push({ ...event, type: event?.type || "unknown_event", _unknown_type: true });
      } else {
        events.push(event);
      }
    } catch {
      malformed += 1;
    }
  }

  return { path: resolved, status: "ok", events, malformed, warning: malformed ? `${malformed} malformed line(s)` : null };
}

function countBy(items, keyFn) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function eventCount(events, type) {
  return events.filter((event) => event.type === type).length;
}

function anomalyCount(events, malformed) {
  return malformed + events.filter((event) => (
    event.type === "paper_anomaly" ||
    event.type === "paper_simulator_warning" ||
    event.type === "paper_reject" ||
    event._unknown_type
  )).length;
}

function latestEvents(events, limit = 10) {
  return [...events]
    .sort((a, b) => String(b.ts || "").localeCompare(String(a.ts || "")))
    .slice(0, limit);
}

function renderList(entries, emptyLabel = "- none") {
  if (!entries.length) return [emptyLabel];
  return entries.map(([name, count]) => `- ${name}: ${count}`);
}

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== "";
}

function knownValue(value) {
  return hasValue(value) && value !== "unknown";
}

function increment(counter, key) {
  counter.set(key, (counter.get(key) || 0) + 1);
}

function sortByTimestampDesc(items) {
  return [...items].sort((a, b) => String(b.ts || "").localeCompare(String(a.ts || "")));
}

function latestSimulatorEvent(events, paperId) {
  return sortByTimestampDesc(events.filter((event) => (
    event.paper_id === paperId && SIMULATOR_EVENT_TYPES.has(event.type)
  )))[0] || null;
}

function relatedSimulatorWarnings(events, paperId) {
  return events.filter((event) => event.paper_id === paperId && event.type === "paper_simulator_warning");
}

function validationWarnings(event) {
  return Array.isArray(event?.validation?.warnings) ? event.validation.warnings : [];
}

function validDate(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function sourceIsStale(event, snapshot) {
  const sourceTs = validDate(snapshot?.source_timestamp);
  const eventTs = validDate(event?.ts);
  if (sourceTs == null || eventTs == null) return false;
  return eventTs - sourceTs > STALE_SOURCE_MINUTES * 60 * 1000;
}

function hasRangeState(snapshot) {
  const range = isObject(snapshot?.range_state) ? snapshot.range_state : {};
  return Object.values(range).some(hasValue);
}

function missingFields(snapshot) {
  const missing = [];
  const inventory = isObject(snapshot?.inventory_estimate) ? snapshot.inventory_estimate : {};
  const price = isObject(snapshot?.price_estimate) ? snapshot.price_estimate : {};

  if (!hasValue(snapshot?.source_timestamp)) missing.push("source_timestamp");
  if (!hasValue(snapshot?.active_bin)) missing.push("active_bin");
  if (!hasValue(snapshot?.lower_bin) || !hasValue(snapshot?.upper_bin)) missing.push("range");
  if (!hasValue(snapshot?.bin_step)) missing.push("bin_step");
  if (!knownValue(inventory.quote_asset)) missing.push("quote_asset");
  if (!hasValue(price.token_x_per_token_y) && !hasValue(price.token_y_per_token_x)) {
    missing.push("price estimate");
  }
  if (
    !hasValue(inventory.token_x_amount) &&
    !hasValue(inventory.token_y_amount) &&
    !hasValue(inventory.starting_quote_value) &&
    !hasValue(inventory.current_quote_value_naive)
  ) {
    missing.push("inventory estimate");
  }
  if (!hasRangeState(snapshot)) missing.push("range_state");
  return missing;
}

function reviewReasons({ event, snapshot, warnings, orphan }) {
  const reasons = [];
  const missing = missingFields(snapshot);

  if (orphan) reasons.push("orphan simulator event");
  if (missing.includes("source_timestamp")) reasons.push("missing source_timestamp");
  if (snapshot?.confidence_level === "low") reasons.push("confidence low");
  if (!knownValue(snapshot?.confidence_level)) reasons.push("confidence unknown");
  if (!knownValue(snapshot?.data_source_label)) reasons.push("data source unknown");
  if (missing.includes("active_bin")) reasons.push("missing active_bin");
  if (missing.includes("range")) reasons.push("missing range");
  if (missing.includes("bin_step")) reasons.push("missing bin_step");
  if (missing.includes("quote_asset")) reasons.push("missing quote_asset");
  if (missing.includes("price estimate")) reasons.push("missing price estimate");
  if (missing.includes("inventory estimate")) reasons.push("missing inventory estimate");
  if (missing.includes("range_state")) reasons.push("missing range_state");
  if (validationWarnings(event).length) reasons.push("validation warnings");
  if (event?.validation && event.validation.valid === false) reasons.push("validation invalid");
  if (warnings.length) reasons.push("simulator warning");
  if (sourceIsStale(event, snapshot)) reasons.push("stale source timestamp");

  return [...new Set(reasons)];
}

function qualityLabel(snapshot, reasons, hasSimulatorData) {
  if (!hasSimulatorData) return "Insufficient Data";
  if (snapshot?.confidence_level === "low" || !knownValue(snapshot?.confidence_level)) {
    return "Low Confidence";
  }
  if (missingFields(snapshot).length === 0) return "Data Complete";
  return "Partial Data";
}

function analyzeSimulatorQuality(positions, events) {
  const positionById = new Map(positions.map((position) => [position.paper_id, position]));
  const simulatorEvents = sortByTimestampDesc(events.filter((event) => SIMULATOR_EVENT_TYPES.has(event.type)));
  const warningEvents = sortByTimestampDesc(events.filter((event) => event.type === "paper_simulator_warning"));
  const rows = [];
  const sources = new Map(DATA_SOURCE_LABELS.map((name) => [name, 0]));
  const confidence = new Map(CONFIDENCE_LABELS.map((name) => [name, 0]));

  for (const position of positions) {
    const event = latestSimulatorEvent(events, position.paper_id);
    const warnings = relatedSimulatorWarnings(events, position.paper_id);
    const snapshot = isObject(event?.simulator_snapshot) ? event.simulator_snapshot : {};
    const hasSimulatorData = !!event;
    const reasons = reviewReasons({ event, snapshot, warnings, orphan: false });
    const primaryLabel = qualityLabel(snapshot, reasons, hasSimulatorData);
    const source = knownValue(snapshot.data_source_label) ? snapshot.data_source_label : "unknown";
    const confidenceLevel = knownValue(snapshot.confidence_level) ? snapshot.confidence_level : "unknown";

    increment(sources, DATA_SOURCE_LABELS.includes(source) ? source : "unknown");
    increment(confidence, CONFIDENCE_LABELS.includes(confidenceLevel) ? confidenceLevel : "unknown");
    rows.push({
      paper_id: position.paper_id,
      pool: position.pool_name || position.pool,
      strategy: strategyLabel(position),
      latest_ts: event?.ts || "none",
      primary_label: primaryLabel,
      needs_review: reasons.length > 0 || primaryLabel === "Insufficient Data",
      review_reasons: reasons.length ? reasons : primaryLabel === "Insufficient Data" ? ["missing source_timestamp"] : [],
      missing: hasSimulatorData ? missingFields(snapshot) : ["source_timestamp", "active_bin", "range"],
      has_simulator_data: hasSimulatorData,
    });
  }

  for (const event of simulatorEvents) {
    if (!event.paper_id || positionById.has(event.paper_id)) continue;
    const snapshot = isObject(event.simulator_snapshot) ? event.simulator_snapshot : {};
    rows.push({
      paper_id: event.paper_id || "no-paper-id",
      pool: event.pool_name || event.pool || "unknown",
      strategy: strategyLabel(event),
      latest_ts: event.ts || "unknown",
      primary_label: "Partial Data",
      needs_review: true,
      review_reasons: reviewReasons({ event, snapshot, warnings: [], orphan: true }),
      missing: missingFields(snapshot),
      has_simulator_data: true,
    });
  }

  for (const event of warningEvents) {
    if (!event.paper_id || positionById.has(event.paper_id)) continue;
    rows.push({
      paper_id: event.paper_id || "no-paper-id",
      pool: event.pool_name || event.pool || "unknown",
      strategy: strategyLabel(event),
      latest_ts: event.ts || "unknown",
      primary_label: "Partial Data",
      needs_review: true,
      review_reasons: ["orphan simulator event", "simulator warning"],
      missing: [],
      has_simulator_data: true,
    });
  }

  const counts = {
    withData: rows.filter((row) => row.has_simulator_data && positionById.has(row.paper_id)).length,
    dataComplete: rows.filter((row) => row.primary_label === "Data Complete").length,
    partialData: rows.filter((row) => row.primary_label === "Partial Data").length,
    lowConfidence: rows.filter((row) => row.primary_label === "Low Confidence").length,
    insufficientData: rows.filter((row) => row.primary_label === "Insufficient Data").length,
    needsReview: rows.filter((row) => row.needs_review).length,
  };

  return { rows, counts, sources, confidence, warningEvents };
}

function renderReport() {
  const positionsResult = readPositions(POSITIONS_FILE);
  const eventsResult = readEvents(EVENTS_FILE);
  const positions = positionsResult.positions;
  const events = eventsResult.events;
  const openPositions = positions.filter((position) => position.status === "open");
  const closedPositions = positions.filter((position) => position.status === "closed");
  const strategyUsage = countBy(positions, strategyLabel);
  const poolUsage = countBy(positions, (position) => label(position.pool_name || position.pool));
  const anomalyRejectErrorCount = anomalyCount(events, eventsResult.malformed);
  const simulatorQuality = analyzeSimulatorQuality(positions, events);

  const lines = [
    "MERIDIAN PAPER / DRY-RUN REPORT",
    "Safety: local files only; no wallet/RPC/API/SDK calls",
    "",
    "Files:",
    `- Positions: ${label(positionsResult.path)} (${positionsResult.status})`,
    `- Events: ${label(eventsResult.path)} (${eventsResult.status})`,
  ];

  if (positionsResult.warning) lines.push(`- Positions warning: ${label(positionsResult.warning)}`);
  if (eventsResult.warning) lines.push(`- Events warning: ${label(eventsResult.warning)}`);

  lines.push(
    "",
    "Summary:",
    `- Total paper positions: ${positions.length}`,
    `- Open: ${openPositions.length}`,
    `- Closed: ${closedPositions.length}`,
    `- Deploy events: ${eventCount(events, "paper_deploy")}`,
    `- Claim events: ${eventCount(events, "paper_claim")}`,
    `- Close events: ${eventCount(events, "paper_close")}`,
    `- Snapshot events: ${eventCount(events, "paper_snapshot")}`,
    `- Valuation snapshot events: ${eventCount(events, "paper_valuation")}`,
    `- Simulator warning events: ${eventCount(events, "paper_simulator_warning")}`,
    `- Anomaly/reject/error events: ${anomalyRejectErrorCount}`,
    "",
    "Strategy Usage:",
    ...renderList(strategyUsage),
    "",
    "Pool Usage:",
    ...renderList(poolUsage),
    "",
    "Simulator Snapshot Quality:",
    `- Positions with simulator data: ${simulatorQuality.counts.withData}`,
    `- Data Complete: ${simulatorQuality.counts.dataComplete}`,
    `- Partial Data: ${simulatorQuality.counts.partialData}`,
    `- Low Confidence: ${simulatorQuality.counts.lowConfidence}`,
    `- Insufficient Data: ${simulatorQuality.counts.insufficientData}`,
    `- Needs review: ${simulatorQuality.counts.needsReview}`,
    "",
    "Data Source Distribution:",
    ...renderList([...simulatorQuality.sources.entries()]),
    "",
    "Confidence Distribution:",
    ...renderList([...simulatorQuality.confidence.entries()]),
    "",
    "Positions Needing Review:",
    ...(
      simulatorQuality.rows.filter((row) => row.needs_review).length
        ? simulatorQuality.rows.filter((row) => row.needs_review).map((row) => [
          label(row.paper_id),
          label(row.pool),
          label(row.strategy),
          label(row.primary_label),
          label(row.review_reasons.join(", "), "review"),
        ].join(" | "))
        : ["- none"]
    ),
    "",
    "Snapshot Completeness by Paper Position:",
    ...(
      simulatorQuality.rows.length
        ? simulatorQuality.rows.map((row) => [
          label(row.paper_id),
          label(row.pool),
          label(row.latest_ts),
          label(row.primary_label),
          `needs_review=${row.needs_review}`,
          `missing: ${label(row.missing.join(", "), "none")}`,
        ].join(" | "))
        : ["- none"]
    ),
    "",
    "Latest Simulator Warnings:",
    ...(
      simulatorQuality.warningEvents.length
        ? simulatorQuality.warningEvents.slice(0, 10).map((event) => [
          label(event.ts),
          label(event.paper_id, "no-paper-id"),
          label(event.pool_name || event.pool),
          label(event.simulator_warning?.severity, "unknown"),
          label(event.simulator_warning?.code, "unknown"),
          label(event.reason, "no-summary"),
        ].join(" | "))
        : ["- none"]
    ),
    "",
    "Open Paper Positions:",
  );

  if (!openPositions.length) {
    lines.push("- none");
  } else {
    for (const position of openPositions) {
      lines.push([
        label(position.paper_id),
        label(position.pool_name || position.pool),
        strategyLabel(position),
        label(position.amount_sol, "null"),
        label(position.created_at),
        label(position.last_event_id, "none"),
      ].join(" | "));
    }
  }

  lines.push("", "Latest Paper Events:");
  const recentEvents = latestEvents(events);
  if (!recentEvents.length) {
    lines.push("- none");
  } else {
    for (const event of recentEvents) {
      lines.push([
        label(event.ts),
        label(event.type),
        label(event.paper_id, "no-paper-id"),
        label(event.pool_name || event.pool),
        strategyLabel(event),
        label(event.summary || event.reason, "no-summary"),
      ].join(" | "));
    }
  }

  return `${lines.join("\n")}\n`;
}

process.stdout.write(renderReport());
