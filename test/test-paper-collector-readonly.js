import assert from "assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const collectorScript = path.join(repoRoot, "scripts", "paper-collector-readonly.js");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-paper-readonly-collector-test-"));
const defaultCollectorFile = path.join(os.tmpdir(), "meridian-paper-collector", "readonly-collector-snapshot.json");

const {
  SOURCE_ALLOWLIST,
  collectReadonlySnapshot,
  runCollector,
} = await import(pathToFileURL(collectorScript));

const runtimeFiles = [
  "paper-positions.json",
  "paper-events.jsonl",
  "strategy-library.json",
  "decision-log.json",
  "learning-summary.json",
  "collector-snapshot.json",
  "readonly-collector-snapshot.json",
];
const runtimeBaseline = new Map(runtimeFiles.map((filename) => {
  const fullPath = path.join(repoRoot, filename);
  if (!fs.existsSync(fullPath)) return [filename, null];
  const stat = fs.statSync(fullPath);
  return [filename, { size: stat.size, mtimeMs: stat.mtimeMs }];
}));

function assertRepoRuntimeUnchanged() {
  for (const filename of runtimeFiles) {
    const fullPath = path.join(repoRoot, filename);
    const before = runtimeBaseline.get(filename);
    const existsNow = fs.existsSync(fullPath);
    assert.equal(existsNow, before !== null, `${filename} repo-root existence changed`);
    if (before) {
      const after = fs.statSync(fullPath);
      assert.equal(after.size, before.size, `${filename} repo-root size changed`);
      assert.equal(after.mtimeMs, before.mtimeMs, `${filename} repo-root mtime changed`);
    }
  }
}

function outputCapture() {
  let text = "";
  return {
    stream: {
      write(value) {
        text += String(value);
      },
    },
    text() {
      return text;
    },
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function responseFromBody(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body);
    },
  };
}

function pair(overrides = {}) {
  return {
    chainId: "solana",
    dexId: "raydium",
    pairAddress: "REAL_PAIR_ADDRESS_SHOULD_NOT_RENDER",
    baseToken: {
      address: "REAL_BASE_ADDRESS_SHOULD_NOT_RENDER",
      name: "Solana",
      symbol: "SOL",
    },
    quoteToken: {
      address: "REAL_QUOTE_ADDRESS_SHOULD_NOT_RENDER",
      name: "USD Coin",
      symbol: "USDC",
    },
    priceUsd: "100",
    liquidity: { usd: 2000000 },
    volume: { h24: 250000 },
    ...overrides,
  };
}

const disabledOutputFile = path.join(tempDir, "disabled", "readonly-collector-snapshot.json");
let disabledFetchCalled = false;
const disabledStdout = outputCapture();
const disabledResult = await runCollector({
  env: {
    READONLY_COLLECTOR_SNAPSHOT_FILE: disabledOutputFile,
  },
  fetchImpl: async () => {
    disabledFetchCalled = true;
    throw new Error("fetch should not run while disabled");
  },
  stdout: disabledStdout.stream,
  stderr: outputCapture().stream,
});

assert.equal(disabledResult.status, "disabled");
assert.equal(disabledFetchCalled, false);
assert.equal(fs.existsSync(disabledOutputFile), false);
assert.match(disabledStdout.text(), /Disabled: set READ_ONLY_COLLECTOR_ENABLED=true/);

const explicitCollectorFile = path.join(tempDir, "explicit", "readonly-collector-snapshot.json");
const explicitStdout = outputCapture();
const explicitResult = await runCollector({
  env: {
    READ_ONLY_COLLECTOR_ENABLED: "true",
    READONLY_COLLECTOR_SNAPSHOT_FILE: explicitCollectorFile,
  },
  fetchImpl: async (url) => {
    assert.equal(url, `${SOURCE_ALLOWLIST.dexscreener_solana_tokens_v1.base_url}${SOURCE_ALLOWLIST.dexscreener_solana_tokens_v1.path}`);
    return responseFromBody([pair(), pair({
      dexId: "orca",
      baseToken: { symbol: "SOL" },
      quoteToken: { symbol: "USDT" },
      liquidity: {},
      volume: {},
    })]);
  },
  stdout: explicitStdout.stream,
  stderr: outputCapture().stream,
});

