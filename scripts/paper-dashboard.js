import fs from "fs";
import os from "os";
import path from "path";
import process from "process";

const POSITIONS_FILE = process.env.PAPER_POSITIONS_FILE || "./paper-positions.json";
const EVENTS_FILE = process.env.PAPER_EVENTS_FILE || "./paper-events.jsonl";
const DASHBOARD_FILE = process.env.DASHBOARD_FILE || path.join(os.tmpdir(), "meridian-paper-dashboard", "index.html");
const LEARNING_FILE = process.env.LEARNING_FILE || path.join(os.tmpdir(), "meridian-paper-learning", "learning-summary.json");

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
const SECRET_ENV_RE = /\b[A-Z0-9_]*(?:PRIVATE|SECRET|TOKEN|API|RPC)[A-Z0-9_]*=([^\s"',}]+)/gi;

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

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
    return { path: resolved, status: "ok", positions: rawPositions.map((position) => sanitize(position || {})), warning: null };
  } catch (error) {
    return { path: resolved, status: "parse_error", positions: [], warning: sanitize(error.message) };
  }
}

function readEvents(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    return { path: resolved, status: "missing", events: [], malformed: 0, warning: "missing" };
  }
  const events = [];
  let malformed = 0;
  for (const line of fs.readFileSync(resolved, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = sanitize(JSON.parse(line));
      events.push(EVENT_TYPES.has(event?.type) ? event : { ...event, type: event?.type || "unknown_event", _unknown_type: true });
    } catch {
      malformed += 1;
    }
  }
  return { path: resolved, status: "ok", events, malformed, warning: malformed ? `${malformed} malformed line(s)` : null };
}

function readLearningSummary(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    return { path: resolved, status: "missing", summary: {}, records: [], warning: "Learning summary: missing" };
  }
  try {
    const parsed = sanitize(JSON.parse(fs.readFileSync(resolved, "utf8")));
    const records = Array.isArray(parsed?.records) ? parsed.records.filter(isObject).map((record) => ({
      paper_id: record.paper_id || null,
      pool_name: record.pool_name || null,
      current_review_label: record.current_review_label || "Unknown",
      review_reasons: Array.isArray(record.review_reasons) ? record.review_reasons : [],
      learning_flags: Array.isArray(record.learning_flags) ? record.learning_flags : [],
      snapshot_count: record.snapshot_count ?? 0,
      warning_count: record.warning_count ?? 0,
      stale_count: record.stale_count ?? 0,
      low_confidence_count: record.low_confidence_count ?? 0,
      invalid_data_count: record.invalid_data_count ?? 0,
      out_of_range_observation_count: record.out_of_range_observation_count ?? 0,
      synthetic_fixture_detected: !!record.synthetic_fixture_detected,
      notes: Array.isArray(record.notes) ? record.notes : [],
    })) : [];
    return {
      path: resolved,
      status: "ok",
      summary: isObject(parsed?.summary) ? parsed.summary : {},
      records,
      warning: null,
    };
  } catch (error) {
    return { path: resolved, status: "parse_error", summary: {}, records: [], warning: `Learning file unreadable: ${sanitize(error.message)}` };
  }
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

