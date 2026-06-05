import fs from "fs";
import os from "os";
import path from "path";
import process from "process";

const DEFAULT_READONLY_COLLECTOR_FILE = path.join(
  os.tmpdir(),
  "meridian-paper-collector",
  "readonly-collector-snapshot.json",
);
const DEFAULT_MOCK_COLLECTOR_FILE = path.join(
  os.tmpdir(),
  "meridian-paper-collector",
  "collector-snapshot.json",
);
const DEFAULT_PAPER_EVENTS_FILE = path.join(
  os.tmpdir(),
  "meridian-paper-events",
  "paper-events.jsonl",
);

const SECRET_ENV_RE = /\b[A-Z0-9_]*(?:PRIVATE|SECRET|API|RPC)[A-Z0-9_]*=([^\s"',}]+)/gi;
const SENSITIVE_FIELD_PATTERN = /(private|secret|seed|mnemonic|wallet.*key|api.*key|apikey|bearer|authorization|auth|password|rpc)/i;

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function redactedString(value) {
  return String(value)
    .replace(SECRET_ENV_RE, (match) => `${match.split("=")[0]}=[REDACTED]`)
    .replace(/\[[\s\d,]{120,}\]/g, "[REDACTED_SECRET_ARRAY]")
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[REDACTED_TOKEN]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/gi, "Bearer [REDACTED]")
    .replace(/([?&](?:api[-_]?key|apikey|key)=)[^&\s]+/gi, "$1[REDACTED]")
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

function collectorInputPath(env = process.env) {
  const explicitCollectorFile = env.COLLECTOR_SNAPSHOT_FILE && path.resolve(env.COLLECTOR_SNAPSHOT_FILE);
  if (explicitCollectorFile) return explicitCollectorFile;

  const explicitReadonlyFile = env.READONLY_COLLECTOR_SNAPSHOT_FILE && path.resolve(env.READONLY_COLLECTOR_SNAPSHOT_FILE);
  if (explicitReadonlyFile) return explicitReadonlyFile;

  if (fs.existsSync(DEFAULT_READONLY_COLLECTOR_FILE)) return DEFAULT_READONLY_COLLECTOR_FILE;
  if (fs.existsSync(DEFAULT_MOCK_COLLECTOR_FILE)) return DEFAULT_MOCK_COLLECTOR_FILE;
  return null;
}

function paperEventsOutputPath(env = process.env) {
  return path.resolve(env.PAPER_EVENTS_FILE || DEFAULT_PAPER_EVENTS_FILE);
}

function readCollectorSnapshot(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { status: "missing", path: filePath || null, snapshot: null, error: null };
  }

  try {
    const snapshot = sanitize(JSON.parse(fs.readFileSync(filePath, "utf8")));
    return { status: "ok", path: filePath, snapshot, error: null };
  } catch (error) {
    return { status: "malformed", path: filePath, snapshot: null, error: sanitize(error.message) };
  }
}

function collectorSourceFor(snapshot = {}) {
  return sanitize({
    collector_schema_version: snapshot.collector_schema_version || null,
    generated_at: snapshot.generated_at || null,
    source_mode: snapshot.source_mode || null,
    source_type: snapshot.source_type || null,
    source_label: snapshot.source_label || null,
    synthetic_or_real_source: snapshot.synthetic_or_real_source || null,
  });
}

function collectorContextId(index, source = {}) {
  const sourceLabel = String(source.source_label || source.source_type || "collector").replace(/[^a-zA-Z0-9_]+/g, "_");
  return `collector_context_${sourceLabel}_${index + 1}`;
}

function validationFor(warnings = []) {
  return {
    valid: true,
    errors: [],
    warnings: Array.isArray(warnings) ? warnings.map((warning) => sanitize(warning)) : [],
  };
}

function snapshotEvent(snapshot, index, source) {
  const warnings = Array.isArray(snapshot?.data_quality_warnings) ? snapshot.data_quality_warnings : [];
  const rawSummary = snapshot?.raw_source_summary || "local collector ingestion";
  return sanitize({
    event_id: makeId("pevt_collector"),
    ts: snapshot?.collected_at || source.generated_at || nowIso(),
    type: "paper_collector_snapshot",
    paper_id: null,
    collector_context_id: collectorContextId(index, source),
    pool: snapshot?.pool_identifier || null,
    pool_name: snapshot?.pool_name || "unknown",
    summary: "Collector snapshot recorded from local collector file",
    reason: rawSummary,
    human_review_needed: true,
    validation: validationFor(warnings),
    collector_source: source,
    collector_snapshot: {
      confidence_level: snapshot?.confidence_level || "unknown",
      token_x_symbol: snapshot?.token_x_symbol || "unknown",
      token_y_symbol: snapshot?.token_y_symbol || "unknown",
      liquidity_signal: snapshot?.liquidity_signal || "unknown",
      volume_signal: snapshot?.volume_signal || "unknown",
      range_state: snapshot?.range_state || "unknown",
      data_quality_warnings: warnings,
    },
  });
}

function warningEvent(warning, index, source) {
  const summary = warning?.summary || warning?.code || "collector warning";
  return sanitize({
    event_id: makeId("pevt_collector"),
    ts: warning?.collected_at || source.generated_at || nowIso(),
    type: "paper_data_quality_warning",
    paper_id: null,
    collector_context_id: collectorContextId(index, source),
    pool: null,
    pool_name: "collector source",
    summary: "Collector data quality warning recorded from local collector file",
    reason: summary,
    human_review_needed: true,
    validation: {
      valid: true,
      errors: [],
      warnings: ["collector warning"],
    },
    collector_source: source,
    collector_warning: warning || {},
  });
}

function malformedCollectorWarning(error, sourcePath) {
  return sanitize({
    event_id: makeId("pevt_collector"),
    ts: nowIso(),
    type: "paper_data_quality_warning",
    paper_id: null,
    collector_context_id: "collector_context_malformed_input",
    pool: null,
    pool_name: "collector source",
    summary: "Collector data quality warning recorded from local collector file",
    reason: `malformed collector snapshot at ${sourcePath || "unknown path"}`,
    human_review_needed: true,
    validation: {
      valid: false,
      errors: [error || "collector snapshot could not be parsed"],
      warnings: ["collector warning"],
    },
    collector_source: {
      collector_schema_version: null,
      generated_at: null,
      source_mode: null,
      source_type: null,
      source_label: "malformed_collector_snapshot",
      synthetic_or_real_source: null,
    },
    collector_warning: {
      severity: "high",
      code: "malformed_collector_snapshot",
      details: {
        path: sourcePath || null,
        message: error || "collector snapshot could not be parsed",
      },
    },
  });
}

function eventsFromCollectorSnapshot(snapshot) {
  const source = collectorSourceFor(snapshot);
  const snapshots = Array.isArray(snapshot?.snapshots) ? snapshot.snapshots : [];
  const warnings = Array.isArray(snapshot?.warnings) ? snapshot.warnings : [];
  return [
    ...snapshots.map((item, index) => snapshotEvent(item, index, source)),
    ...warnings.map((item, index) => warningEvent(item, snapshots.length + index, source)),
  ];
}

function appendEvents(events, outputPath) {
  if (!events.length) return;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.appendFileSync(outputPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
}

function eventCounts(events) {
  return {
    collectorSnapshots: events.filter((event) => event.type === "paper_collector_snapshot").length,
    collectorWarnings: events.filter((event) => event.type === "paper_data_quality_warning").length,
    malformedWarnings: events.filter((event) => event.collector_warning?.code === "malformed_collector_snapshot").length,
  };
}

function runIngestCollector({ env = process.env, stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const inputPath = collectorInputPath(env);
    const outputPath = paperEventsOutputPath(env);
    const readResult = readCollectorSnapshot(inputPath);
    let events = [];

    if (readResult.status === "missing") {
      stdout.write([
        "MERIDIAN COLLECTOR INGEST",
        "Safety: local collector file ingestion only; no fetch/wallet/RPC/API/SDK calls",
        "",
        "No collector snapshot found. No paper events were written.",
        "",
      ].join("\n"));
      return { status: "missing", inputPath, outputPath, events };
    }

    if (readResult.status === "malformed") {
      events = [malformedCollectorWarning(readResult.error, readResult.path)];
    } else {
      events = eventsFromCollectorSnapshot(readResult.snapshot);
    }

    appendEvents(events, outputPath);
    const counts = eventCounts(events);
    stdout.write([
      "MERIDIAN COLLECTOR INGEST",
      "Safety: local collector file ingestion only; no fetch/wallet/RPC/API/SDK calls",
      "",
      `Collector snapshot input: ${readResult.path}`,
      `Paper events output: ${outputPath}`,
      `Collector snapshots: ${counts.collectorSnapshots}`,
      `Collector warnings: ${counts.collectorWarnings}`,
      `Malformed collector snapshot warnings: ${counts.malformedWarnings}`,
      "",
    ].join("\n"));
    return { status: "ok", inputPath: readResult.path, outputPath, events };
  } catch (error) {
    stderr.write(`${sanitize(error.message)}\n`);
    return { status: "error", inputPath: null, outputPath: null, events: [] };
  }
}

runIngestCollector();

export {
  appendEvents,
  collectorInputPath,
  collectorSourceFor,
  eventsFromCollectorSnapshot,
  malformedCollectorWarning,
  paperEventsOutputPath,
  readCollectorSnapshot,
  runIngestCollector,
  sanitize,
};