assert.equal(explicitResult.status, "ok");
assert.equal(fs.existsSync(explicitCollectorFile), true);
assert.match(explicitStdout.text(), /MERIDIAN READONLY PAPER COLLECTOR/);
assert.match(explicitStdout.text(), /Safety: public API read-only; no wallet\/RPC\/SDK\/transaction calls/);

const collector = readJson(explicitCollectorFile);
assert.equal(collector.collector_schema_version, "collector_readonly_v0.1");
assert.match(collector.generated_at, /^\d{4}-\d{2}-\d{2}T/);
assert.equal(collector.source_mode, "readonly");
assert.equal(collector.source_type, "public_api_readonly");
assert.equal(collector.source_label, "dexscreener_solana_tokens_v1");
assert.equal(collector.synthetic_or_real_source, "real");
assert.equal(collector.summary.snapshot_count, collector.snapshots.length);
assert.equal(collector.summary.warning_count, collector.warnings.length);
assert.equal(collector.safety.read_only, true);
assert.equal(collector.safety.public_source_only, true);
assert.equal(collector.safety.no_sensitive_material, true);
assert.equal(collector.safety.no_transactions, true);
assert.equal(collector.safety.local_output_only, true);
assert.equal(collector.safety.not_action_advice, true);
assert.equal(collector.snapshots.length, 2);
assert.ok(collector.warnings.length >= 1);

for (const snapshot of collector.snapshots) {
  for (const field of [
    "collector_schema_version",
    "collected_at",
    "source_type",
    "source_label",
    "confidence_level",
    "pool_identifier",
    "pool_name",
    "token_x_symbol",
    "token_y_symbol",
    "liquidity_signal",
    "volume_signal",
    "price_reference_label",
    "range_state",
    "data_quality_warnings",
    "raw_source_summary",
    "synthetic_or_real_source",
  ]) {
    assert.ok(Object.hasOwn(snapshot, field), `snapshot should include ${field}`);
  }
  assert.equal(snapshot.source_type, "public_api_readonly");
  assert.equal(snapshot.source_label, "dexscreener_solana_tokens_v1");
  assert.equal(snapshot.synthetic_or_real_source, "real");
  assert.equal(snapshot.range_state, "unknown");
  assert.ok(String(snapshot.pool_identifier).startsWith("dexscreener_solana_tokens_v1_pair_"));
}

const explicitSerialized = JSON.stringify(collector);
assert.equal(explicitSerialized.includes("REAL_PAIR_ADDRESS_SHOULD_NOT_RENDER"), false);
assert.equal(explicitSerialized.includes("REAL_BASE_ADDRESS_SHOULD_NOT_RENDER"), false);
assert.equal(explicitSerialized.includes("REAL_QUOTE_ADDRESS_SHOULD_NOT_RENDER"), false);

const forbiddenOutputText = [
  "PnL",
  "valuation",
  "APR",
  "ROI",
  "winrate",
  "profitability",
  "strategy score",
  "edge claim",
  "live readiness",
  "wallet balance",
  "transaction state",
  "quote-value totals",
  "trading recommendation",
  "deploy recommendation",
  "private key",
  "real wallet address",
  "transaction signature",
];
const lowerCollectorJson = explicitSerialized.toLowerCase();
for (const forbidden of forbiddenOutputText) {
  assert.equal(lowerCollectorJson.includes(forbidden.toLowerCase()), false, `collector output must not contain ${forbidden}`);
}

const defaultStdout = outputCapture();
const defaultResult = await runCollector({
  env: {
    READ_ONLY_COLLECTOR_ENABLED: "true",
  },
  fetchImpl: async () => responseFromBody([pair()]),
  stdout: defaultStdout.stream,
  stderr: outputCapture().stream,
});
assert.equal(defaultResult.status, "ok");
assert.equal(defaultResult.outputFile, path.resolve(defaultCollectorFile));
assert.ok(defaultResult.outputFile.startsWith(path.resolve(os.tmpdir())));
assert.equal(fs.existsSync(defaultResult.outputFile), true);
assert.notEqual(defaultResult.outputFile, path.join(repoRoot, "readonly-collector-snapshot.json"));