function latestEvents(events, limit = 10) {
  return sortByTimestampDesc(events).slice(0, limit);
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
  if (!hasValue(price.token_x_per_token_y) && !hasValue(price.token_y_per_token_x)) missing.push("price estimate");
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

function qualityLabel(snapshot, hasSimulatorData) {
  if (!hasSimulatorData) return "Insufficient Data";
  if (snapshot?.confidence_level === "low" || !knownValue(snapshot?.confidence_level)) return "Low Confidence";
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
    const primaryLabel = qualityLabel(snapshot, hasSimulatorData);
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

  return {
    rows,
    counts: {
      withData: rows.filter((row) => row.has_simulator_data && positionById.has(row.paper_id)).length,
      dataComplete: rows.filter((row) => row.primary_label === "Data Complete").length,
      partialData: rows.filter((row) => row.primary_label === "Partial Data").length,
      lowConfidence: rows.filter((row) => row.primary_label === "Low Confidence").length,
      insufficientData: rows.filter((row) => row.primary_label === "Insufficient Data").length,
      needsReview: rows.filter((row) => row.needs_review).length,
    },
    sources,
    confidence,
    warningEvents,
  };
}

function syntheticFixtureDetected(positions, events) {
  return positions.some((position) => String(position.paper_id || "").includes("fixture") || String(position.pool_name || "").startsWith("SYNTH-")) ||
    events.some((event) => `${event.summary || ""} ${event.reason || ""}`.includes("synthetic fixture"));
}

function table(headers, rows) {
  if (!rows.length) return "<p class=\"empty\">none</p>";
  return `<table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function countCards(items) {
  return `<div class="cards">${items.map(([name, value]) => `<div class="card"><span>${escapeHtml(name)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}</div>`;
}

function listTable(entries) {
  return table(["Name", "Count"], entries.map(([name, count]) => [name, count]));
}

function learningLabelCounts(records) {
  const counts = new Map();
  for (const record of records) {
    increment(counts, record.current_review_label || "Unknown");
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function learningNeedsReview(record) {
  return record.current_review_label !== "Data Healthy" || record.review_reasons.length > 0;
}

function learningNoteRows(records, limit = 10) {
  const rows = [];
  for (const record of records) {
    for (const note of record.notes) {
      rows.push([
        label(record.paper_id, "no-paper-id"),
        label(record.pool_name),
        label(record.current_review_label),
        label(note, "no learning note"),
      ]);
    }
  }
  return rows.slice(0, limit);
}

function eventNote(event) {
  const note = label(event.summary || event.reason, "no local event note");
  return note.length > 120 ? `${note.slice(0, 117)}...` : note;
}

function renderDashboard() {
  const positionsResult = readPositions(POSITIONS_FILE);
  const eventsResult = readEvents(EVENTS_FILE);
  const learningResult = readLearningSummary(LEARNING_FILE);
  const positions = positionsResult.positions;
  const events = eventsResult.events;
  const learningRecords = learningResult.records;
  const openPositions = positions.filter((position) => position.status === "open");
  const closedPositions = positions.filter((position) => position.status === "closed");
  const strategyUsage = countBy(positions, strategyLabel);
  const poolUsage = countBy(positions, (position) => label(position.pool_name || position.pool));
  const quality = analyzeSimulatorQuality(positions, events);
  const fixtureDetected = syntheticFixtureDetected(positions, events) ||
    learningRecords.some((record) => record.synthetic_fixture_detected);

  const summaryCards = [
    ["Total positions", positions.length],
    ["Open positions", openPositions.length],
    ["Closed positions", closedPositions.length],
    ["Deploy events", eventCount(events, "paper_deploy")],
    ["Claim events", eventCount(events, "paper_claim")],
    ["Close events", eventCount(events, "paper_close")],
    ["Snapshot events", eventCount(events, "paper_snapshot")],
    ["Valuation records", eventCount(events, "paper_valuation")],
    ["Simulator warnings", eventCount(events, "paper_simulator_warning")],
    ["Anomaly/reject/error events", anomalyCount(events, eventsResult.malformed)],
  ];
  const qualityCards = [
    ["Data Complete", quality.counts.dataComplete],
    ["Partial Data", quality.counts.partialData],
    ["Low Confidence", quality.counts.lowConfidence],
    ["Insufficient Data", quality.counts.insufficientData],
    ["Needs Review", quality.counts.needsReview],
  ];
  const learningSummaryCards = [
    ["Learning status", learningResult.status],
    ["Learning records", learningRecords.length],
    ["Data Healthy", learningRecords.filter((record) => record.current_review_label === "Data Healthy").length],
    ["Needs Review", learningRecords.filter((record) => learningNeedsReview(record)).length],
    ["Warning Cluster", learningRecords.filter((record) => record.current_review_label === "Warning Cluster").length],
    ["Stale Data", learningRecords.filter((record) => record.current_review_label === "Stale Data").length],
    ["Low Confidence", learningRecords.filter((record) => record.current_review_label === "Low Confidence").length],
    ["Insufficient Data", learningRecords.filter((record) => record.current_review_label === "Insufficient Data").length],
  ];

  const reviewRows = quality.rows
    .filter((row) => row.needs_review)
    .map((row) => [row.paper_id, row.pool, row.strategy, row.primary_label, row.review_reasons.join(", ") || "review"]);
  const completenessRows = quality.rows.map((row) => [
    row.paper_id,
    row.pool,
    row.latest_ts,
    row.primary_label,
    row.needs_review ? "true" : "false",
    row.missing.length ? row.missing.join(", ") : "none",
  ]);
  const warningRows = quality.warningEvents.slice(0, 10).map((event) => [
    label(event.ts),
    label(event.paper_id, "no-paper-id"),
    label(event.pool_name || event.pool),
    label(event.simulator_warning?.severity, "unknown"),
    label(event.simulator_warning?.code, "unknown"),
    label(event.reason, "raw local event note missing"),
  ]);
  const openRows = openPositions.map((position) => [
    label(position.paper_id),
    label(position.pool_name || position.pool),
    strategyLabel(position),
    label(position.created_at),
    label(position.last_event_id, "none"),
  ]);
  const latestRows = latestEvents(events).map((event) => [
    label(event.ts),
    label(event.type),
    label(event.paper_id, "no-paper-id"),
    label(event.pool_name || event.pool),
    strategyLabel(event),
    `raw local event note: ${eventNote(event)}`,
  ]);
  const learningReviewRows = learningRecords
    .filter(learningNeedsReview)
    .map((record) => [
      label(record.paper_id, "no-paper-id"),
      label(record.pool_name),
      label(record.current_review_label),
      label(record.review_reasons.join(", "), "review"),
      label(record.learning_flags.join(", "), "none"),
    ]);
  const warningClusterRows = learningRecords
    .filter((record) => record.current_review_label === "Warning Cluster")
    .map((record) => [
      label(record.paper_id, "no-paper-id"),
      label(record.pool_name),
      label(record.warning_count, "0"),
      label(record.review_reasons.join(", "), "repeated warnings"),
    ]);
  const learningRecordRows = learningRecords.map((record) => [
    label(record.paper_id, "no-paper-id"),
    label(record.pool_name),
    label(record.current_review_label),
    label(record.review_reasons.join(", "), "none"),
    label(record.learning_flags.join(", "), "none"),
    label(record.snapshot_count, "0"),
    label(record.warning_count, "0"),
    label(record.stale_count, "0"),
    label(record.low_confidence_count, "0"),
    label(record.invalid_data_count, "0"),
    label(record.out_of_range_observation_count, "0"),
    record.synthetic_fixture_detected ? "true" : "false",
    label(record.notes.join(" | "), "none"),
  ]);
  const learningStatusText = learningResult.warning
    ? `<p>${escapeHtml(label(learningResult.warning))}</p>`
    : "<p>Local paper data only. Data-health view only. Not trading advice.</p>";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Meridian Paper Dashboard</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #f6f7f9; color: #17202a; }
    header, footer { background: #111827; color: #f9fafb; padding: 20px 28px; }
    main { padding: 24px 28px; }
    section { margin: 0 0 24px; background: #ffffff; border: 1px solid #dfe3ea; border-radius: 8px; padding: 18px; }
    h1, h2 { margin: 0 0 12px; }
    .banner { color: #d1d5db; margin-top: 8px; }
    .marker { display: inline-block; background: #fff7ed; border: 1px solid #fed7aa; color: #9a3412; padding: 8px 10px; border-radius: 6px; margin-top: 12px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
    .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; background: #fafafa; }
    .card span { display: block; color: #4b5563; font-size: 12px; }
    .card strong { display: block; margin-top: 6px; font-size: 22px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border-bottom: 1px solid #e5e7eb; text-align: left; padding: 8px; vertical-align: top; }
    th { background: #f3f4f6; color: #374151; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
    .empty { color: #6b7280; }
    code { word-break: break-all; }
  </style>
</head>
<body>
  <header>
    <h1>MERIDIAN PAPER / DRY-RUN DASHBOARD</h1>
    <div class="banner">Local paper files only. Data-quality view only. Not a trading interface.</div>
    ${fixtureDetected ? "<div class=\"marker\">Synthetic fixture data detected</div>" : ""}
  </header>
  <main>
    <section>
      <h2>Data Source Paths</h2>
      <p>Positions: <code>${escapeHtml(label(positionsResult.path))}</code> (${escapeHtml(positionsResult.status)})</p>
      <p>Events: <code>${escapeHtml(label(eventsResult.path))}</code> (${escapeHtml(eventsResult.status)})</p>
      <p>Learning: <code>${escapeHtml(label(learningResult.path))}</code> (${escapeHtml(learningResult.status)})</p>
      <p>Dashboard: <code>${escapeHtml(path.resolve(DASHBOARD_FILE))}</code></p>
      ${positionsResult.warning ? `<p>Positions warning: ${escapeHtml(label(positionsResult.warning))}</p>` : ""}
      ${eventsResult.warning ? `<p>Events warning: ${escapeHtml(label(eventsResult.warning))}</p>` : ""}
      ${learningResult.warning ? `<p>${escapeHtml(label(learningResult.warning))}</p>` : ""}
    </section>
    <section><h2>Summary</h2>${countCards(summaryCards)}</section>
    <section><h2>Simulator Snapshot Quality</h2>${countCards(qualityCards)}</section>
    <section><h2>Learning Summary</h2>${learningStatusText}${countCards(learningSummaryCards)}</section>
    <section><h2>Learning Labels</h2>${listTable(learningLabelCounts(learningRecords))}</section>
    <section>
      <h2>Learning Label Guide</h2>
      ${table(["Label", "Meaning"], [
        ["Data Healthy", "local data looks complete enough for review only"],
        ["Needs Review", "do not trust this paper record yet"],
        ["Warning Cluster", "repeated warnings were recorded"],
        ["Stale Data", "local snapshot is old"],
        ["Low Confidence", "source or confidence quality is weak"],
        ["Insufficient Data", "not enough local events exist yet"],
        ["Invalid Data", "local event data is malformed or invalid"],
        ["Out Of Range", "recorded range_state explicitly says out_of_range"],
      ])}
    </section>
    <section class="grid">
      <div><h2>Strategy Usage</h2>${listTable(strategyUsage)}</div>
      <div><h2>Pool Usage</h2>${listTable(poolUsage)}</div>
      <div><h2>Data Source Distribution</h2>${listTable([...quality.sources.entries()])}</div>
      <div><h2>Confidence Distribution</h2>${listTable([...quality.confidence.entries()])}</div>
    </section>
    <section><h2>Review Priority</h2>${table(["Paper ID", "Pool", "Label", "Reasons", "Flags"], learningReviewRows)}</section>
    <section><h2>Warning Clusters</h2>${table(["Paper ID", "Pool", "Warnings", "Reasons"], warningClusterRows)}</section>
    <section><h2>Latest Learning Notes</h2>${table(["Paper ID", "Pool", "Label", "Note"], learningNoteRows(learningRecords))}</section>
    <section><h2>Positions Needing Review</h2>${table(["Paper ID", "Pool", "Strategy", "Label", "Reasons"], reviewRows)}</section>
    <section><h2>Open Positions</h2>${table(["Paper ID", "Pool", "Strategy", "Created At", "Last Event"], openRows)}</section>
    <section><h2>Snapshot Completeness by Paper Position</h2>${table(["Paper ID", "Pool", "Latest Snapshot", "Label", "Needs Review", "Missing"], completenessRows)}</section>
    <section><h2>Latest Simulator Warnings</h2>${table(["Timestamp", "Paper ID", "Pool", "Severity", "Code", "Raw Local Event Note"], warningRows)}</section>
    <section><h2>Learning Records</h2>${table(["Paper ID", "Pool", "Label", "Reasons", "Flags", "Snapshots", "Warnings", "Stale", "Low Confidence", "Invalid", "Out Of Range", "Synthetic", "Notes"], learningRecordRows)}</section>
    <section><h2>Latest Paper Events</h2>${table(["Timestamp", "Type", "Paper ID", "Pool", "Strategy", "Raw Local Event Note"], latestRows)}</section>
  </main>
  <footer>Manual local dashboard. Rerun paper:dashboard to refresh. Do not use this as trading evidence.</footer>
</body>
</html>
`;
}

try {
  const html = renderDashboard();
  const outputPath = path.resolve(DASHBOARD_FILE);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, html);
  process.stdout.write([
    "MERIDIAN PAPER DASHBOARD",
    "Safety: static local file only; no wallet/RPC/API/SDK calls",
    "",
    `Dashboard: ${outputPath}`,
    "",
    "Open with:",
    `Start-Process "${outputPath}"`,
    "",
  ].join("\n"));
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
