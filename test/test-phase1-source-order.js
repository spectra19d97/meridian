import assert from "assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dlmmSource = fs.readFileSync(path.join(repoRoot, "tools", "dlmm.js"), "utf8");

function findMatchingBrace(source, openBraceIndex) {
  let depth = 0;
  for (let i = openBraceIndex; i < source.length; i++) {
    const char = source[i];
    if (char === "{") depth++;
    if (char === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const functionStart = dlmmSource.indexOf("export async function deployPosition");
assert.notEqual(functionStart, -1, "deployPosition export not found");

const signature = dlmmSource
  .slice(functionStart)
  .match(/^export async function deployPosition\s*\(\s*\{[\s\S]*?\}\s*\)\s*\{/);
assert.ok(signature, "deployPosition function signature not found");

const functionOpenBrace = functionStart + signature[0].length - 1;
assert.notEqual(functionOpenBrace, -1, "deployPosition opening brace not found");

const functionEnd = findMatchingBrace(dlmmSource, functionOpenBrace);
assert.notEqual(functionEnd, -1, "deployPosition closing brace not found");

const deployBody = dlmmSource.slice(functionOpenBrace + 1, functionEnd);
const dryRunToken = 'process.env.DRY_RUN === "true"';
const dryRunIndex = deployBody.indexOf(dryRunToken);
assert.notEqual(dryRunIndex, -1, "deployPosition must contain an early DRY_RUN=true branch");

const liveRiskTokens = [
  "getDLMM(",
  "getPool(",
  "getConnection(",
  "getWallet(",
  "getWalletBalances(",
  "getActiveBin(",
  "sendAndConfirmTransaction(",
];

const liveRiskHits = liveRiskTokens
  .map((token) => ({ token, index: deployBody.indexOf(token) }))
  .filter((hit) => hit.index !== -1)
  .sort((a, b) => a.index - b.index);

assert.ok(liveRiskHits.length > 0, "deployPosition source-order test must see at least one live-risk token");
const firstLiveRisk = liveRiskHits[0];

assert.ok(
  dryRunIndex < firstLiveRisk.index,
  `DRY_RUN branch must appear before first live-risk token ${firstLiveRisk.token}`,
);

const dryRunOpenBrace = deployBody.indexOf("{", dryRunIndex);
assert.notEqual(dryRunOpenBrace, -1, "DRY_RUN branch opening brace not found");

const dryRunCloseBrace = findMatchingBrace(deployBody, dryRunOpenBrace);
assert.notEqual(dryRunCloseBrace, -1, "DRY_RUN branch closing brace not found");
assert.ok(
  dryRunCloseBrace < firstLiveRisk.index,
  `DRY_RUN branch must close before first live-risk token ${firstLiveRisk.token}`,
);

const dryRunBranchBody = deployBody.slice(dryRunOpenBrace + 1, dryRunCloseBrace);
const createPaperIndex = dryRunBranchBody.indexOf("createPaperPosition(");
assert.notEqual(createPaperIndex, -1, "DRY_RUN branch must create a paper position");

const returnIndex = dryRunBranchBody.indexOf("return");
assert.notEqual(returnIndex, -1, "DRY_RUN branch must return before live-risk calls");
assert.ok(
  createPaperIndex < returnIndex,
  "DRY_RUN branch must create the paper position before returning",
);

for (const { token, index } of liveRiskHits) {
  assert.ok(
    dryRunCloseBrace < index,
    `live-risk token ${token} must appear only after the complete DRY_RUN branch`,
  );
}

console.log("Phase 1 source-order boundary tests passed");
