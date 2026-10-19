/**
 * QINGYAN_ASSISTANT_DURABLE_FOLLOWUP_M1 — 纯逻辑回归（无 DB / 无模型 / 无网络）
 * 运行：npx tsx src/lib/assistant/__tests__/durable-followup-pure.test.ts
 *
 * 覆盖：T01（开关关闭语义）/ T02（复合目标不截断）/ T12（缺信息只问不猜）/
 * T14（无业务回执不算完成）/ T13（部分完成）/ T16（开关不可裸开）/ T17（超出边界显式列出）
 */

import assert from "node:assert/strict";
import { routeAssistantIntent } from "@/lib/assistant/intent-router";
import {
  buildFollowupContinuationPlan,
  buildFollowupServerPlan,
  followupAcceptanceText,
  isFollowupBatchGoal,
  parseExplicitReminderTime,
  parseFollowupContinuationAnswer,
  parseFollowupGoal,
  parseSmallNumber,
  zonedWallTimeToUtc,
} from "@/lib/assistant/followup-goal";
import {
  FOLLOWUP_META,
  FOLLOWUP_STEP,
  FOLLOWUP_TASK_CONTRACT,
  FOLLOWUP_TOOL,
  readFollowupRunContext,
} from "@/lib/assistant/followup-contract";
import { isAssistantDurableFollowupEnabledWithEnv } from "@/lib/assistant/followup-flags";
import {
  projectFollowupOutcome,
  type FollowupOutcomeInput,
} from "@/lib/assistant/followup-outcome";
import { compileServerAuthoredPlan } from "@/lib/workforce-runtime/plan-compile";
import {
  getRuntimeV2Tool,
  plannerVisibleRuntimeV2Tools,
} from "@/lib/agent-runtime-v2/tool-catalog";
import { isRuntimeV2ToolExecutable } from "@/lib/agent-runtime-v2/adapters";
import { getRuntimeV2Limits } from "@/lib/agent-runtime-v2/flags";
import { resolveExecutionPolicyTool } from "@/lib/workforce-runtime/execution-descriptor";
import { prioritizeFollowups } from "@/lib/agent-runtime-v2/prioritize";
import { mergeAssistantRunUpdate } from "@/lib/assistant/run-status-types";
import type { AssistantRunStatusDto } from "@/lib/assistant/run-status-types";

let passed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (!cond) {
    console.error(`  ✗ ${name}`, detail ?? "");
  }
  assert.equal(cond, true, name);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const GOAL =
  "找出 Sunny 当前最需要跟进的三个客户，汇总相关报价风险，准备跟进邮件草稿，并为我确认的客户建立提醒。";
// 固定时钟：2026-10-16 10:00 America/Toronto（EDT，UTC-4）
const NOW = new Date("2026-10-16T14:00:00.000Z");
const TZ = "America/Toronto";

function planTools(names: string[]) {
  return names.map((n) => {
    const d = getRuntimeV2Tool(n);
    if (!d) throw new Error(`missing descriptor ${n}`);
    return d;
  });
}

