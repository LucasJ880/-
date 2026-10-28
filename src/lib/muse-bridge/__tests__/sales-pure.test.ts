/**
 * Muse Bridge 销售意图（TASKFLOW S1）— 纯逻辑测试（零 DB）
 * 运行：npx tsx src/lib/muse-bridge/__tests__/sales-pure.test.ts
 */

import assert from "node:assert/strict";
import { advisoryResponse, OUTBOUND_REDACTED } from "../advisory";
import { enabledMuseIntents } from "../flags";
import { gateIntent } from "../router-pure";
import {
  OPEN_STAGE_RAW_VALUES,
  amountsVisible,
  buildOpportunityStatus,
  buildSalesOverview,
  rankOpportunities,
  resolveAssigneeFilter,
  resolveSalesScope,
  type SalesOppRow,
  type SalesScope,
} from "../sales-pure";

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.equal(cond, true, name);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const NOW = new Date("2026-10-27T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const ORG: SalesScope = { kind: "org", orgId: "org_1" };
const OWN: SalesScope = { kind: "own", orgId: "org_1", userId: "u_rep" };

function opp(id: string, o: Partial<SalesOppRow> = {}): SalesOppRow {
  return {
    id,
    title: `Opportunity ${id}`,
    stage: "quoted",
    priority: "warm",
    estimatedValue: null,
    createdAt: daysAgo(40),
    updatedAt: daysAgo(2),
    stageChangedAt: daysAgo(10),
    lastInteractionAt: daysAgo(3),
    lastCustomerReplyAt: daysAgo(5),
    lastOutboundAt: daysAgo(4),
    nextFollowupAt: null,
    nextActionType: null,
    nextActionReason: null,
    customer: { id: `c_${id}`, name: `Customer ${id}` },
    assignee: { id: "u_rep", name: "Rep A" },
    openActionCount: 0,
    overdueActionCount: 0,
    ...o,
  };
}
const rank = (rows: SalesOppRow[], showAmounts = true) => rankOpportunities(rows, { now: NOW, staleAfterDays: 21, showAmounts });

console.log("sales scope");

const id = (role: string | null, orgRole: string) => ({ userId: "u_x", orgId: "org_1", role, orgRole });
for (const role of ["admin", "super_admin", "boss", "manager"]) {
  ok(`平台 ${role} → 全组织`, resolveSalesScope(id(role, "org_member"))?.kind === "org");
}
ok("平台 user + 组织 org_admin → 全组织", resolveSalesScope(id("user", "org_admin"))?.kind === "org");
ok("平台 user + 组织 org_owner → 全组织", resolveSalesScope(id("user", "org_owner"))?.kind === "org");
ok("平台 sales → 仅本人", resolveSalesScope(id("sales", "org_member"))?.kind === "own");
ok("平台 trade → 仅本人", resolveSalesScope(id("trade", "org_member"))?.kind === "own");
ok("平台 user + org_member → 拒绝", resolveSalesScope(id("user", "org_member")) === null);
ok("无平台角色 + org_viewer → 拒绝", resolveSalesScope(id(null, "org_viewer")) === null);
ok("销售指定别人为负责人 → 越权", !resolveAssigneeFilter(OWN, "u_other").ok);
{
  const self = resolveAssigneeFilter(OWN, "u_rep");
  const none = resolveAssigneeFilter(OWN, undefined);
  ok("销售指定自己 / 不指定 → 都只看本人", self.ok && self.assigneeId === "u_rep" && none.ok && none.assigneeId === "u_rep");
  const any = resolveAssigneeFilter(ORG, "u_other");
  const all = resolveAssigneeFilter(ORG, undefined);
  ok("管理者可按任意负责人过滤，不指定则全组织", any.ok && any.assigneeId === "u_other" && all.ok && all.assigneeId === null);
}
ok("决定 B：只有全组织范围能看金额", amountsVisible(ORG) && !amountsVisible(OWN));

console.log("open stages");
for (const s of ["new_inquiry", "negotiation", "follow_up", "new_lead", "needs_confirmed", "measure_booked", "quoted"]) {
  ok(`开放态包含 ${s}`, OPEN_STAGE_RAW_VALUES.includes(s));
}
for (const s of ["won", "lost", "disqualified", "nurture", "stale", "signed", "completed", "on_hold"]) {
  ok(`开放态不含 ${s}`, !OPEN_STAGE_RAW_VALUES.includes(s));
}

console.log("ranking");
{
  const waiting = opp("a", { lastCustomerReplyAt: daysAgo(2), lastOutboundAt: daysAgo(6) });
  const answered = opp("b", { lastCustomerReplyAt: daysAgo(6), lastOutboundAt: daysAgo(2) });
  const r = rank([answered, waiting]);
  ok("客户在等回复的排第一", r[0].row.id === "a");
  ok("理由写明之后没有我方外发记录", r[0].reasons[0] === "客户 2 天前来信，之后没有我方外发记录");
  ok("对方已回复的不出等待理由", !r[1].reasons.some((x) => x.includes("外发")));
}
{
  const r = rank([opp("t", { stage: "won" }), opp("s", { stage: "signed" }), opp("h", { stage: "on_hold" }), opp("o")]);
  ok("终态 / 停放 / 历史成交阶段不进排序", r.length === 1 && r[0].row.id === "o");
}
{
  const r = rank([opp("f", { nextFollowupAt: daysAgo(4) })])[0];
  ok("跟进日已过：理由带天数", r.reasons.includes("约定跟进日已过 4 天") && r.signals.followupOverdue);
}
{
  const r = rank([opp("x", { overdueActionCount: 2, openActionCount: 3 })])[0];
  ok("逾期跟进行动计入理由", r.reasons.includes("2 条跟进行动已逾期"));
}
{
  const r = rank([opp("q", { lastInteractionAt: daysAgo(30), lastCustomerReplyAt: null, lastOutboundAt: null })])[0];
  const text = r.reasons.join("；");
  ok("停滞理由说 CRM 无记录且未核实线下跟进", text.includes("CRM 中 30 天无互动记录（未核实是否有线下跟进）"));
  ok("停滞理由不断言没跟进", !/未跟进|没跟进|没有跟进/.test(text));
}
{
  const r = rank([opp("n", { lastInteractionAt: null, createdAt: daysAgo(25), lastCustomerReplyAt: null, lastOutboundAt: null })])[0];
  ok("从未有互动时按创建时间算停滞", r.signals.stale && r.unverified.includes("最近互动"));
}
{
  const r = rank([opp("u", { assignee: null, nextFollowupAt: null, estimatedValue: null })])[0];
  ok("未核实字段：负责人 / 下次跟进日 / 金额", ["负责人", "下次跟进日", "金额"].every((f) => r.unverified.includes(f)));
  const own = rank([opp("u", { estimatedValue: null })], false)[0];
  ok("看不到金额的范围不把金额列为未核实", !own.unverified.includes("金额"));
}
{
  const r = rank([opp("h1", { priority: "hot" }), opp("w1", { priority: "warm" })]);
  ok("hot 加分且写理由", r[0].row.id === "h1" && r[0].reasons.includes("标记为高热度"));
}
{
  const rows = [opp("v1", { estimatedValue: 50_000 }), opp("v2", { estimatedValue: 5_000 }), opp("v3", { estimatedValue: 20_000 })];
  const mgr = rank(rows, true);
  ok("金额最高的排前", mgr[0].row.id === "v1");
  ok("管理者理由里有金额", mgr[0].reasons.includes("金额 50,000 在本次列表中靠前"));
  const rep = rank(rows, false);
  ok("销售范围：金额仍参与排序", rep[0].row.id === "v1");
  ok("销售范围：理由里没有金额", rep.every((x) => x.reasons.every((s) => !s.includes("金额") && !/\d{1,3},\d{3}/.test(s))));
}
{
  const rows = [opp("m", { updatedAt: daysAgo(1) }), opp("k", { updatedAt: daysAgo(9) }), opp("z", { updatedAt: daysAgo(9) })];
  const a = rank(rows).map((r) => r.row.id).join(",");
  const b = rank([...rows].reverse()).map((r) => r.row.id).join(",");
  ok("平分时顺序确定：更新早者在前，再按 ID", a === "k,z,m" && a === b);
}

console.log("sales_overview");
{
  const rows = [
    opp("a", { lastCustomerReplyAt: daysAgo(1), lastOutboundAt: daysAgo(3), estimatedValue: 12_000 }),
    opp("b", { nextFollowupAt: daysAgo(2), estimatedValue: 3_000 }),
    opp("c", { stage: "lost" }),
    opp("d"),
  ];
  const input = { filteredByAssignee: false, rows, counts: { newInWindow: 2, wonInWindow: 1, lostInWindow: 1 }, days: 30, limit: 2, staleAfterDays: 21, truncated: false, now: NOW };
  const mgr = buildSalesOverview({ ...input, scope: ORG });
  const data = mgr.data as { summary: Record<string, number>; opportunities: Array<{ rank: number; crm: Record<string, unknown> }>; amountsVisible: boolean };
  ok("统计：开放 3、等回复 1、跟进日已过 1", data.summary.open === 3 && data.summary.customerWaiting === 1 && data.summary.followupOverdue === 1);
  ok("统计带窗口计数", data.summary.newInWindow === 2 && data.summary.wonInWindow === 1 && data.summary.lostInWindow === 1);
  ok("limit 生效", data.opportunities.length === 2 && data.opportunities[0].rank === 1);
  ok("管理者 data 带 amount", data.amountsVisible && data.opportunities[0].crm.amount === 12_000);
  ok("结论说有客户在等回复", mgr.advisory.conclusion === "全组织进行中 3 个商机，1 个客户在等回复");
  ok("下一步是看第一条详情", mgr.advisory.nextStep?.command.intent === "opportunity_status" && mgr.advisory.nextStep.command.opportunityId === "a");
  const res = advisoryResponse("req-sales-0001", mgr.advisory, { data: mgr.data });
  const lines = res.message.split("\n");
  ok("回复格式：结论 ≤ 60 字、理由行 ≤ 3", lines[0].length <= 60 && lines.filter((l) => l.startsWith("· ")).length <= 3);
  ok("crm 带记录版本 updatedAt（ISO 字符串）", typeof data.opportunities[0].crm.updatedAt === "string");

  const rep = buildSalesOverview({ ...input, scope: OWN });
  const json = JSON.stringify(rep);
  ok("销售范围：data 不出现 amount 键", !json.includes('"amount"'));
  ok("销售范围：不出现金额数字", !json.includes("12000") && !json.includes("12,000") && !json.includes("3,000"));
  ok("销售范围：结论说你负责的", rep.advisory.conclusion.startsWith("你负责的"));
}
{
  const empty = buildSalesOverview({ scope: ORG, filteredByAssignee: true, rows: [opp("w", { stage: "won" })], counts: { newInWindow: 0, wonInWindow: 1, lostInWindow: 0 }, days: 14, limit: 10, staleAfterDays: 21, truncated: false, now: NOW });
  ok("没有开放商机：如实说明并给窗口统计", empty.advisory.conclusion === "该负责人目前没有进行中的商机" && empty.advisory.reasons[0] === "近 14 天新建 0 个、成交 1 个、丢单 0 个" && empty.advisory.nextStep === null);
}

console.log("opportunity_status");
{
  const row = opp("s1", { nextActionType: "quote_follow_up", nextActionReason: "报价已发 3 天", nextFollowupAt: daysAgo(1), estimatedValue: 8_000 });
  const st = buildOpportunityStatus({
    scope: ORG,
    row,
    interactions: [
      { id: "i1", type: "email", direction: "outbound", channel: "email", summary: "发了报价单", createdAt: daysAgo(4), opportunityId: "s1" },
      { id: "i2", type: "note", direction: null, channel: null, summary: "内部：这单毛利 30%", createdAt: daysAgo(3), opportunityId: null },
    ],
    actions: [
      { id: "a1", title: "确认样板", status: "open", priority: "high", dueAt: daysAgo(1), source: "digital_employee_auto", assignee: { id: "u_rep", name: "Rep A" } },
      { id: "a2", title: "约会议", status: "in_progress", priority: "medium", dueAt: null, source: "manual", assignee: null },
    ],
    nextActionLabel: "报价后跟进",
    inquiries: [],
    followups: [],
    staleAfterDays: 21,
    now: NOW,
  });
  const d = st.data as {
    opportunity: { id: string; amount?: number };
    interactions: Array<{ summary: string; level: string }>;
    openActionsTotal: number;
    openActions: Array<{ id: string; overdue: boolean }>;
    suggestions: Array<{ source: string; label: string }>;
    employeeConfirmations: unknown[];
    priority: { reasons: string[] } | null;
  };
  ok("CRM 事实带商机 ID 与金额（管理者）", d.opportunity.id === "s1" && d.opportunity.amount === 8_000);
  ok("互动摘要含敏感词 → 整段脱敏", d.interactions[1].summary === OUTBOUND_REDACTED && d.interactions[0].summary === "发了报价单");
  ok("未结束行动标出逾期", d.openActions[0].overdue && !d.openActions[1].overdue);
  ok("互动区分商机级 / 客户级", d.interactions[0].level === "opportunity" && d.interactions[1].level === "customer");
  ok("系统建议标注来源", d.suggestions[0].source === "revenue_spine" && d.suggestions[0].label === "报价后跟进");
  ok("没有询问时员工确认为空数组", Array.isArray(d.employeeConfirmations) && d.employeeConfirmations.length === 0);
  ok("理由与排序一致", !!d.priority && d.priority.reasons.includes("约定跟进日已过 1 天"));
  ok("结论含阶段与负责人", st.advisory.conclusion === "「Opportunity s1」已报价，负责人Rep A");
  ok("S2：管理者的下一步是带默认问题的「问负责人」", st.advisory.nextStep?.command.intent === "ask_colleague" && (st.advisory.nextStep.command as { questions: string[] }).questions.some((q) => q.includes("约定的跟进")));
}
{
  const st = buildOpportunityStatus({ scope: OWN, row: opp("s2", { stage: "won", estimatedValue: 9_999 }), interactions: [], actions: [], nextActionLabel: null, inquiries: [], followups: [], staleAfterDays: 21, now: NOW });
  const d = st.data as { priority: unknown; opportunity: Record<string, unknown> };
  ok("终态商机：说明不再排序、priority 为 null", st.advisory.reasons[0] === "商机已处于「成交」，不再进入推进排序" && d.priority === null);
  ok("销售范围：状态视图不带 amount", !("amount" in d.opportunity) && !JSON.stringify(st).includes("9999"));
}

console.log("intent gate");
{
  const r = gateIntent("req-gate-0001", { intent: "sales_overview" }, enabledMuseIntents({} as NodeJS.ProcessEnv));
  ok("默认配置下销售意图被诚实拒绝", !!r && r.errorCode === "INTENT_NOT_ENABLED" && r.availableInPhase === 1);
  ok("拒绝消息说属于 Sales Pilot，不说招投标 Phase 1", !!r && r.message.includes("Sales Pilot（Phase S）") && !r.message.includes("Phase 1"));
  const tender = gateIntent("req-gate-0003", { intent: "rfq", projectId: "p1" }, enabledMuseIntents({} as NodeJS.ProcessEnv));
  ok("招投标意图的阶段文字不变", !!tender && tender.message.includes("Phase 1"));
  const on = enabledMuseIntents({ MUSE_BRIDGE_INTENTS: "status,sales_overview,opportunity_status" } as unknown as NodeJS.ProcessEnv);
  ok("显式配置后放行", gateIntent("req-gate-0002", { intent: "opportunity_status", opportunityId: "o1" }, on) === null);
}

console.log(`\nmuse-bridge sales-pure: ${passed} passed`);
