/**
 * hash + 幂等键
 * 运行：npx tsx src/lib/tender-auto-analysis/__tests__/idempotency.test.ts
 */

import assert from "node:assert/strict";
import {
  fingerprintOrderedHashes,
  fingerprintSortedHashes,
  sha256Content,
} from "../hash";
import {
  buildIdempotencyKey,
  buildIdempotencyPlain,
} from "../idempotency";
import { ANALYSIS_VERSION, PROMPT_VERSION } from "../constants";

let pass = 0;
let fail = 0;

function ok(cond: boolean, name: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

console.log("tender-auto-analysis idempotency");

const h1 = sha256Content("hello");
const h2 = sha256Content("hello");
const h3 = sha256Content("world");
ok(h1 === h2, "相同内容相同 hash");
ok(h1 !== h3, "不同内容不同 hash");
ok(h1.length === 64, "sha256 hex 长度 64");

const fpA = fingerprintOrderedHashes(["aaa", "bbb"]);
const fpB = fingerprintOrderedHashes(["aaa", "bbb"]);
const fpC = fingerprintOrderedHashes(["bbb", "aaa"]);
ok(fpA === fpB, "有序指纹稳定");
ok(fpA !== fpC, "顺序变化改变指纹");

const sortedA = fingerprintSortedHashes(["bbb", "aaa"]);
const sortedB = fingerprintSortedHashes(["aaa", "bbb"]);
ok(sortedA === sortedB, "排序指纹与输入顺序无关");

const key1 = buildIdempotencyKey({
  projectId: "proj_1",
  fingerprint: fpA,
  promptVersion: PROMPT_VERSION,
  analysisVersion: ANALYSIS_VERSION,
});
const key2 = buildIdempotencyKey({
  projectId: "proj_1",
  fingerprint: fpA,
  promptVersion: PROMPT_VERSION,
  analysisVersion: ANALYSIS_VERSION,
});
const key3 = buildIdempotencyKey({
  projectId: "proj_2",
  fingerprint: fpA,
  promptVersion: PROMPT_VERSION,
  analysisVersion: ANALYSIS_VERSION,
});
const key4 = buildIdempotencyKey({
  projectId: "proj_1",
  fingerprint: fpC,
  promptVersion: PROMPT_VERSION,
  analysisVersion: ANALYSIS_VERSION,
});
const key5 = buildIdempotencyKey({
  projectId: "proj_1",
  fingerprint: fpA,
  promptVersion: "other-prompt",
  analysisVersion: ANALYSIS_VERSION,
});

ok(key1 === key2, "相同输入幂等键相同");
ok(key1 !== key3, "不同 projectId 不同键");
ok(key1 !== key4, "不同 fingerprint 不同键");
ok(key1 !== key5, "不同 promptVersion 不同键");
ok(key1.length === 64, "幂等键为 sha256 hex");

const plain = buildIdempotencyPlain({
  projectId: "proj_1",
  fingerprint: fpA,
  promptVersion: PROMPT_VERSION,
  analysisVersion: ANALYSIS_VERSION,
});
ok(plain.includes("proj_1"), "明文含 projectId");
ok(plain.includes(PROMPT_VERSION), "明文含 promptVersion");
ok(plain.startsWith("tender-analysis:"), "明文前缀");

assert.equal(typeof key1, "string");

console.log(`\nidempotency: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
