/**
 * A-4 工作量 / 无用功汇总（openspec change org-cockpit-workload，spec cockpit/workload）
 * 运行：npx tsx src/lib/cockpit/__tests__/workload.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getLocalTimeParts } from "@/lib/automation/local-time";
import { POST_REGISTRY, postForPendingAction } from "../posts";
import {
  DEFAULT_WORKLOAD_THRESHOLDS,
  PENDING_BATCH_PREPARE_FAILED,
  PENDING_CANCELLED_REASON,
  PENDING_EXPIRED_REASON,
  PENDING_ONBOARDING_TEST_SUPERSEDED,
  PENDING_QUOTE_CHANGED_PREFIX,
  PENDING_RUN_CANCELLED_PREFIX,
  PENDING_SYSTEM_SUPERSEDED_CODES,
  TRADE_SHOW_ROW,
  UNATTRIBUTED_ROW,
  WORKLOAD_AVAILABILITY,
  WORKLOAD_ROW_ORDER,
  computeWorkload,
  costPerApproved,
  localDayKeys,
  localDayOf,
  localDayStart,
  parseWorkloadDays,
  pendingActionOutcome,
  pendingOutcomeAt,
  postForAgentRun,
  rowCanPropose,
  workloadThresholdsFromOrgSettings,
  type WorkloadAgentRunRow,
  type WorkloadInput,
  type WorkloadPendingRow,
  type WorkloadRow,
  type WorkloadThresholds,
  type WorkloadUsageRow,
} from "../workload";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail).slice(0, 500)}`}`);
  }
}

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const NOW = new Date("2026-10-26T16:00:00Z"); // 多伦多 12:00
const TZ = "America/Toronto";
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

function baseInput(o: Partial<WorkloadInput> = {}): WorkloadInput {
  return {
    now: NOW,
    timeZone: TZ,
    days: 14,
    thresholds: { ...DEFAULT_WORKLOAD_THRESHOLDS },
    agentRuns: [],
    automationDaily: new Map(),
    automationLast7: [],
    pendingActions: [],
    attribution: { pendingActions: new Map(), projectWorkDomains: new Map(), agentRunTypes: new Map() },
    inquiries: [],
    followUpGuardrailBlocks: [],
    usage: [],
    usageRuns: new Map(),
    truncated: false,
    ...o,
  };
}

function pa(o: Partial<WorkloadPendingRow> = {}): WorkloadPendingRow {
  return {
    type: "sales.update_followup",
    projectId: null,
    agentRunId: null,
    payload: {},
    status: "pending",
    failureReason: null,
    decidedById: null,
    createdAt: hoursAgo(30),
    decidedAt: null,
    executedAt: null,
    updatedAt: hoursAgo(30),
    inquiry: null,
    ...o,
  };
}

const row = (rows: WorkloadRow[], key: string) => rows.find((r) => r.key === key)!;

// ── 参数与阈值 ────────────────────────────────────────────────
console.log("参数 days");
for (const [raw, expected] of [
  [null, 14],
  ["", 14],
  ["7", 7],
  ["30", 30],
  ["6", null],
  ["31", null],
  ["abc", null],
  ["14.5", null],
  ["-7", null],
] as Array<[string | null, number | null]>) {
  const r = parseWorkloadDays(raw);
  ok(expected === null ? !r.ok : r.ok && r.days === expected, `days=${JSON.stringify(raw)} → ${expected ?? "400"}`, r);
}

console.log("阈值覆盖");
{
  const t = workloadThresholdsFromOrgSettings({ cockpit: { workloadThresholds: { rejectRate: 0.3, expireRate: 2, minDecisions: "5" } } });
  ok(
    t.rejectRate === 0.3 && t.expireRate === 0.5 && t.minDecisions === 4 && t.idleMinRuns === 1 && t.costMultiple === 3 && t.minCostPeers === 3,
    "部分覆盖：合法项生效，非法项回退默认（spec 场景）",
    t,
  );
  ok(JSON.stringify(workloadThresholdsFromOrgSettings(null)) === JSON.stringify(DEFAULT_WORKLOAD_THRESHOLDS), "无设置 → 默认");
  ok(JSON.stringify(workloadThresholdsFromOrgSettings({ cockpit: { workloadThresholds: [1, 2] } })) === JSON.stringify(DEFAULT_WORKLOAD_THRESHOLDS), "非对象 → 默认");
  const cases: Array<[keyof WorkloadThresholds, unknown, boolean]> = [
    ["rejectRate", 1, true],
    ["rejectRate", 0, false],
    ["rejectRate", Number.NaN, false],
    ["expireRate", 0.01, true],
    ["minDecisions", 1, true],
    ["minDecisions", 2.5, false],
    ["minDecisions", 1001, false],
    ["idleMinRuns", 1000, true],
    ["idleMinRuns", 0, false],
    ["costMultiple", 1, false],
    ["costMultiple", 1.5, true],
    ["costMultiple", 101, false],
    ["minCostPeers", 2, true],
  ];
  for (const [key, value, accepted] of cases) {
    const t2 = workloadThresholdsFromOrgSettings({ cockpit: { workloadThresholds: { [key]: value } } });
    ok((t2[key] === value) === accepted, `${key}=${String(value)} ${accepted ? "接受" : "回退默认"}`, t2);
  }
}

// ── 本地日 ────────────────────────────────────────────────────
console.log("本地日");
ok(localDayOf(new Date("2026-10-25T17:30:00Z"), "Asia/Shanghai") === "2026-10-26", "上海：UTC 10-25 17:30 → 本地 10-26（spec 场景）");
ok(localDayOf(new Date("2026-10-26T03:59:00Z"), TZ) === "2026-10-25" && localDayOf(new Date("2026-10-26T04:00:00Z"), TZ) === "2026-10-26", "多伦多（EDT）本地午夜边界");
{
  const days = localDayKeys(NOW, TZ, 14);
  ok(days.length === 14 && days[13] === "2026-10-26" && days[0] === "2026-10-13", "14 个本地日，含今天，升序", days);
  const dst = localDayKeys(new Date("2026-11-05T17:00:00Z"), TZ, 14);
  ok(new Set(dst).size === 14 && dst.filter((d) => d === "2026-11-01").length === 1, "跨夏令时结束日，每个本地日只出现一次（spec 场景）", dst);
  const start = localDayStart("2026-11-01", TZ).getTime();
  const next = localDayStart("2026-11-02", TZ).getTime();
  ok(start === Date.parse("2026-11-01T04:00:00Z") && next - start === 25 * 3_600_000, "2026-11-01 多伦多一天 25 小时", { start, next });
  ok(localDayOf(new Date("2026-11-02T04:30:00Z"), TZ) === "2026-11-01", "夏令时结束当晚 23:30（EST）仍计入 11-01");
  const mismatch: string[] = [];
  for (const tz of ["America/Toronto", "Asia/Shanghai", "UTC", "Australia/Lord_Howe"]) {
    for (let t = Date.parse("2026-03-01T00:00:00Z"); t < Date.parse("2026-12-01T00:00:00Z"); t += 7 * 3_600_000 + 13 * 60_000) {
      const d = new Date(t);
      if (localDayOf(d, tz) !== getLocalTimeParts(d, tz).date) mismatch.push(`${tz} ${d.toISOString()}`);
    }
  }
  ok(mismatch.length === 0, "缓存格式化器的本地日与 automation/local-time 逐点一致（四个时区、含夏令时）", mismatch.slice(0, 3));
}

// ── 结局判定 ──────────────────────────────────────────────────
console.log("待审批结局");
const outcomeCases: Array<[string, Parameters<typeof pendingActionOutcome>[0], string, boolean]> = [
  ["待定", { status: "pending", failureReason: null, decidedById: null }, "pending", false],
  ["已执行 → 批准", { status: "executed", failureReason: null, decidedById: "u1" }, "approved", false],
  ["已批准待执行 → 批准", { status: "approved", failureReason: null, decidedById: "u1" }, "approved", false],
  ["人工驳回", { status: "rejected", failureReason: "不需要", decidedById: "u1" }, "rejected", false],
  ["关联任务取消导致的驳回 → 取消（spec 场景）", { status: "rejected", failureReason: "关联任务已取消，动作未执行", decidedById: null }, "cancelled", false],
  ["过期不计入驳回（spec 场景）", { status: "failed", failureReason: "已过期", decidedById: null }, "expired", false],
  ["人工取消", { status: "failed", failureReason: "已取消", decidedById: "u1" }, "cancelled", false],
  ["人工已另行回复 → 作废", { status: "failed", failureReason: "SUPERSEDED_BY_MANUAL_REPLY;tradeMessageId=t1", decidedById: null }, "superseded", false],
  ["客户又来信 → 作废", { status: "failed", failureReason: "SUPERSEDED_BY_NEWER_INBOUND;inboundInteractionId=i1", decidedById: null }, "superseded", false],
  ["入驻测试作废 → 整条不计（spec 场景）", { status: "failed", failureReason: "SUPERSEDED_BY_ONBOARDING_TEST;triggeredBy=admin", decidedById: null }, "excluded", false],
  ["批准后执行失败（spec 场景）", { status: "failed", failureReason: "SMTP 550", decidedById: "u1" }, "approved", true],
  ["批量准备失败（写入方带决策人）→ 系统失败，不算批准（spec 场景）", { status: "failed", failureReason: "BATCH_PREPARE_FAILED", decidedById: "u1" }, "system_failed", false],
  ["报价让利内容已变化 → 作废", { status: "failed", failureReason: "报价让利内容已变化，请重新提交审批", decidedById: null }, "superseded", false],
  ["未接入执行器 → 系统失败", { status: "failed", failureReason: "该动作类型暂未接入执行器", decidedById: null }, "system_failed", false],
  ["未知状态 → 系统失败", { status: "weird", failureReason: null, decidedById: null }, "system_failed", false],
];
for (const [name, input, outcome, executionFailed] of outcomeCases) {
  const r = pendingActionOutcome(input);
  ok(r.outcome === outcome && r.executionFailed === executionFailed, name, r);
}
{
  const decided = new Date("2026-10-20T10:00:00Z");
  const executed = new Date("2026-10-20T10:01:00Z");
  const updated = new Date("2026-10-21T00:00:00Z");
  ok(
    pendingOutcomeAt({ decidedAt: decided, executedAt: executed, updatedAt: updated }) === decided &&
      pendingOutcomeAt({ decidedAt: null, executedAt: executed, updatedAt: updated }) === executed &&
      pendingOutcomeAt({ decidedAt: null, executedAt: null, updatedAt: updated }) === updated,
    "结局日：决策 → 执行 → 最后更新",
  );
}
console.log("写入方文案核对（防漂移）");
{
  const supersede = read("src/lib/pending-actions/supersede.ts");
  ok([PENDING_ONBOARDING_TEST_SUPERSEDED, ...PENDING_SYSTEM_SUPERSEDED_CODES].every((c) => supersede.includes(`"${c}"`)), "作废码与 supersede.ts 一致");
  ok(read("src/lib/approval/port.ts").includes(`failureReason: "${PENDING_EXPIRED_REASON}"`) && read("src/lib/pending-actions/executor.ts").includes(`failureReason: "${PENDING_EXPIRED_REASON}"`), "过期文案与写入方一致");
  ok(read("src/lib/capabilities/approvals/decision.ts").includes(`failureReason: "${PENDING_CANCELLED_REASON}"`), "人工取消文案与写入方一致");
  ok(read("src/lib/pending-actions/executor.ts").includes(`failureReason: "${PENDING_RUN_CANCELLED_PREFIX}`), "关联任务取消文案与写入方一致");
  const drafts = read("src/lib/pending-actions/drafts.ts");
  ok(drafts.includes(`input.reason ?? "${PENDING_BATCH_PREPARE_FAILED}"`) && /decidedById: input\.userId/.test(drafts), "批量准备失败文案与写入方一致（且写入方确实带决策人）");
  ok(read("src/app/api/sales/quotes/[quoteId]/route.ts").includes(`failureReason: "${PENDING_QUOTE_CHANGED_PREFIX}`), "报价变化作废文案与写入方一致");
}

// ── AI 运行归属（与岗位卡片同一规则） ────────────────────────
console.log("AI 运行归属");
{
  const mismatches: string[] = [];
  for (const post of POST_REGISTRY) {
    for (const rt of post.agentRunTypes) if (postForAgentRun(rt, null) !== post.key) mismatches.push(`${rt}`);
    for (const d of post.workDomains) if (postForAgentRun("workforce_job", d) !== post.key) mismatches.push(`workforce_job:${d}`);
  }
  ok(mismatches.length === 0, "注册表里每个运行类型 / 工作域都归到声明它的岗位", mismatches);
  ok(postForAgentRun("conversation", null) === null && postForAgentRun("workforce_job", null) === null && postForAgentRun("workforce_job", "unknown") === null, "对话、无工作域、未知工作域 → 未归属");
}

// ── 汇总 ──────────────────────────────────────────────────────
console.log("汇总与近 7 天窗口");
{
  const r = computeWorkload(
    baseInput({
      agentRuns: [
        { at: hoursAgo(1), runType: "fde_inbound_sales", workDomain: null },
        { at: hoursAgo(7 * 24), runType: "fde_inbound_sales", workDomain: null }, // 恰好 7×24h：计入近 7 天
        { at: new Date(NOW.getTime() - 7 * 24 * 3_600_000 - 1), runType: "fde_inbound_sales", workDomain: null }, // 早 1ms：不计
        { at: hoursAgo(2), runType: "workforce_job", workDomain: "general" },
      ],
      automationDaily: new Map([
        ["2026-10-26", [{ automationKey: "tender-watch", count: 24 }]],
        ["2026-09-01", [{ automationKey: "tender-watch", count: 99 }]], // 窗口外的日期忽略
      ]),
      automationLast7: [{ automationKey: "tender-watch", count: 150 }],
    }),
  );
  ok(r.days.length === 14 && r.rows.every((x) => x.daily.length === 14), "每行每日序列与 days 对齐");
  ok(JSON.stringify(r.rows.map((x) => x.key)) === JSON.stringify(WORKLOAD_ROW_ORDER), "行顺序：七个岗位，询盘销售后紧跟展会行，未归属最后");
  const sales = row(r.rows, "inbound_sales");
  ok(sales.last7.agentRuns === 2 && sales.daily.reduce((s, d) => s + d.agentRuns, 0) === 3, "近 7 天按 7×24 小时（含边界），日序列含窗口内全部", sales.last7);
  ok(row(r.rows, "ops_knowledge").last7.agentRuns === 1, "workforce 作业按工作域归属（general → 运维与知识）");
  const tender = row(r.rows, "tender");
  ok(tender.last7.automationRuns === 150 && tender.daily[13].automationRuns === 24 && tender.daily.reduce((s, d) => s + d.automationRuns, 0) === 24, "平台级自动化按注册表归岗位；窗口外日期忽略");
  ok(tender.signals.length === 0, "平台自动化不参与规则（只有自动化运行的岗位不算空转）");
  ok(r.availability.edited.status === "unavailable" && r.availability.autoExecuted.status === "not_applicable" && WORKLOAD_AVAILABILITY.automationScope === "platform", "改过再批未接入、自动执行不适用、自动化为平台级（spec 场景）");
}

console.log("待审批的提出与结局");
{
  const r = computeWorkload(
    baseInput({
      pendingActions: [
        pa({ type: "sales.send_inquiry_reply", status: "executed", decidedById: "u1", decidedAt: hoursAgo(20), createdAt: hoursAgo(25) }),
        pa({ type: "sales.send_inquiry_reply", status: "failed", failureReason: "已过期", updatedAt: hoursAgo(2), createdAt: hoursAgo(80) }),
        pa({ type: "sales.send_inquiry_reply", status: "rejected", decidedById: "u1", decidedAt: hoursAgo(3) }),
        pa({ type: "sales.send_inquiry_reply", status: "failed", failureReason: "SMTP 550", decidedById: "u1", decidedAt: hoursAgo(4) }),
        pa({ type: "sales.send_inquiry_reply", status: "pending", inquiry: { testInquiry: true, tradeShow: false } }),
        pa({ type: "sales.send_inquiry_reply", status: "pending", inquiry: { testInquiry: false, tradeShow: true } }),
        pa({ type: "sales.send_inquiry_reply", status: "failed", failureReason: "SUPERSEDED_BY_ONBOARDING_TEST;x" }),
        pa({ type: "grader.email_draft", status: "pending" }),
      ],
    }),
  );
  const sales = row(r.rows, "inbound_sales").last7;
  ok(sales.proposed === 4, "提出按创建日计；测试询盘、入驻测试作废、展会不计入询盘销售", sales);
  ok(sales.approved === 2 && sales.executionFailed === 1 && sales.rejected === 1 && sales.expired === 1, "批准（含执行失败）/ 驳回 / 过期各自计数，过期不进驳回", sales);
  ok(row(r.rows, TRADE_SHOW_ROW).last7.proposed === 1 && sales.proposed + row(r.rows, TRADE_SHOW_ROW).last7.proposed === 5, "展会询盘单列（spec 场景）");
  ok(row(r.rows, UNATTRIBUTED_ROW).last7.proposed === 1, "通用动作无上下文 → 未归属");
  ok(r.rows.reduce((s, x) => s + x.last7.proposed, 0) === 6, "测试询盘关联的动作不计入任何一行（spec 场景）");
}
{
  const r = computeWorkload(
    baseInput({
      pendingActions: [
        pa({ type: "grader.project_task", projectId: "p1", status: "pending" }),
        pa({ type: "grader.email_draft", payload: { targetType: "PROJECT", targetId: "p2" }, status: "pending" }),
        pa({ type: "calendar.create_event", agentRunId: "run-1", status: "pending" }),
      ],
      attribution: {
        pendingActions: new Map(),
        projectWorkDomains: new Map([
          ["p1", "tender"],
          ["p2", "general"],
        ]),
        agentRunTypes: new Map([["run-1", "fde_inbound_sales"]]),
      },
    }),
  );
  ok(row(r.rows, "tender").last7.proposed === 1 && row(r.rows, "inbound_sales").last7.proposed === 1, "通用动作按项目工作域 / 产出 run 类型归属（复用 A-1 规则）");
  ok(row(r.rows, "ops_knowledge").last7.proposed === 0 && row(r.rows, "projects").last7.proposed === 1, "未分类项目（general）不按工作域归到运维与知识，落到目标类型规则（项目 → 项目交付）");
}

console.log("护栏拦截（与 SLA 指标同口径）");
{
  const inquiry = (opportunityId: string, h: number, o: Partial<{ testInquiry: boolean; tradeShow: boolean; guardrailBlocked: boolean }> = {}) => ({
    opportunityId,
    createdAt: hoursAgo(h),
    testInquiry: false,
    tradeShow: false,
    guardrailBlocked: true,
    ...o,
  });
  const r = computeWorkload(
    baseInput({
      inquiries: [
        inquiry("o1", 50),
        inquiry("o1", 40), // 同一商机：只算最早一条
        inquiry("o2", 30, { testInquiry: true }),
        inquiry("o3", 20, { tradeShow: true }),
        inquiry("o4", 10, { guardrailBlocked: false }),
        inquiry("o5", 5, { guardrailBlocked: false }),
        inquiry("o5", 4), // 同一商机的后一条被拦也不算：SLA 指标按最早一条判定
      ],
      followUpGuardrailBlocks: [
        { at: hoursAgo(6), inquiry: null },
        { at: hoursAgo(300), inquiry: null },
        { at: hoursAgo(7), inquiry: { testInquiry: true, tradeShow: false } },
        { at: hoursAgo(8), inquiry: { testInquiry: false, tradeShow: true } },
      ],
    }),
  );
  ok(row(r.rows, "inbound_sales").last7.guardrailBlocked === 2, "首封护栏按商机去重 + 跟进护栏审计；测试询盘排除", row(r.rows, "inbound_sales").last7);
  ok(row(r.rows, TRADE_SHOW_ROW).last7.guardrailBlocked === 2, "展会询盘的首封与跟进护栏都计入展会行；测试询盘的跟进护栏不计");
  ok(row(r.rows, "inbound_sales").daily.reduce((s, d) => s + d.guardrailBlocked, 0) === 3, "14 天窗口内的跟进护栏也进日序列");
}

console.log("用量与成本");
{
  const r = computeWorkload(
    baseInput({
      usage: [
        { at: hoursAgo(3), runId: null, sourceType: "PRODUCT_CONTENT", inputTokens: 100, outputTokens: 50, cost: 0.12345, currency: "USD" },
        { at: hoursAgo(4), runId: "run-9", sourceType: "AGENT_RUNTIME", inputTokens: 10, outputTokens: 5, cost: 0.5, currency: "USD" },
        { at: hoursAgo(5), runId: null, sourceType: "AGENT_RUNTIME", inputTokens: 1, outputTokens: 1, cost: 2, currency: "USD" },
        { at: hoursAgo(6), runId: null, sourceType: "PRODUCT_CONTENT", inputTokens: 7, outputTokens: null, cost: 9, currency: "CNY" },
      ],
      usageRuns: new Map([["run-9", { runType: "fde_inbound_sales", workDomain: null }]]),
    }),
  );
  const content = row(r.rows, "content");
  ok(content.costRecorded && content.last7.inputTokens === 107 && content.last7.outputTokens === 50 && content.last7.cost === 0.1235, "产品内容记账归内容岗位；非 USD 只计 token 不计成本；成本保留 4 位（spec 场景）", content.last7);
  ok(row(r.rows, "inbound_sales").costRecorded && row(r.rows, "inbound_sales").last7.cost === 0.5, "关联运行的记账按运行归属");
  ok(row(r.rows, UNATTRIBUTED_ROW).last7.cost === 2, "无运行、非产品内容 → 未归属");
  ok(!row(r.rows, "tender").costRecorded && row(r.rows, "tender").last7.cost === 0, "没有任何记账的行标为未入账（spec 场景）");
}

// ── 规则 ──────────────────────────────────────────────────────
console.log("疑似无用功规则");
function withCounts(per: Record<string, Partial<WorkloadRow["last7"]> & { costRecorded?: boolean }>, thresholds = { ...DEFAULT_WORKLOAD_THRESHOLDS }) {
  // 用夹具行直接驱动 computeWorkload：每个计数造对应条数的事件
  const pendingActions: WorkloadPendingRow[] = [];
  const agentRuns: WorkloadAgentRunRow[] = [];
  const usage: WorkloadUsageRow[] = [];
  // 有固定动作类型的岗位直接用；项目交付用通用动作 + 项目工作域归属
  const typeFor: Record<string, Partial<WorkloadPendingRow>> = {
    inbound_sales: { type: "sales.send_inquiry_reply" },
    tender: { type: "tender.send_rfq" },
    projects: { type: "grader.project_task", projectId: "p-delivery" },
  };
  for (const [key, c] of Object.entries(per)) {
    const t = typeFor[key];
    for (let i = 0; i < (c.approved ?? 0); i++) pendingActions.push(pa({ ...t, status: "executed", decidedById: "u", decidedAt: hoursAgo(5) }));
    for (let i = 0; i < (c.rejected ?? 0); i++) pendingActions.push(pa({ ...t, status: "rejected", decidedById: "u", decidedAt: hoursAgo(5) }));
    for (let i = 0; i < (c.expired ?? 0); i++) pendingActions.push(pa({ ...t, status: "failed", failureReason: "已过期", updatedAt: hoursAgo(5) }));
    if (c.agentRuns) for (let i = 0; i < c.agentRuns; i++) agentRuns.push({ at: hoursAgo(2), runType: "fde_inbound_sales", workDomain: null });
    if (c.cost !== undefined) usage.push({ at: hoursAgo(3), runId: `run-${key}`, sourceType: "AGENT_RUNTIME", inputTokens: 1, outputTokens: 1, cost: c.cost, currency: "USD" });
  }
  const usageRuns = new Map(
    Object.keys(per).map((key) => [`run-${key}`, { runType: "workforce_job", workDomain: POST_REGISTRY.find((p) => p.key === key)!.workDomains[0] as string }]),
  );
  const attribution = { pendingActions: new Map(), projectWorkDomains: new Map([["p-delivery", "delivery"]]), agentRunTypes: new Map() };
  return computeWorkload(baseInput({ pendingActions, agentRuns, usage, usageRuns, thresholds, attribution }));
}
{
  const r = withCounts({ inbound_sales: { approved: 1, rejected: 4 } });
  const s = row(r.rows, "inbound_sales").signals.find((x) => x.code === "high_reject_rate");
  ok(!!s && s.message.includes("4/5") && s.message.includes("80%"), "驳回率命中：原因含 4/5 与 80%（spec 场景）", row(r.rows, "inbound_sales").signals);
}
ok(!row(withCounts({ inbound_sales: { approved: 0, rejected: 2 } }).rows, "inbound_sales").signals.some((x) => x.code === "high_reject_rate"), "样本不足不判（spec 场景）");
ok(!row(withCounts({ inbound_sales: { approved: 2, rejected: 2 } }).rows, "inbound_sales").signals.some((x) => x.code === "high_reject_rate"), "恰好等于阈值不命中（严格大于）");
{
  const r = withCounts({ tender: { approved: 1, rejected: 0, expired: 3 } });
  const s = row(r.rows, "tender").signals.find((x) => x.code === "high_expire_rate");
  ok(!!s && s.message.includes("3/4") && s.message.includes("75%"), "过期率命中", row(r.rows, "tender").signals);
}
{
  const r = withCounts({ inbound_sales: { agentRuns: 6 } });
  const s = row(r.rows, "inbound_sales").signals.find((x) => x.code === "idle");
  ok(!!s && s.message.includes("6 次"), "空转命中：原因含 6 次（spec 场景）");
  const raised = withCounts({ inbound_sales: { agentRuns: 6 } }, { ...DEFAULT_WORKLOAD_THRESHOLDS, idleMinRuns: 10 });
  ok(!row(raised.rows, "inbound_sales").signals.some((x) => x.code === "idle"), "空转最小运行数调高后不命中");
}
{
  const r = withCounts({
    inbound_sales: { approved: 1, cost: 1 },
    tender: { approved: 1, cost: 1.2 },
    projects: { approved: 1, cost: 5 },
  });
  const flagged = r.rows.filter((x) => x.signals.some((s) => s.code === "cost_outlier")).map((x) => x.key);
  ok(JSON.stringify(flagged) === '["projects"]', "成本离群：1 / 1.2 / 5，只有 5 命中（spec 场景）", flagged);
  ok(row(r.rows, "projects").signals.find((s) => s.code === "cost_outlier")!.message.includes("$5.00"), "成本原因带金额");
  const two = withCounts({ inbound_sales: { approved: 1, cost: 1 }, projects: { approved: 1, cost: 50 } });
  ok(!two.rows.some((x) => x.signals.some((s) => s.code === "cost_outlier")), "有成本的行不足 3 行不判");
  ok(costPerApproved({ last7: { ...row(r.rows, "tender").last7, approved: 0 }, costRecorded: true }) === null, "批准为 0 时没有每次批准成本");
}
{
  const r = computeWorkload(
    baseInput({
      agentRuns: [
        { at: hoursAgo(1), runType: "workforce_job", workDomain: "general" },
        { at: hoursAgo(2), runType: "fde_inbound_sales", workDomain: null },
      ],
      pendingActions: [pa({ type: "sales.send_inquiry_reply", inquiry: { testInquiry: false, tradeShow: true } })],
    }),
  );
  ok(!row(r.rows, "ops_knowledge").signals.some((s) => s.code === "idle") && row(r.rows, "ops_knowledge").last7.agentRuns === 1, "运维与知识收不到待审批：有 AI 运行也不判空转");
  ok(!row(r.rows, "inbound_sales").signals.some((s) => s.code === "idle"), "询盘销售的提出连同展会行一起看：只有展会草稿时不算空转");
  ok(
    POST_REGISTRY.filter((p) => !rowCanPropose(p.key)).map((p) => p.key).join(",") === "service,ops_knowledge,content" && rowCanPropose(TRADE_SHOW_ROW) && !rowCanPropose(UNATTRIBUTED_ROW),
    "收不到待审批的行：客服、运维与知识、内容",
  );
  // 反证：注册表里任何动作类型 / 目标类型 / 项目工作域 / 产出 run 类型都归不到这两行
  const reach = new Set<string>();
  const types = POST_REGISTRY.flatMap((p) => p.pendingActionTypes as readonly string[]).concat(["calendar.create_event", "grader.email_draft"]);
  const domains = POST_REGISTRY.flatMap((p) => p.workDomains as readonly string[]);
  const runTypes = POST_REGISTRY.flatMap((p) => p.agentRunTypes as readonly string[]);
  for (const type of types) {
    for (const targetType of ["PROJECT", "CUSTOMER", "OPPORTUNITY", "QUOTE", null]) {
      for (const projectWorkDomain of [...domains, null]) {
        for (const agentRunType of [...runTypes, null]) {
          const post = postForPendingAction({ type, targetType, projectWorkDomain, agentRunType });
          if (post) reach.add(post);
        }
      }
    }
  }
  ok(POST_REGISTRY.every((p) => reach.has(p.key) === rowCanPropose(p.key)), "rowCanPropose 与 A-1 归属规则实际可达的岗位一致", [...reach]);
}
{
  const r = computeWorkload(baseInput({ agentRuns: [{ at: hoursAgo(1), runType: "workforce_job", workDomain: "nope" }] }));
  ok(row(r.rows, UNATTRIBUTED_ROW).last7.agentRuns === 1 && row(r.rows, UNATTRIBUTED_ROW).signals.length === 0, "未归属行不判规则");
}
ok(computeWorkload(baseInput({ truncated: true })).truncated === true, "truncated 原样透出");
{
  // 行数上限时的 CPU：各来源读满（AI 运行 5 组 × 5000、待审批 5000、用量 5000）
  const agentRuns = Array.from({ length: 25_000 }, (_, i) => ({ at: hoursAgo((i % 330) + 0.5), runType: "fde_inbound_sales", workDomain: null }));
  const pendingActions = Array.from({ length: 5000 }, (_, i) => pa({ type: "tender.send_rfq", status: i % 2 ? "executed" : "pending", decidedById: "u", decidedAt: hoursAgo(i % 300) }));
  const usage = Array.from({ length: 5000 }, (_, i) => ({ at: hoursAgo(i % 300), runId: null, sourceType: "PRODUCT_CONTENT", inputTokens: 1, outputTokens: 1, cost: 0.01, currency: "USD" }));
  const t0 = performance.now();
  computeWorkload(baseInput({ agentRuns, pendingActions, usage }));
  const ms = performance.now() - t0;
  ok(ms < 1500, `读满上限时汇总耗时 ${Math.round(ms)}ms（< 1.5s）`);
}

console.log(`\n组织驾驶舱工作量汇总: ${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
