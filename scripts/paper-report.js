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
]);

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
    `- Anomaly/reject/error events: ${anomalyRejectErrorCount}`,
    "",
    "Strategy Usage:",
    ...renderList(strategyUsage),
    "",
    "Pool Usage:",
    ...renderList(poolUsage),
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
