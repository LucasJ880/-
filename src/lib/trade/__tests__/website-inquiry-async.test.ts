/**
 * 网站询盘异步入站（PRD F3.1–F3.3）纯函数 / 契约测试，无 DB：
 *   - webhook 响应体（websiteWebhookBody）喂给站点桥接的判定逻辑副本：首个响应 delivered + 处理未完成，
 *     FDE 终态后的重发 → 处理完成；busy → partial
 *   - 时间常量耦合：认领过期 / 收据过期 > 路由 maxDuration；cron 先跑 FDE，FDE 截止 + 单个 FDE < 维护截止 < maxDuration
 *   - run_blocked 记账（纯函数）：不占 LLM 重试上限；非配额原因另计
 *   - 路由段配置是静态字面量；webhook 走 deferred、展会速记卡仍是 inline；状态接口只认 header 密钥；
 *     人工入口（录入询盘 / 手动重跑）经认领
 * 运行：npx tsx src/lib/trade/__tests__/website-inquiry-async.test.ts
 *
 * 公开仓库：只用虚构企业。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  FDE_CLAIM_STALE_MS,
  FDE_CRON_MAX_ATTEMPTS,
  FDE_RERUNNABLE,
  FDE_STALE_RUNNING_MS,
  runBlockedClaimPatch,
} from "@/lib/revenue-spine/fde/inbound-queue";
import {
  FDE_STALE_RUNNING_MS as REEXPORTED_STALE_MS,
  scheduleAfterResponse,
  websiteWebhookBody,
  type IngestResult,
} from "../website-inquiry";
import { RECEIPT_PROCESSING_STALE_MS } from "../website-inquiry-receipts";
import { classifyQingyanResponse, processingStateFrom } from "./fixtures/site-bridge-classify";

let pass = 0;
function ok(name: string, fn: () => void) {
  fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

// 与仓库其它静态契约测试一致：从仓库根目录运行（test-ci-unit.sh / test-all.sh 都先 cd 到根目录）
const ROOT = process.cwd();
const src = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const ROUTE_MAX_DURATION_MS = 300_000;

const spineOk = (replay: boolean): IngestResult["spine"] => ({
  ok: true,
  customerId: "cust_1",
  customerCreated: !replay,
  matchLevel: null,
  opportunityId: "opp_1",
  opportunityCreated: !replay,
  attachedToExisting: replay,
  interactionId: "int_1",
  salesActionId: "act_1",
  ownerUserId: "user_1",
  language: "en",
  customerReplied: false,
  replay,
});

const base: IngestResult = {
  prospectId: "pros_1",
  messageId: "msg_1",
  duplicate: false,
  notified: 2,
  replay: false,
  spine: spineOk(false),
  fde: null,
  fdeScheduled: true,
  recovered: false,
  recoveredSteps: [],
  fdeState: { status: "queued", terminal: false, reason: "FDE not finished (queued)", agentRunId: null, pendingActionId: null, salesActionId: "act_1" },
  eventId: "inq_example_textiles_1",
  receiptId: "rcpt_1",
  busy: false,
  conflict: false,
  contentDuplicateOf: null,
  complete: false,
};

console.log("website-inquiry async intake");

ok("首个 deferred 响应：HTTP 200 + ok + 主干 → 站点判 delivered；fde queued 非终态 → 处理 incomplete", () => {
  const body = websiteWebhookBody(base);
  assert.equal(body.ok, true);
  assert.equal(body.spine, "ok");
  assert.equal(body.opportunityId, "opp_1");
  assert.equal(body.complete, false);
  assert.deepEqual(body.fde && { status: body.fde.status, terminal: body.fde.terminal, scheduled: body.fde.scheduled }, { status: "queued", terminal: false, scheduled: true });
  const c = classifyQingyanResponse(200, JSON.parse(JSON.stringify(body)));
  assert.equal(c.status, "delivered");
  assert.equal(processingStateFrom(c.result), "incomplete");
});

ok("FDE 跑完后的重发：spine replay + complete + fde 终态 → 站点判 delivered 且处理 complete", () => {
  const body = websiteWebhookBody({
    ...base,
    replay: true,
    duplicate: true,
    spine: spineOk(true),
    fdeScheduled: false,
    complete: true,
    fdeState: { status: "completed", terminal: true, reason: "draft awaiting human approval", agentRunId: "run_1", pendingActionId: "pa_1", salesActionId: "act_1" },
  });
  assert.equal(body.spine, "replay");
  const c = classifyQingyanResponse(200, JSON.parse(JSON.stringify(body)));
  assert.equal(c.status, "delivered");
  assert.equal(processingStateFrom(c.result), "complete");
  assert.equal(c.result?.fde?.pendingActionId, "pa_1");
});

ok("FDE 运行中（已被认领）的重发：仍 delivered + incomplete（站点按退避继续跟进）", () => {
  const body = websiteWebhookBody({
    ...base,
    replay: true,
    spine: spineOk(true),
    fdeScheduled: false,
    fdeState: { status: "running", terminal: false, reason: "FDE currently running", agentRunId: "run_1", pendingActionId: null, salesActionId: "act_1" },
  });
  const c = classifyQingyanResponse(200, JSON.parse(JSON.stringify(body)));
  assert.equal(c.status, "delivered");
  assert.equal(processingStateFrom(c.result), "incomplete");
});

ok("busy（同一事件的请求路径仍在处理）→ 站点判 partial，不当失败", () => {
  const c = classifyQingyanResponse(200, JSON.parse(JSON.stringify(websiteWebhookBody({ ...base, busy: true, replay: true }))));
  assert.equal(c.status, "partial");
});

ok("主干失败（SPINE_FAILED，无 fdeState）→ fde 为 null，站点判 partial", () => {
  const body = websiteWebhookBody({ ...base, spine: { ok: false, code: "SPINE_FAILED", error: "boom" }, fdeState: null, fdeScheduled: false });
  assert.equal(body.fde, null);
  assert.equal(body.opportunityId, null);
  assert.equal(classifyQingyanResponse(200, JSON.parse(JSON.stringify(body))).status, "partial");
});

ok("inline 刚跑完但没有 fdeState 的兜底分支：terminal=false（不臆造终态）", () => {
  const body = websiteWebhookBody({
    ...base,
    fdeState: null,
    fdeScheduled: false,
    fde: { ok: true, agentRunId: "run_1", opportunityId: "opp_1", stage: "qualified", score: 70, grade: "HIGH", missing: [], questions: [], rfqId: null, assessmentId: null, draft: null, pendingActionId: "pa_1", approvalRequired: true },
  });
  assert.equal(body.fde?.terminal, false);
  assert.equal(body.fde?.status, "completed");
});

ok("时间常量：认领过期 = stale_running 判定，且两者与收据过期都大于路由 maxDuration 300 s", () => {
  assert.equal(FDE_CLAIM_STALE_MS, FDE_STALE_RUNNING_MS);
  assert.equal(REEXPORTED_STALE_MS, FDE_STALE_RUNNING_MS);
  assert.ok(FDE_CLAIM_STALE_MS > ROUTE_MAX_DURATION_MS);
  assert.ok(RECEIPT_PROCESSING_STALE_MS > ROUTE_MAX_DURATION_MS);
  assert.ok(FDE_CRON_MAX_ATTEMPTS >= 2);
});

ok("可重跑集合不含任何终态", () => {
  for (const s of ["queued", "failed", "run_blocked", "stale_running", "not_run"]) assert.ok(FDE_RERUNNABLE.has(s), s);
  for (const s of ["running", "completed", "cancelled", "already_sent", "human_rejected", "superseded", "action_closed"]) assert.ok(!FDE_RERUNNABLE.has(s), s);
});

ok("默认调度器就是 after()：请求上下文之外抛错（ingest 据此把 FDE 留给 cron / 重发）", () => {
  assert.throws(() => scheduleAfterResponse(async () => undefined), /outside a request scope/);
});

ok("路由段配置为静态字面量；webhook deferred、展会速记卡 inline", () => {
  const webhook = src("src/app/api/trade/webhook/website/route.ts");
  assert.match(webhook, /^export const maxDuration = 300;$/m);
  assert.match(webhook, /^export const runtime = "nodejs";$/m);
  assert.match(webhook, /fdeMode: "deferred"/);
  const booth = src("src/app/api/trade/booth-cards/ingest/route.ts");
  assert.match(booth, /^export const maxDuration = 300;$/m);
  assert.doesNotMatch(booth, /fdeMode/);
  const status = src("src/app/api/trade/webhook/website/status/route.ts");
  assert.match(status, /^export const runtime = "nodejs";$/m);
  assert.match(status, /^export const dynamic = "force-dynamic";$/m);
  assert.doesNotMatch(status, /^export const (?!runtime|dynamic|maxDuration)\w+/m);
});

ok("状态接口只认 header 密钥（不读 ?secret= / 请求体），不调用任何写路径", () => {
  const status = src("src/app/api/trade/webhook/website/status/route.ts");
  assert.match(status, /headers\.get\("x-qingyan-webhook-secret"\)/);
  assert.doesNotMatch(status, /searchParams\.get\("secret"\)/);
  assert.doesNotMatch(status, /request\.(json|formData)\(/);
  assert.doesNotMatch(status, /ingestWebsiteInquiry|claimInquiryReceipt|runQueuedInboundFde/);
});

ok("cron：maxDuration 300 字面量；FDE 先跑、按墙钟截止（不再按组织固定条数）；FDE 截止 + 单个 FDE（≈95 s）< 维护截止 < 300 s", () => {
  const cron = src("src/app/api/cron/revenue-spine/route.ts");
  assert.match(cron, /^export const maxDuration = 300;$/m);
  assert.doesNotMatch(cron, /MAX_FDE_PER_ORG/);
  assert.doesNotMatch(cron, /runInboundSalesFde\(/);
  const literal = (name: string) => {
    const m = cron.match(new RegExp(`^const ${name} = ([\\d_]+);$`, "m"));
    assert.ok(m, `${name} literal`);
    return Number(m[1].replace(/_/g, ""));
  };
  const fdeDeadline = literal("FDE_START_DEADLINE_MS");
  const maintenanceDeadline = literal("MAINTENANCE_DEADLINE_MS");
  // FDE 阶段在 next action / 无回复跟进之前：前几步再慢也不会把 FDE 兜底挤掉
  assert.ok(cron.indexOf("drainInboundFdeQueue({") < cron.indexOf("applyNextAction("), "FDE drain runs before next-action phase");
  assert.ok(fdeDeadline + 95_000 <= maintenanceDeadline - 30_000, `${fdeDeadline} + 95 s leaves maintenance time`);
  assert.ok(maintenanceDeadline <= ROUTE_MAX_DURATION_MS - 20_000, String(maintenanceDeadline));
  assert.match(cron, /pastMaintenanceDeadline\(\)/);
});

ok("run_blocked 记账：认领计数退回（没花 LLM）；配额原因不计 fdeBlockedAttempts，其它原因 +1；记下错误码", () => {
  const quota = runBlockedClaimPatch({ fdeAttempts: 3, fdeError: "配额限制：x" }, 3, { errorCode: "QUOTA", error: "配额限制：daily" });
  assert.deepEqual(quota, { fdeStatus: "run_blocked", fdeErrorCode: "QUOTA", fdeError: "配额限制：daily", fdeAttempts: 2 });
  const blocked = runBlockedClaimPatch({ fdeAttempts: 1, fdeBlockedAttempts: 1 }, 1, { errorCode: "RUN_CREATE_FAILED", error: "session failed" });
  assert.deepEqual(blocked, { fdeStatus: "run_blocked", fdeErrorCode: "RUN_CREATE_FAILED", fdeError: "session failed", fdeAttempts: 0, fdeBlockedAttempts: 2 });
  const legacy = runBlockedClaimPatch({ fdeBlockedAttempts: "x" }, 0, { errorCode: undefined, error: undefined });
  assert.equal(legacy.fdeAttempts, 0);
  assert.equal(legacy.fdeBlockedAttempts, 1);
  assert.equal(legacy.fdeErrorCode, "RUN_CREATE_FAILED");
});

ok("人工入口经认领：录入询盘不重跑已结束的 FDE；手动重跑带 salesActionId 时与自动执行互斥；cron 不直接调 FDE", () => {
  const inquiries = src("src/app/api/revenue/inquiries/route.ts");
  assert.match(inquiries, /runInboundFdeForHuman\(/);
  assert.match(inquiries, /rerunFinished: false/);
  assert.doesNotMatch(inquiries, /runInboundSalesFde\(/);
  const rerun = src("src/app/api/revenue/opportunities/[id]/run-fde/route.ts");
  assert.match(rerun, /runInboundFdeForHuman\(/);
  assert.match(rerun, /rerunFinished: true/);
  assert.doesNotMatch(rerun, /runInboundSalesFde\(/);
  assert.match(rerun, /^export const maxDuration = 120;$/m);
  assert.ok(FDE_CLAIM_STALE_MS > 120_000);
});

ok("/api/trade/webhook/* 在 middleware 公开路径里（状态接口无需登录态，鉴权在路由内）", () => {
  const mw = src("src/middleware.ts");
  assert.match(mw, /"\/api\/trade\/webhook",/);
});

console.log(`\nwebsite-inquiry async intake: ${pass} 通过`);
