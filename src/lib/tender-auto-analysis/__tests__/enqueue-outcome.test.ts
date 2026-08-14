/**
 * Phase B — 入队结果规范化（消除 HTTP 200 + ok:false 静默失败）
 * 运行：npx tsx src/lib/tender-auto-analysis/__tests__/enqueue-outcome.test.ts
 */

import {
  ENQUEUE_OUTCOME_CODES,
  mapReasonToOutcome,
  normalizeEnqueueResult,
  normalizeReanalyzeResult,
} from "../enqueue-outcome";
import type {
  EnqueuePackageResult,
  ReanalyzePackageResult,
} from "../enqueue-package";

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

console.log("tender-auto-analysis enqueue-outcome");

// —— enqueue 成功语义 ——
{
  const r = normalizeEnqueueResult({
    enqueued: true,
    runId: "run_1",
    status: "PENDING",
    reason: "tender_domain",
    documentCount: 3,
    packageFingerprint: "fp",
  } as EnqueuePackageResult);
  ok(r.ok && r.httpStatus === 200 && r.code === "ENQUEUED", "enqueued=true → ENQUEUED/200/ok");
  ok(r.runId === "run_1" && r.documentCount === 3, "成功保留 runId/documentCount");
}

{
  const r = normalizeEnqueueResult({
    enqueued: false,
    runId: "run_existing",
    status: "ANALYZING",
    reason: "idempotent_reuse",
  } as EnqueuePackageResult);
  ok(
    r.ok && r.httpStatus === 200 && r.code === "IDEMPOTENT_REUSE",
    "idempotent_reuse → ok:true/200（复用非失败）",
  );
  ok(r.runId === "run_existing", "复用保留既有 runId");
}

// —— enqueue 各失败原因：均非 200 且 ok:false ——
const failCases: Array<{ reason: string; code: string; status: number }> = [
  { reason: "project_not_found", code: "PROJECT_NOT_FOUND", status: 404 },
  { reason: "missing_org", code: "MISSING_ORG", status: 422 },
  { reason: "gate_closed", code: "NOT_TENDER_PROJECT", status: 409 },
  { reason: "missing_content_hash", code: "MISSING_CONTENT_HASH", status: 409 },
  { reason: "no_package_documents", code: "NO_PACKAGE_DOCUMENTS", status: 422 },
  { reason: "PACKAGE_TOO_LARGE", code: "PACKAGE_TOO_LARGE", status: 413 },
];
for (const c of failCases) {
  const r = normalizeEnqueueResult({
    enqueued: false,
    reason: c.reason,
  } as EnqueuePackageResult);
  ok(
    r.ok === false && r.code === c.code && r.httpStatus === c.status,
    `enqueue 失败 ${c.reason} → ${c.code}/${c.status}/ok:false`,
  );
  ok(r.httpStatus !== 200, `enqueue 失败 ${c.reason} 绝不返回 200（无静默失败）`);
  ok(typeof r.message === "string" && r.message.length > 0, `${c.reason} 带人类可读 message`);
}

// gate_closed 附带 suggestion
{
  const r = normalizeEnqueueResult({
    enqueued: false,
    reason: "gate_closed",
    suggestion: "mark_as_tender",
  } as EnqueuePackageResult);
  ok(r.suggestion === "mark_as_tender", "gate_closed 带 mark_as_tender 建议");
}

// 未知 reason → UNKNOWN/400
{
  const r = normalizeEnqueueResult({
    enqueued: false,
    reason: "something_new",
  } as EnqueuePackageResult);
  ok(r.ok === false && r.code === "UNKNOWN" && r.httpStatus === 400, "未知 reason → UNKNOWN/400");
}

// auto_disabled（flag OFF 的后台触发）→ benign no-op：ok:true/200/AUTO_DISABLED
{
  const r = normalizeEnqueueResult({
    enqueued: false,
    reason: "auto_disabled",
  } as EnqueuePackageResult);
  ok(
    r.ok === true && r.code === "AUTO_DISABLED" && r.httpStatus === 200,
    "auto_disabled → AUTO_DISABLED/200/ok:true（非失败）",
  );
}

// Phase D not-ready reasons 经 enqueue 结果规范化（后台 auto 用）
{
  const r = normalizeEnqueueResult({
    enqueued: false,
    reason: "document_processing",
    documentCount: 5,
  } as EnqueuePackageResult);
  ok(
    r.ok === false && r.code === "DOCUMENT_PROCESSING" && r.httpStatus === 409,
    "document_processing → DOCUMENT_PROCESSING/409",
  );
}

// —— reanalyze ——
{
  const r = normalizeReanalyzeResult({
    ok: true,
    newRunId: "run_re",
    documentCount: 5,
    packageFingerprint: "fp2",
    status: "PENDING",
  } as ReanalyzePackageResult);
  ok(r.ok && r.httpStatus === 200 && r.code === "ENQUEUED" && r.runId === "run_re", "reanalyze 成功 → 200/ENQUEUED");
}

const reFail: Array<{ code: string; outCode: string; status: number }> = [
  { code: "rate_limited", outCode: "RATE_LIMITED", status: 429 },
  { code: "active_run", outCode: "ACTIVE_RUN_EXISTS", status: 409 },
  { code: "PACKAGE_TOO_LARGE", outCode: "PACKAGE_TOO_LARGE", status: 413 },
  { code: "not_found", outCode: "NOT_FOUND", status: 404 },
  { code: "invalid_status", outCode: "INVALID_STATUS", status: 422 },
  { code: "missing_content_hash", outCode: "MISSING_CONTENT_HASH", status: 409 },
];
for (const c of reFail) {
  const r = normalizeReanalyzeResult({
    ok: false,
    error: "内部错误原文",
    code: c.code,
  } as ReanalyzePackageResult);
  ok(
    r.ok === false && r.code === c.outCode && r.httpStatus === c.status,
    `reanalyze 失败 ${c.code} → ${c.outCode}/${c.status}`,
  );
  ok(r.httpStatus !== 200, `reanalyze 失败 ${c.code} 绝不返回 200`);
}

// reanalyze 保留后端已带的人类可读 error
{
  const r = normalizeReanalyzeResult({
    ok: false,
    error: "重新分析过于频繁，请稍后再试",
    code: "rate_limited",
  } as ReanalyzePackageResult);
  ok(r.message === "重新分析过于频繁，请稍后再试", "reanalyze 优先透传后端 error 文案");
}

// —— 码表自洽 ——
{
  ok(mapReasonToOutcome("").code === "UNKNOWN", "空 reason → UNKNOWN");
  ok(mapReasonToOutcome("GATE_CLOSED").code === "NOT_TENDER_PROJECT", "大小写不敏感归一化");
  const allCodesValid = ENQUEUE_OUTCOME_CODES.length === new Set(ENQUEUE_OUTCOME_CODES).size;
  ok(allCodesValid, "码枚举无重复");
}

console.log(`\nenqueue-outcome: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
