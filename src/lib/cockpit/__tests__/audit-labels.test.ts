/**
 * 组织驾驶舱 company.log 审计条目中文摘要与来源（openspec change org-cockpit-timeline-labels）
 *   标签与回退、商机阶段变更前后阶段、来源判定、白名单解析（异常值不显示）、不输出原因 / 金额 / 策略键、动作代码对照写入方源码
 * 运行：npx tsx src/lib/cockpit/__tests__/audit-labels.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AI_AUDIT_ACTIONS,
  AUDIT_ACTION_LABELS,
  OPPORTUNITY_TRANSITION_ACTION,
  SYSTEM_AUDIT_ACTIONS,
  auditSource,
  auditSummaryText,
  principalActorTypeOf,
  transitionDetailOf,
} from "../audit-labels";
import { auditEntry, type TimelineLookups } from "../timeline";

let pass = 0;
function ok(name: string, fn: () => void) {
  fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const EMPTY: TimelineLookups = { pendingActions: new Map(), projectWorkDomains: new Map(), agentRuns: new Map() };
const j = (v: unknown) => JSON.stringify(v);

console.log("audit-labels");

console.log("\n摘要");

ok("场景「常见动作」：APPROVAL_REJECTED · pending_action → 驳回 · 审批；通用动作与目标中文名", () => {
  assert.equal(auditSummaryText("APPROVAL_REJECTED", "pending_action"), "驳回 · 审批");
  assert.equal(auditSummaryText("update", "project"), "更新 · 项目");
  assert.equal(auditSummaryText("revenue_spine.commercial_fact.applied", "organization"), "商务事实写入 · 组织");
  assert.equal(auditSummaryText("revenue_spine.inquiry_reply.draft_snapshot", "pending_action"), "FDE 草稿留底 · 审批");
  // 目标类型大小写 / 空白不影响
  assert.equal(auditSummaryText("delete", " Project "), "删除 · 项目");
});

ok("场景「未知动作」：原样显示代码；有标签的动作 + 未知目标显示原始目标类型", () => {
  assert.equal(auditSummaryText("supplier_intel.run.created", "supplier_intel_run"), "supplier_intel.run.created · supplier_intel_run");
  // 未知动作即使目标有中文名也保留原始目标类型，避免半中半英
  assert.equal(auditSummaryText("tender_analysis_approve", "project"), "tender_analysis_approve · project");
  assert.equal(auditSummaryText("create", "blinds_order_v2"), "新建 · blinds_order_v2");
  // 写入方实际用的目标类型都有中文名（不出现半中半英）
  assert.equal(auditSummaryText("revenue_spine.draft_preferences.ignored", "revenue_spine_policy"), "草稿偏好有项被忽略 · Revenue Spine 策略");
  assert.equal(auditSummaryText("APPROVAL_APPROVED", "product_content_approval"), "批准 · 产品内容审批");
  assert.equal(auditSummaryText("rfq_inbound:applied", "rfq_inbound_message"), "询价邮件已自动录入 · 询价邮件");
  assert.equal(auditSummaryText("QUOTA_HARD_LIMIT_BLOCKED", "quota"), "配额用尽被拦下 · 配额");
  // 原型链上的键不当标签（toString / constructor）
  assert.equal(auditSummaryText("toString", "project"), "toString · project");
  assert.equal(auditSummaryText("create", "constructor"), "新建 · constructor");
});

ok("动作代码与写入方源码一致（标签表里的审批 / Revenue Spine 动作确实被写入）", () => {
  const decision = read("src/lib/capabilities/approvals/decision.ts");
  for (const a of ["APPROVAL_APPROVED", "APPROVAL_REJECTED", "APPROVAL_CANCELLED", "APPROVAL_EXECUTION_STARTED", "APPROVAL_EXECUTED", "APPROVAL_EXECUTION_FAILED", "APPROVAL_EXECUTION_BLOCKED"]) {
    assert.ok(decision.includes(`"${a}"`), a);
  }
  assert.ok(read("src/lib/pending-actions/drafts.ts").includes('action: "APPROVAL_CREATED"'));
  assert.ok(read("src/lib/pending-actions/supersede.ts").includes('APPROVAL_SYSTEM_SUPERSEDED_AUDIT_ACTION = "APPROVAL_SYSTEM_SUPERSEDED"'));
  assert.ok(read("src/lib/revenue-spine/transition.ts").includes(`action: "${OPPORTUNITY_TRANSITION_ACTION}"`));
  assert.ok(read("src/lib/revenue-spine/fact-proposals.ts").includes('FACT_APPLIED_AUDIT_ACTION = "revenue_spine.commercial_fact.applied"'));
  assert.ok(read("src/lib/revenue-spine/fde/draft-feedback.ts").includes('DRAFT_SNAPSHOT_AUDIT_ACTION = "revenue_spine.inquiry_reply.draft_snapshot"'));
  assert.ok(read("src/lib/revenue-spine/fde/no-reply-followup.ts").includes("revenue_spine.followup_draft.guardrail_blocked"));
  assert.ok(read("src/lib/revenue-spine/draft-preferences.ts").includes('"revenue_spine.draft_preferences.ignored"'));
  const tenderRfq = read("src/lib/tender-rfq/inbound-sync.ts");
  assert.ok(tenderRfq.includes('action: "rfq_inbound:applied"') && tenderRfq.includes('action: "rfq_inbound:failed"') && tenderRfq.includes('INBOUND_AUDIT_TARGET = "rfq_inbound_message"'));
  const quota = read("src/lib/capabilities/governance/evaluate.ts");
  for (const a of ["QUOTA_HARD_LIMIT_BLOCKED", "QUOTA_SOFT_LIMIT_REACHED", "QUOTA_WARNING"]) assert.ok(quota.includes(`"${a}"`), a);
  assert.ok(read("src/lib/trade/outbound-sync.ts").includes('action: "revenue_spine.trade_outbound.mirrored"'));
  assert.ok(read("src/lib/approval/request.ts").includes('principalActorType: input.principal.actorType ?? "user"'));
  // 固定来源表里的动作都有中文标签
  for (const a of [...AI_AUDIT_ACTIONS, ...SYSTEM_AUDIT_ACTIONS]) assert.ok(AUDIT_ACTION_LABELS[a], a);
});

console.log("\n商机阶段变更");

const before = (stage: unknown) => j({ stage });
const after = (o: Record<string, unknown>) => j(o);

ok("场景「自动搁置」：follow_up → stale、来源 system、带策略键 → 商机阶段：跟进中 → 搁置（按策略自动），来源 system", () => {
  const d = transitionDetailOf(before("follow_up"), after({ stage: "stale", source: "system", reason: "x", policyKey: "autonomy.autoStale" }));
  assert.deepEqual(d, { source: "system", byPolicy: true, from: "follow_up", to: "stale" });
  assert.equal(auditSummaryText(OPPORTUNITY_TRANSITION_ACTION, "sales_opportunity", d), "商机阶段：跟进中 → 搁置（按策略自动）");
  assert.equal(auditSource(OPPORTUNITY_TRANSITION_ACTION, d), "system");
});

ok("人工阶段变更：来源 human、不带策略键 → 不加（按策略自动）；FDE 流转 → ai；旧阶段值（Sunny 车道）按 /revenue 同一归一", () => {
  const human = transitionDetailOf(before("quoted"), after({ stage: "won", source: "human" }));
  assert.equal(auditSummaryText(OPPORTUNITY_TRANSITION_ACTION, "sales_opportunity", human), "商机阶段：已报价 → 成交");
  assert.equal(auditSource(OPPORTUNITY_TRANSITION_ACTION, human), "human");
  const fde = transitionDetailOf(before("new_inquiry"), after({ stage: "disqualified", source: "fde", policyKey: "businessProfile.excludedCategoryAction" }));
  assert.equal(auditSource(OPPORTUNITY_TRANSITION_ACTION, fde), "ai");
  assert.equal(auditSummaryText(OPPORTUNITY_TRANSITION_ACTION, "sales_opportunity", fde), "商机阶段：新询盘 → 不合格（按策略自动）");
  const legacy = transitionDetailOf(before("measure_booked"), after({ stage: "signed", source: "human" }));
  assert.equal(auditSummaryText(OPPORTUNITY_TRANSITION_ACTION, "sales_opportunity", legacy), "商机阶段：RFQ 就绪 → 成交");
});

ok("场景「异常阶段值」：自由文本 / 缺失 / 坏 JSON → 退回「商机阶段变更 · 商机」，不出现该文本；来源缺失或未知 → human", () => {
  for (const [b, a] of [
    [before("follow_up"), after({ stage: "我方报价 1234 元", source: "system" })],
    [before(null), after({ stage: "stale" })],
    ["{", "not json"],
    [null, null],
    [j(["follow_up"]), j(["stale"])],
  ] as Array<[string | null, string | null]>) {
    const d = transitionDetailOf(b, a);
    const text = auditSummaryText(OPPORTUNITY_TRANSITION_ACTION, "sales_opportunity", d);
    assert.equal(text, "商机阶段变更 · 商机", `${b} ${a}`);
  }
  assert.equal(transitionDetailOf(before("quoted"), after({ stage: "won", source: "robot" })).source, null);
  assert.equal(transitionDetailOf(null, after({ source: "constructor" })).source, null);
  assert.equal(auditSource(OPPORTUNITY_TRANSITION_ACTION, transitionDetailOf(null, after({ source: "robot" }))), "human");
  assert.equal(auditSource(OPPORTUNITY_TRANSITION_ACTION, null), "human");
  // 策略键只看是否为非空字符串
  assert.equal(transitionDetailOf(null, after({ policyKey: "  " })).byPolicy, false);
  assert.equal(transitionDetailOf(null, after({ policyKey: 1 })).byPolicy, false);
});

console.log("\n来源");

ok("场景「FDE 留底」/ 固定表：FDE 写的三个动作 → ai；审批被系统作废 → system；其余 → human", () => {
  assert.deepEqual([...AI_AUDIT_ACTIONS].map((a) => auditSource(a)), ["ai", "ai", "ai"]);
  assert.equal(auditSource("APPROVAL_SYSTEM_SUPERSEDED"), "system");
  for (const a of ["APPROVAL_APPROVED", "update", "supplier_intel.run.created", "revenue_spine.commercial_fact.applied"]) assert.equal(auditSource(a), "human", a);
  const e = auditEntry(
    { id: "a1", createdAt: new Date("2026-10-26T10:00:00Z"), userId: "u_owner", userName: "Lin", action: "revenue_spine.inquiry_reply.draft_snapshot", targetType: "pending_action", targetId: null },
    EMPTY,
  );
  assert.deepEqual([e.source, e.actor, e.actorName, e.summary], ["ai", "u_owner", "Lin", "FDE 草稿留底 · 审批"]);
  // 固定由系统写入：配额守卫、询价邮件自动录入、人工外发镜像、岗位日结（A-5）
  for (const a of ["QUOTA_HARD_LIMIT_BLOCKED", "QUOTA_SOFT_LIMIT_REACHED", "QUOTA_WARNING", "rfq_inbound:applied", "rfq_inbound:failed", "revenue_spine.trade_outbound.mirrored", "cockpit.post_daily_digest"]) {
    assert.equal(auditSource(a), "system", a);
  }
  // 人工驳回 AI 草稿、询盘回复发送（审批后执行）仍是人工
  assert.equal(auditSource("ai_draft_reject"), "human");
  assert.equal(auditSource("revenue_spine.inquiry_reply.sent"), "human");
});

ok("场景「岗位日结」：cockpit.post_daily_digest 挂组织所有者 → 摘要「岗位日结 · 组织」，来源 system，actor 仍为所有者", () => {
  const e = auditEntry(
    { id: "a2", createdAt: new Date("2026-10-31T04:00:00Z"), userId: "u_owner", userName: "Lin", action: "cockpit.post_daily_digest", targetType: "organization", targetId: "org1" },
    EMPTY,
  );
  assert.deepEqual([e.source, e.actor, e.summary], ["system", "u_owner", "岗位日结 · 组织"]);
});

ok("场景「FDE 发起的审批」：发起审批按审批载荷里的发起方——agent → ai，user / 缺失 → human；只对发起审批生效", () => {
  const lookups = (actorType: string | null): TimelineLookups => ({
    ...EMPTY,
    pendingActions: new Map([["pa1", { type: "sales.send_inquiry_reply", projectId: null, agentRunId: null, payload: { to: "x", metadata: actorType ? { principalActorType: actorType } : {} } }]]),
  });
  const row = (action: string) => ({ id: "a1", createdAt: new Date("2026-10-26T10:00:00Z"), userId: "u_owner", userName: "Lin", action, targetType: "pending_action", targetId: "pa1" });
  const ai = auditEntry(row("APPROVAL_CREATED"), lookups("agent"));
  assert.deepEqual([ai.source, ai.actor, ai.summary], ["ai", "u_owner", "发起审批 · 审批"]);
  assert.equal(auditEntry(row("APPROVAL_CREATED"), lookups("user")).source, "human");
  assert.equal(auditEntry(row("APPROVAL_CREATED"), lookups(null)).source, "human");
  assert.equal(auditEntry(row("APPROVAL_CREATED"), EMPTY).source, "human"); // 找不到审批
  // 批准 / 驳回是人的决定，发起方是 agent 也仍是人工
  assert.equal(auditEntry(row("APPROVAL_APPROVED"), lookups("agent")).source, "human");
  assert.equal(principalActorTypeOf({ metadata: { principalActorType: 3 } }), null);
  assert.equal(principalActorTypeOf(["x"]), null);
});

console.log("\n脱敏");

ok("场景「不输出原因与金额」：阶段变更审计带原因、金额、策略键 → 条目序列化后不含这些值", () => {
  const detail = transitionDetailOf(
    before("negotiation"),
    after({ stage: "won", source: "human", reason: "客户接受我方报价 98765 元，毛利 23%", estimatedValue: 98765, policyKey: "autonomy.secretKey", salesActionId: "sa_1" }),
  );
  const e = auditEntry(
    { id: "t1", createdAt: new Date("2026-10-26T10:00:00Z"), userId: "u1", userName: "Ann", action: OPPORTUNITY_TRANSITION_ACTION, targetType: "sales_opportunity", targetId: "opp1", transition: detail },
    EMPTY,
  );
  const s = j(e);
  for (const v of ["98765", "毛利", "我方报价", "autonomy.secretKey", "sa_1", "reason", "estimatedValue"]) assert.ok(!s.includes(v), v);
  assert.equal(e.summary, "商机阶段：谈判 → 成交（按策略自动）");
});

ok("新摘要照旧过敏感词整段替换", () => {
  const e = auditEntry({ id: "x", createdAt: new Date(), userId: "u1", userName: null, action: "最终报价已确认", targetType: "project", targetId: null }, EMPTY);
  assert.ok(!e.summary.includes("最终报价"), e.summary);
});

console.log(`\naudit-labels: ${pass} passed`);
