/**
 * FLOW-H1c 阶段记录自动前进 — 纯逻辑与接线测试
 * 运行：npx tsx src/lib/tender/__tests__/stage-auto.test.ts
 * 真实数据库里的行为另见 stage-auto-db.isolated.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isStageAutoAdvanceEnabledForOrgWithEnv } from "../stage-auto-flags";

let passed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  assert.equal(cond, true, detail === undefined ? name : `${name}\n${JSON.stringify(detail, null, 2)}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");

async function main() {
  // stage-auto.ts 引入 db（不连库也能加载纯函数）
  const { autoAdvanceSkipReason, stageMovesForward, AUTO_ADVANCE_AUDIT_ACTION } = await import("../stage-auto");

  console.log("开关");
  {
    const on = { TENDER_STAGE_AUTO_ADVANCE_ENABLED: "1" } as NodeJS.ProcessEnv;
    ok("没设：关", !isStageAutoAdvanceEnabledForOrgWithEnv("o1", {} as NodeJS.ProcessEnv));
    ok("设成 0 / false / 空：关", ["0", "false", "", "off"].every((v) => !isStageAutoAdvanceEnabledForOrgWithEnv("o1", { TENDER_STAGE_AUTO_ADVANCE_ENABLED: v } as NodeJS.ProcessEnv)));
    ok("设成 1 / true / on / yes：开", ["1", "true", "TRUE", " on ", "yes"].every((v) => isStageAutoAdvanceEnabledForOrgWithEnv("o1", { TENDER_STAGE_AUTO_ADVANCE_ENABLED: v } as NodeJS.ProcessEnv)));
    ok("开了但没有组织：关", !isStageAutoAdvanceEnabledForOrgWithEnv(null, on) && !isStageAutoAdvanceEnabledForOrgWithEnv("", on));
    const allow = { ...on, TENDER_STAGE_AUTO_ADVANCE_ORG_ALLOWLIST: "o2, o3" } as NodeJS.ProcessEnv;
    ok("白名单：只对名单里的组织开", isStageAutoAdvanceEnabledForOrgWithEnv("o3", allow) && !isStageAutoAdvanceEnabledForOrgWithEnv("o1", allow));
  }

  console.log("能不能前进");
  {
    const base = { workDomain: "tender", status: "active", tenderStatus: "supplier_inquiry", intakeStatus: "dispatched", supplierInquiredAt: new Date() };
    ok("进行中、没有结果、这一段还空着：可以", autoAdvanceSkipReason(base, "supplier_quote") === null);
    ok("已提交（还没结果）也可以写时间", autoAdvanceSkipReason({ ...base, tenderStatus: "bid_submitted", submittedAt: new Date() }, "supplier_quote") === null);
    ok("不是招投标项目：不", autoAdvanceSkipReason({ ...base, workDomain: "sales" }, "supplier_quote") === "not_tender" && autoAdvanceSkipReason({ ...base, workDomain: null }, "supplier_quote") === "not_tender");
    ok("已放弃 / 已归档：不", autoAdvanceSkipReason({ ...base, status: "abandoned" }, "supplier_quote") === "not_active" && autoAdvanceSkipReason({ ...base, status: "archived" }, "supplier_quote") === "not_active");
    ok("已有结果（已中标、未中标、不投标、已放弃投标、已取消，大小写不论）：不", ["won", "lost", "no_bid", "passed", "cancelled", "LOST"].every((t) => autoAdvanceSkipReason({ ...base, tenderStatus: t }, "supplier_quote") === "has_result"));
    ok("这一段已经有时间：不（不改写已有时间）", autoAdvanceSkipReason({ ...base, supplierQuotedAt: new Date() }, "supplier_quote") === "already_reached" && autoAdvanceSkipReason({ ...base, interpretedAt: new Date() }, "interpretation") === "already_reached");
    ok("招投标状态为空：可以", autoAdvanceSkipReason({ ...base, tenderStatus: null }, "interpretation") === null);
    ok("阶段变靠后才算前进", stageMovesForward("supplier_inquiry", "supplier_quote") && stageMovesForward("distribution", "interpretation") && !stageMovesForward("submission", "submission") && !stageMovesForward("supplier_quote", "supplier_inquiry"));
    ok("审计动作名独立，不是通用的「状态变更」", AUTO_ADVANCE_AUDIT_ACTION === "tender.stage.auto_advance");
  }

  console.log("共用函数");
  {
    const code = strip(read("src/lib/tender/stage-auto.ts"));
    ok("先看开关、再看能不能前进、再条件写入", (() => { const f = code.indexOf("if (!isStageAutoAdvanceEnabledForOrg(project.orgId))"); const s = code.indexOf("const skip = autoAdvanceSkipReason(project, stage);"); const w = code.indexOf("await db.project.updateMany("); return f > 0 && f < s && s < w; })());
    ok("条件写入：这一段为空、项目仍是进行中、招投标状态没变；只写这一段的时间", /where: \{ id: input\.projectId, \[field\]: null, status: "active", tenderStatus: project\.tenderStatus \},\s*data: \{ \[field\]: now \},/.test(code));
    ok("没写成就返回（第二次、并发、读之后状态变了）", code.includes('if (wrote.count === 0) return { written: false, reason: "lost_race" };'));
    ok("阶段记录变靠后才收建任务；负责人：触发的人，否则项目负责人", code.includes("const actorId = input.actorId ?? project.ownerId;") && /if \(advanced\) \{\s*await onStageAdvancedTasks\(input\.projectId, from, to, actorId\)\.catch/.test(code));
    ok("审计：独立动作名、前后阶段、触发；记录写入的字段", code.includes("action: AUTO_ADVANCE_AUDIT_ACTION,") && code.includes("beforeData: { stage: from },") && code.includes("afterData: { stage: to, field, trigger: input.trigger, advanced, actorKnown: input.actorId !== null },"));
    ok("不走人确认的推进：不调 advanceProjectStage，不改招投标状态，不发回调、讨论区消息、成员通知", !/advanceProjectStage|notifyProjectStatusChange|notifyProjectMembers|onStageAdvanced\(|emitProjectPatchEvents|projectMessage|notification/.test(code) && !/data: \{[^}]*tenderStatus/.test(code) && (code.match(/updateMany\(/g) ?? []).length === 1);
    ok("不调模型、不发请求、没有定时或队列", !/createCompletion|openai|anthropic|fetch\(|setTimeout|setInterval|cron|queue/i.test(code));
  }

  console.log("三处接线");
  {
    const svc = strip(read("src/lib/inquiry/service.ts"));
    const rq = svc.slice(svc.indexOf("export async function recordQuote("), svc.indexOf("// ── mark-declined"));
    ok("录入报价：第一次变成已报价时才触发，在更新之后、Muse 推送之前（跳过 Muse 推送的回信解析也会触发）", (() => { const upd = rq.indexOf("await db.inquiryItem.update("); const cond = rq.indexOf("if (current !== ITEM_STATUS.QUOTED) {\n    await import(\"@/lib/tender/stage-auto\")"); const muse = rq.indexOf("if (opts.skipMuseHook) return updated;"); return upd > 0 && upd < cond && cond < muse; })());
    ok("录入报价：触发「供应商报价」，触发的人取自调用方，不传为空；失败只记日志", rq.includes('m.recordStageReached({ projectId: scope.projectId, trigger: "quote_recorded", actorId: opts.actorId ?? null })') && rq.includes('.catch((err) => console.error("[StageAuto] quote_recorded failed:", err));') && rq.includes("opts: { skipMuseHook?: boolean; actorId?: string | null } = {},"));
    const route = read("src/app/api/projects/[id]/inquiries/[inquiryId]/items/[itemId]/record-quote/route.ts");
    ok("人工录入接口：先核对写权限，触发的人是登录用户", route.includes("{ actorId: access.user.id }") && route.indexOf("requireProjectWriteAccess(request, projectId)") < route.indexOf("recordQuote("));
    const inbound = read("src/lib/tender-rfq/inbound-sync.ts");
    ok("回信自动解析：照原样调录入报价，不传触发的人（记在项目负责人名下）", inbound.includes("await recordQuote(scope, input, { skipMuseHook: true });"));
    const exec = strip(read("src/lib/tender-rfq/execute.ts"));
    ok("询价发出：至少发出一家时、在原有写入之前触发「供应商询价」，触发的人是批准执行的人；原有写入保留", (() => { const sent = exec.indexOf("if (sent.length > 0) {"); const call = exec.indexOf('m.recordStageReached({ projectId: payload.projectId, trigger: "rfq_sent", actorId: ctx.userId })'); const old = exec.indexOf("await db.project.update({ where: { id: payload.projectId }, data: { supplierInquiredAt: new Date() } })"); return sent > 0 && sent < call && call < old; })() && exec.includes('.catch((err) => console.error("[StageAuto] rfq_sent failed:", err));'));
    const worker = strip(read("src/lib/tender-auto-analysis/worker.ts"));
    ok("分析收尾：在原有写入之前触发「项目解读」，触发的人是发起分析的人；原有写入保留", (() => { const call = worker.indexOf('m.recordStageReached({ projectId: run.projectId, trigger: "analysis_ready", actorId: run.createdById ?? null, now })'); const old = worker.indexOf("where: { id: run.projectId, interpretedAt: null },"); const fin = worker.indexOf("async function stepFinalize("); return fin > 0 && fin < call && call < old; })() && worker.includes('.catch((err) => console.error("[StageAuto] analysis_ready failed:", err));'));
  }

  console.log(`\n✓ stage-auto: ${passed} 项断言全部通过`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