const malformed = await collectReadonlySnapshot({
  fetchImpl: async () => responseFromBody("not json"),
});
assert.equal(malformed.snapshots.length, 0);
assert.equal(malformed.warnings.length, 1);
assert.equal(malformed.warnings[0].code, "source_read_failed");

const largeResponse = await collectReadonlySnapshot({
  fetchImpl: async () => responseFromBody("x".repeat(250001)),
});
assert.equal(largeResponse.snapshots.length, 0);
assert.equal(largeResponse.warnings.length, 1);
assert.equal(largeResponse.warnings[0].code, "source_read_failed");

const timeoutSource = {
  ...SOURCE_ALLOWLIST.dexscreener_solana_tokens_v1,
  timeout_ms: 5,
};
let timeoutFetchCalled = false;
const timeoutResponse = await collectReadonlySnapshot({
  source: timeoutSource,
  fetchImpl: async (_url, options = {}) => {
    timeoutFetchCalled = true;
    return new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(new Error("mock readonly source timeout")));
    });
  },
});
assert.equal(timeoutFetchCalled, true);
assert.equal(timeoutResponse.snapshots.length, 0);
assert.equal(timeoutResponse.warnings.length, 1);
assert.equal(timeoutResponse.warnings[0].code, "source_read_failed");
assert.match(timeoutResponse.warnings[0].details.message, /timeout/);

const secretResponse = await collectReadonlySnapshot({
  fetchImpl: async () => {
    throw new Error("PRIVATE_KEY=SHOULD_NOT_RENDER");
  },
});
const secretSerialized = JSON.stringify(secretResponse);
assert.equal(secretSerialized.includes("SHOULD_NOT_RENDER"), false);
assert.match(secretSerialized, /\[REDACTED/);

assert.equal(Object.hasOwn(SOURCE_ALLOWLIST, "dexscreener_solana_tokens_v1"), true);
const allowlistedSource = SOURCE_ALLOWLIST.dexscreener_solana_tokens_v1;
assert.equal(allowlistedSource.base_url, "https://api.dexscreener.com");
assert.equal(allowlistedSource.path.startsWith("/tokens/v1/solana/"), true);
assert.equal(typeof allowlistedSource.timeout_ms, "number");
assert.equal(typeof allowlistedSource.max_response_bytes, "number");

const packageJson = readJson(path.join(repoRoot, "package.json"));
assert.equal(packageJson.scripts["paper:collect:readonly"], "node scripts/paper-collector-readonly.js");

const collectorSource = fs.readFileSync(collectorScript, "utf8");
for (const forbidden of [
  "tools/wallet",
  "tools/executor",
  "tools/dlmm",
  "agent.js",
  "config.js",
  "paper-trading.js",
  "paper-simulator-schema.js",
  "@solana/web3.js",
  "@meteora-ag/dlmm",
  "openai",
  "dotenv",
  "node-cron",
  "getWallet",
  "getConnection",
  "getDLMM",
  "getPool",
  "getActiveBin",
  "sendAndConfirmTransaction",
  "Jupiter",
  "RPC_URL",
  "WALLET_PRIVATE_KEY",
  "user-config.json",
  "logs/",
  "deploy",
  "claim",
  "close",
  "swap",
]) {
  assert.equal(collectorSource.includes(forbidden), false, `readonly collector must not reference ${forbidden}`);
}

assert.equal(collectorSource.includes("SOURCE_ALLOWLIST"), true);
assert.equal(collectorSource.includes("READONLY_COLLECTOR_URL"), false);
assert.equal(collectorSource.includes("COLLECTOR_SOURCE_URL"), false);
assert.equal(collectorSource.includes("process.argv[2]"), false);

assertRepoRuntimeUnchanged();

console.log("Paper readonly collector tests passed");