function main() {
  console.log("durable-followup-pure");

  // ── T02 基线复现：既有窄路由把复合目标截断为单一场景 ──
  const legacy = routeAssistantIntent(GOAL);
  ok(
    "T02-baseline: 既有意图路由只返回单一场景（gmail_email_draft），提醒/分析被截断",
    legacy.intent === "gmail_email_draft",
    legacy,
  );

  // ── T02 复合目标完整识别 ──
  ok("T02: 目标被识别为批量客户跟进", isFollowupBatchGoal(GOAL));
  const spec = parseFollowupGoal(GOAL, { now: NOW, orgTimezone: TZ })!;
  ok("T02: 解析出交付项（分析+邮件草稿+提醒）", !!spec &&
    spec.deliverables.join(",") === "analysis,email_drafts,reminders", spec);
  ok("T02: topN=3（三个客户）", spec.topN === 3 && spec.requestedTopN === 3);
  ok("T02: 报价风险被识别", spec.quoteRiskRequested === true);
  ok("T02: 没有直接发送请求", spec.emailSendRequested === false && spec.unsupported.length === 0);
  ok(
    "T12: 未给提醒时间 → missing reminder_time（绝不默认下周五）",
    spec.reminder.status === "missing" &&
      spec.reminder.missing.join(",") === "reminder_time",
    spec.reminder,
  );
  const specNoTz = parseFollowupGoal(GOAL, { now: NOW, orgTimezone: null })!;
  ok(
    "T12: 无可信时区 → 同时追问时区（一次合并询问）",
    specNoTz.reminder.status === "missing" &&
      specNoTz.reminder.missing.join(",") === "reminder_time,timezone",
  );

  // ── 非本场景保持既有行为 ──
  ok("T01: 普通问题不是批量跟进", parseFollowupGoal("帮我解释一下报价单怎么算", { now: NOW, orgTimezone: TZ }) === null);
  ok("T01: 单个具名客户提醒仍走既有场景", parseFollowupGoal("周五提醒我跟进 ABC", { now: NOW, orgTimezone: TZ }) === null);
  ok("T01: 单客户邮件草稿仍走既有场景", parseFollowupGoal("帮我给 ABC 写一封跟进邮件草稿", { now: NOW, orgTimezone: TZ }) === null);

  // ── 只要求部分成果 ──
  const analysisOnly = parseFollowupGoal("只分析一下最需要跟进的客户，先不要邮件和提醒", { now: NOW, orgTimezone: TZ })!;
  ok("只分析：不准备邮件/提醒", analysisOnly.deliverables.join(",") === "analysis", analysisOnly);
  const draftsOnly = parseFollowupGoal("找出最需要跟进的 2 个客户并准备跟进邮件草稿，不要建提醒", { now: NOW, orgTimezone: TZ })!;
  ok("只要草稿：不加提醒", draftsOnly.deliverables.join(",") === "analysis,email_drafts" && draftsOnly.topN === 2, draftsOnly);
  const five = parseFollowupGoal("列出前5个最需要跟进的客户", { now: NOW, orgTimezone: TZ })!;
  ok("要求 5 个 → 本轮上限 3，且记录原始要求", five.topN === 3 && five.requestedTopN === 5);

  // ── T17 超出边界：显式列出、不执行、不默默省略 ──
  const send = parseFollowupGoal("找出最需要跟进的三个客户，直接发送跟进邮件给他们", { now: NOW, orgTimezone: TZ })!;
  ok("T17: 发送邮件 → 只准备草稿，并列入未执行", send.deliverables.includes("email_drafts") && send.emailSendRequested && send.unsupported.includes("send_email"), send);
  const order = parseFollowupGoal("找出最需要跟进的客户，然后自动下单并付款", { now: NOW, orgTimezone: TZ })!;
  ok("T17: 自动下单/付款 → 列入未执行", order.unsupported.includes("auto_order") && order.unsupported.includes("payment"), order);
  const sendPlan = buildFollowupServerPlan(send, { includeAttachmentEvidence: false, emailDraftsAvailable: true, remindersAvailable: true });
  ok("T17: 计划中不存在任何发送/下单工具", sendPlan.tools.every((t) => !/send|order|pay/i.test(t)), sendPlan.tools);
  const sendText = followupAcceptanceText({ runId: "r1", spec: send, preparedDeliverables: sendPlan.preparedDeliverables, emailUnavailableReason: null, remindersUnavailableReason: null, attachmentCount: 0 });
  ok("T17: 受理回执明确写出不会发送", sendText.includes("不会执行：直接发送邮件"));

  // ── 时间解析：只接受用户明确输入 ──
  const t1 = parseExplicitReminderTime("10月20日下午3点", { now: NOW, orgTimezone: TZ });
  ok("时间：10月20日下午3点（组织时区）→ 2026-10-20T19:00Z", t1.kind === "ok" && t1.startAt === "2026-10-20T19:00:00.000Z" && t1.timezoneSource === "org_profile", t1);
  const t2 = parseExplicitReminderTime("明天上午10:30 北京时间", { now: NOW, orgTimezone: TZ });
  ok("时间：明天上午10:30 北京时间 → 用户明确时区", t2.kind === "ok" && t2.timezone === "Asia/Shanghai" && t2.timezoneSource === "user_explicit" && t2.startAt === "2026-10-17T02:30:00.000Z", t2);
  const t3 = parseExplicitReminderTime("下周一", { now: NOW, orgTimezone: TZ });
  ok("时间：只有日期 → incomplete（不补钟点）", t3.kind === "incomplete" && t3.missing.includes("reminder_time"), t3);
  const t4 = parseExplicitReminderTime("下午3点", { now: NOW, orgTimezone: TZ });
  ok("时间：只有钟点 → incomplete（不补日期）", t4.kind === "incomplete", t4);
  const t5 = parseExplicitReminderTime("10月1日下午3点", { now: NOW, orgTimezone: TZ });
  ok("时间：未写年份且今年已过 → 取明年", t5.kind === "ok" && t5.startAt.startsWith("2027-10-01"), t5);
  const t6 = parseExplicitReminderTime("今天上午9点", { now: NOW, orgTimezone: TZ });
  ok("时间：已经过去 → incomplete", t6.kind === "incomplete" && /过去/.test(t6.reason), t6);
  const t7 = parseExplicitReminderTime("2026-10-21 15:00", { now: NOW, orgTimezone: null });
  ok("时间：无可信时区 → incomplete(timezone)", t7.kind === "incomplete" && t7.missing.join(",") === "timezone", t7);
  const t8 = parseExplicitReminderTime("下周五下午3点", { now: NOW, orgTimezone: TZ });
  ok("时间：用户明说下周五 → 2026-10-23（今天周五，下周五=+7）", t8.kind === "ok" && t8.local === "2026-10-23 15:00", t8);
  const dst = zonedWallTimeToUtc(2026, 11, 2, 15, 0, TZ);
  ok("时区：DST 结束后 America/Toronto 为 UTC-5", dst.toISOString() === "2026-11-02T20:00:00.000Z", dst.toISOString());
  ok("中文数字", parseSmallNumber("三") === 3 && parseSmallNumber("十二") === 12 && parseSmallNumber("二十") === 20);

  const scheduled = parseFollowupGoal(`${GOAL}提醒时间定在10月20日下午3点`, { now: NOW, orgTimezone: TZ })!;
  ok("复合目标 + 明确时间 → scheduled", scheduled.reminder.status === "scheduled", scheduled.reminder);

  // ── 续接回答 ──
  const parentCustomers = [
    { customerId: "c_a", customerName: "Alpha Homes" },
    { customerId: "c_b", customerName: "Beta Design" },
  ];
  const ans = parseFollowupContinuationAnswer("给 Alpha Homes 建提醒，10月21日上午9点", { now: NOW, orgTimezone: TZ, parentCustomers });
  ok("T12: 续接回答 → 时间 + 点名客户", ans.kind === "reminder_time" && ans.targetCustomerIds.join(",") === "c_a", ans);
  const ansAll = parseFollowupContinuationAnswer("周一上午10点", { now: NOW, orgTimezone: TZ, parentCustomers });
  ok("T12: 只给时间 → 父任务全部客户", ansAll.kind === "reminder_time" && ansAll.targetCustomerIds.length === 0, ansAll);
  ok("T12: 只给日期 → still_incomplete", parseFollowupContinuationAnswer("周一", { now: NOW, orgTimezone: TZ, parentCustomers }).kind === "still_incomplete");
  ok("T06: 新的完整目标不当作续接回答", parseFollowupContinuationAnswer(GOAL, { now: NOW, orgTimezone: TZ, parentCustomers }).kind === "not_an_answer");
  ok("闲聊不当作续接回答", parseFollowupContinuationAnswer("谢谢", { now: NOW, orgTimezone: TZ, parentCustomers }).kind === "not_an_answer");

  // ── 计划：按要求选择步骤，穿过共享编译链 ──
  const maxSteps = getRuntimeV2Limits().maxSteps;
  const full = buildFollowupServerPlan(scheduled, { includeAttachmentEvidence: true, emailDraftsAvailable: true, remindersAvailable: true });
  const compiledFull = compileServerAuthoredPlan({ plan: full.plan, tools: planTools(full.tools), maxSteps });
  ok("计划（附件+草稿+提醒）通过共享编译链", compiledFull.ok, compiledFull);
  if (compiledFull.ok) {
    const steps = compiledFull.compiled.plan.steps;
    ok("编译后每一步都保留了工具（无 ghost / 被剥离工具）", steps.every((s) => !!s.preferredTool), steps.map((s) => s.preferredTool));
    ok("写步骤唯一且需审批", steps.filter((s) => s.requiresApproval).map((s) => s.id).join(",") === FOLLOWUP_STEP.prepareActions);
    ok("T03: 附件证据步骤进入排序依赖", steps.find((s) => s.id === FOLLOWUP_STEP.prioritize)!.dependsOn.includes(FOLLOWUP_STEP.attachmentEvidence));
  }
  const onlyAnalysisPlan = buildFollowupServerPlan(analysisOnly, { includeAttachmentEvidence: false, emailDraftsAvailable: true, remindersAvailable: true });
  ok("只分析：计划不含任何写步骤", onlyAnalysisPlan.plan.tasks.every((t) => !t.requiresApproval) && onlyAnalysisPlan.preparedDeliverables.length === 0);
  const missingTimePlan = buildFollowupServerPlan(spec, { includeAttachmentEvidence: false, emailDraftsAvailable: true, remindersAvailable: true });
  ok("T12: 缺提醒时间 → 计划只准备草稿，不准备提醒", missingTimePlan.preparedDeliverables.join(",") === "email_drafts");
  const gmailOff = buildFollowupServerPlan(spec, { includeAttachmentEvidence: false, emailDraftsAvailable: false, remindersAvailable: true });
  ok("Gmail 不可用 → 不规划草稿步骤（不规划必然失败的工具）", gmailOff.preparedDeliverables.length === 0);
  const contPlan = buildFollowupContinuationPlan();
  const compiledCont = compileServerAuthoredPlan({ plan: contPlan.plan, tools: planTools(contPlan.tools), maxSteps });
  ok("续接计划通过共享编译链（只两步，不重复分析）", compiledCont.ok && compiledCont.compiled.plan.steps.length === 2, compiledCont);
  const tooMany = buildFollowupServerPlan(scheduled, { includeAttachmentEvidence: true, emailDraftsAvailable: true, remindersAvailable: true });
  tooMany.plan.tasks.push({ ...tooMany.plan.tasks[0], id: "x1" }, { ...tooMany.plan.tasks[0], id: "x2" });
  const rejected = compileServerAuthoredPlan({ plan: tooMany.plan, tools: planTools(tooMany.tools), maxSteps: 7 });
  ok("超出步数的计划被拒绝（不静默截断）", !rejected.ok);

  // ── 工具面：新工具只供服务端计划，Planner 看不到 ──
  const visible = plannerVisibleRuntimeV2Tools().map((t) => t.name);
  for (const name of [FOLLOWUP_TOOL.attachmentEvidence, FOLLOWUP_TOOL.carryTargets, FOLLOWUP_TOOL.prepareActions]) {
    ok(`工具 ${name}：有真实 handler`, isRuntimeV2ToolExecutable(name));
    ok(`工具 ${name}：有执行策略 descriptor`, resolveExecutionPolicyTool(name).ok);
    ok(`工具 ${name}：LLM Planner 不可见`, !visible.includes(name));
  }
  const prep = resolveExecutionPolicyTool(FOLLOWUP_TOOL.prepareActions);
  ok("准备动作工具风险=l2_soft（需审批）", prep.ok && prep.risk === "l2_soft");
  ok("既有 Planner 可见面不变（仍含 sales_prioritize_followups）", visible.includes("sales_prioritize_followups"));

  // ── 附件焦点：只加权，不替换证据 ──
  const ranked = prioritizeFollowups({
    opportunities: [
      { id: "o1", customerId: "c1", customerName: "One", stage: "quoted" },
      { id: "o2", customerId: "c2", customerName: "Two", stage: "quoted" },
    ],
    followupAnalysis: { grader: "customer_followup", result: { issues: [] } },
    quoteRiskAnalysis: { grader: "quote_risk", result: { issues: [] } },
    now: NOW,
    focus: { customerIds: ["c2"], ref: "ai_message:m1#attachment:0" },
  });
  ok("T03: 附件提及的客户获得可解释加权与引用", ranked.prioritized[0].customerId === "c2" &&
    ranked.prioritized[0].evidenceRefs.includes("ai_message:m1#attachment:0") &&
    ranked.prioritized[0].reasons.some((r) => r.includes("资料中提及")), ranked.prioritized[0]);

  // ── metadata 契约 ──
  ok("非本契约 metadata → null", readFollowupRunContext({ runtimeVersion: "v2" }) === null);
  const ctx = readFollowupRunContext({
    [FOLLOWUP_META.contract]: FOLLOWUP_TASK_CONTRACT,
    [FOLLOWUP_META.topN]: 9,
    [FOLLOWUP_META.deliverables]: "analysis,reminders,bogus",
    [FOLLOWUP_META.missing]: "reminder_time",
    [FOLLOWUP_META.targetCustomerIds]: "c1,c2,../x",
  })!;
  ok("metadata 解析：topN 上限 3、未知值丢弃", ctx.topN === 3 && ctx.deliverables.join(",") === "analysis,reminders" && ctx.targetCustomerIds.join(",") === "c1,c2");

  // ── T16 开关：默认关闭、禁止裸开 ──
  const flagIn = { userId: "u1", orgId: "o1", role: "sales" };
  ok("T16: 未配置 → 关", !isAssistantDurableFollowupEnabledWithEnv(flagIn, {}));
  ok("T16: 只开总开关（无白名单）→ 关", !isAssistantDurableFollowupEnabledWithEnv(flagIn, { ASSISTANT_DURABLE_FOLLOWUP_ENABLED: "1" }));
  ok("T16: org 不在白名单 → 关", !isAssistantDurableFollowupEnabledWithEnv(flagIn, { ASSISTANT_DURABLE_FOLLOWUP_ENABLED: "1", ASSISTANT_DURABLE_FOLLOWUP_ORG_ALLOWLIST: "o2" }));
  ok("T16: 命中白名单 → 开", isAssistantDurableFollowupEnabledWithEnv(flagIn, { ASSISTANT_DURABLE_FOLLOWUP_ENABLED: "1", ASSISTANT_DURABLE_FOLLOWUP_ORG_ALLOWLIST: "o1" }));

  // ── 成果投影（T13 / T14） ──
  const meta = {
    [FOLLOWUP_META.contract]: FOLLOWUP_TASK_CONTRACT,
    [FOLLOWUP_META.topN]: 3,
    [FOLLOWUP_META.deliverables]: "analysis,email_drafts,reminders",
    [FOLLOWUP_META.reminderAt]: "2026-10-20T19:00:00.000Z",
    [FOLLOWUP_META.reminderTimezone]: TZ,
    initiatedByUserId: "u1",
    threadId: "t1",
  };
  const analysisSteps: FollowupOutcomeInput["steps"] = [
    { stepKey: FOLLOWUP_STEP.opportunities, preferredTool: FOLLOWUP_TOOL.opportunities, status: "completed", outputJson: { opportunities: [{}, {}] }, errorMessage: null },
    { stepKey: FOLLOWUP_STEP.followupAnalysis, preferredTool: FOLLOWUP_TOOL.followupAnalysis, status: "completed", outputJson: { grader: "customer_followup", evidenceQuality: "FULL" }, errorMessage: null },
    { stepKey: FOLLOWUP_STEP.quoteRisk, preferredTool: FOLLOWUP_TOOL.quoteRisk, status: "completed", outputJson: { grader: "quote_risk", evidenceQuality: "FULL", result: { summary: "2 份报价超过 7 天未回复", issues: [{ title: "报价未回复", severity: "HIGH" }], evidence: [{ sourceType: "QUOTE", sourceId: "q1" }] } }, errorMessage: null },
    { stepKey: FOLLOWUP_STEP.prioritize, preferredTool: FOLLOWUP_TOOL.prioritize, status: "completed", outputJson: { prioritized: [{ customerId: "c1", customerName: "One", score: 50, reasons: ["r"], evidenceRefs: ["s2:o1"], email: "a@x.test" }] }, errorMessage: null },
  ];
  const prepStep = (status: string) => ({
    stepKey: FOLLOWUP_STEP.prepareActions,
    preferredTool: FOLLOWUP_TOOL.prepareActions,
    status,
    outputJson: { items: [
      { kind: "email_draft", customerId: "c1", customerName: "One", pendingActionId: "pa_e" },
      { kind: "reminder", customerId: "c1", customerName: "One", pendingActionId: "pa_r" },
    ] },
    errorMessage: null,
  });
  const base = { id: "run1", errorCode: null, errorMessage: null, metadata: meta };

  const waiting = projectFollowupOutcome({
    run: { ...base, status: "awaiting_approval" },
    steps: [...analysisSteps, prepStep("awaiting_approval")],
    pendingActions: [
      { id: "pa_e", type: "grader.email_draft", status: "pending", resultRef: null, failureReason: null, expiresAt: "2026-10-20T00:00:00Z" },
      { id: "pa_r", type: "calendar.create_event", status: "approved", resultRef: null, failureReason: null, expiresAt: "2026-10-20T00:00:00Z" },
    ],
    now: NOW,
  })!;
  ok("投影：pending=已准备预览等待确认；approved≠executed", waiting.overall === "waiting_for_confirmation" &&
    waiting.emailDrafts.items[0].state === "awaiting_approval" && waiting.reminders.items[0].state === "approved_not_executed", waiting);
  ok("投影：报价风险汇总带证据引用", waiting.quoteRisk.state === "completed" && waiting.quoteRisk.refs.includes("quote:q1"));

  const partial = projectFollowupOutcome({
    run: { ...base, status: "needs_human", errorCode: null, errorMessage: "审批结果无法安全 reconcile" },
    steps: [...analysisSteps, prepStep("failed")],
    pendingActions: [
      { id: "pa_e", type: "grader.email_draft", status: "failed", resultRef: null, failureReason: "Gmail 未连接", expiresAt: null },
      { id: "pa_r", type: "calendar.create_event", status: "executed", resultRef: "evt_1", failureReason: null, expiresAt: null },
    ],
    now: NOW,
  })!;
  ok("T13: 草稿失败 + 提醒成功 → 部分完成（不是已完成）", partial.overall === "partially_completed" &&
    partial.reminders.items[0].state === "reminder_created" && partial.emailDrafts.items[0].state === "failed", partial);
  ok("T13: 摘要按原因区分未完成项（执行失败 ≠ 你已拒绝）", partial.headline.includes("已建立 1 个提醒") && partial.headline.includes("执行失败 1 项") && !partial.headline.includes("你已拒绝"), partial.headline);

  const noReceipt = projectFollowupOutcome({
    run: { ...base, status: "completed" },
    steps: [...analysisSteps, prepStep("completed")],
    pendingActions: [
      { id: "pa_e", type: "grader.email_draft", status: "executed", resultRef: null, failureReason: null, expiresAt: null },
      { id: "pa_r", type: "calendar.create_event", status: "executed", resultRef: "evt_1", failureReason: null, expiresAt: null },
    ],
    now: NOW,
  })!;
  ok("T14: run=completed 但草稿无 resultRef → 不验收为完成", noReceipt.overall === "partially_completed" &&
    noReceipt.emailDrafts.items[0].state === "executed_without_receipt", noReceipt);

  const done = projectFollowupOutcome({
    run: { ...base, status: "completed" },
    steps: [...analysisSteps, prepStep("completed")],
    pendingActions: [
      { id: "pa_e", type: "grader.email_draft", status: "executed", resultRef: "draft_1", failureReason: null, expiresAt: null },
      { id: "pa_r", type: "calendar.create_event", status: "executed", resultRef: "evt_1", failureReason: null, expiresAt: null },
    ],
    now: NOW,
  })!;
  ok("投影：全部有回执 → 已完成", done.overall === "completed" && done.emailDrafts.items[0].resultRef === "draft_1");

  const degraded = projectFollowupOutcome({
    run: { ...base, status: "completed" },
    steps: analysisSteps.map((s) => s.stepKey === FOLLOWUP_STEP.followupAnalysis ? { ...s, outputJson: { grader: "customer_followup_fallback", degraded: true, evidenceQuality: "PARTIAL" } } : s).concat([prepStep("completed")]),
    pendingActions: [
      { id: "pa_e", type: "grader.email_draft", status: "executed", resultRef: "draft_1", failureReason: null, expiresAt: null },
      { id: "pa_r", type: "calendar.create_event", status: "executed", resultRef: "evt_1", failureReason: null, expiresAt: null },
    ],
    now: NOW,
  })!;
  ok("T14: 降级分析证据 → 不算已完成", degraded.overall === "partially_completed" && degraded.analysis.state === "degraded");

  const cancelled = projectFollowupOutcome({
    run: { ...base, status: "cancelled" },
    steps: [...analysisSteps, prepStep("awaiting_approval")],
    pendingActions: [
      { id: "pa_e", type: "grader.email_draft", status: "rejected", resultRef: null, failureReason: "关联任务已取消，待确认动作已拒绝", expiresAt: null },
      { id: "pa_r", type: "calendar.create_event", status: "executed", resultRef: "evt_1", failureReason: null, expiresAt: null },
    ],
    now: NOW,
  })!;
  ok("T10: 已取消 → cancelled，且如实保留取消前已发生的副作用", cancelled.overall === "cancelled" &&
    cancelled.emailDrafts.items[0].state === "cancelled" && cancelled.reminders.items[0].state === "reminder_created" && cancelled.headline.includes("取消前已发生"), cancelled);

  const needsInput = projectFollowupOutcome({
    run: { ...base, status: "completed", metadata: { ...meta, [FOLLOWUP_META.reminderAt]: null, [FOLLOWUP_META.deliverables]: "analysis,reminders", [FOLLOWUP_META.missing]: "reminder_time" } },
    steps: analysisSteps,
    pendingActions: [],
    now: NOW,
  })!;
  ok("T12: 分析完成、提醒缺时间 → needs_input（任务与进度保留）", needsInput.overall === "needs_input" && needsInput.reminders.state === "needs_input" && needsInput.nextActions.some((a) => a.includes("日期和时间")), needsInput);

  const unsupportedDone = projectFollowupOutcome({
    run: { ...base, status: "completed", metadata: { ...meta, [FOLLOWUP_META.deliverables]: "analysis", [FOLLOWUP_META.unsupported]: "auto_order" } },
    steps: analysisSteps,
    pendingActions: [],
    now: NOW,
  })!;
  ok("T17: 存在未执行的越界请求 → 不显示为全部完成", unsupportedDone.overall === "partially_completed" && unsupportedDone.notPerformed[0].code === "auto_order");

  ok("非跟进任务不产生投影（旧 run 不受影响）", projectFollowupOutcome({ run: { ...base, status: "completed", metadata: {} }, steps: [], pendingActions: [] }) === null);

  // ── 旧客户端兼容：审批回包不带 followup/steps 时不得抹掉卡片 ──
  const prev = { runId: "r", status: "waiting_for_confirmation", runtimeSteps: [{ title: "a", status: "completed" }], followup: done } as unknown as AssistantRunStatusDto;
  const next = { runId: "r", status: "running" } as unknown as AssistantRunStatusDto;
  const merged = mergeAssistantRunUpdate(prev, next);
  ok("DTO 合并：新状态生效、缺失的展示字段保留", merged.status === "running" && merged.runtimeSteps?.length === 1 && !!merged.followup);

  console.log(`\n✅ durable-followup-pure: ${passed} passed`);
}

main();
