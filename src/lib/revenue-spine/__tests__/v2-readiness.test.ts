/**
 * B-6 FDE V2 启动条件就绪度（openspec change fde-v2-readiness）测试：纯函数 + 假依赖 + 源码静态断言，无 DB。
 *   四条条件与结论、提案计数（过期 = 待审批过有效期）、来源（提案 / 手工）、首封草稿占比（不含跟进）、读取上限、
 *   查询条件限定组织与窗口、响应不含任何商务值与个人信息、读模型与接口只读
 * 运行：npx tsx src/lib/revenue-spine/__tests__/v2-readiness.test.ts
 *
 * 公开仓库：只用虚构企业、人名与域名。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FACT_PROPOSAL_ACTION_TYPE } from "@/lib/pending-actions/approver-roles";
import { FACT_FIELD_LABELS, FACT_FIELDS } from "../fact-extract";
import { FACT_APPLIED_AUDIT_ACTION } from "../fact-proposals";
import { DRAFT_SNAPSHOT_AUDIT_ACTION } from "../fde/draft-feedback";
import { DEFAULT_REVENUE_SPINE_POLICY, mergeBusinessProfile, type RevenueSpinePolicy } from "../policy";
import {
  CONDITION_LABELS,
  V2_FACT_FIELD_LABELS,
  V2_FACT_FIELDS,
  V2_SNAPSHOT_LIMIT,
  computeV2Readiness,
  type V2ReadinessInput,
} from "../v2-readiness";
import {
  V2_DRAFT_SNAPSHOT_AUDIT_ACTION,
  V2_FACT_APPLIED_AUDIT_ACTION,
  V2_FACT_PROPOSAL_TYPE,
  anyProposalWhere,
  appliedAuditWhere,
  appliedFieldOf,
  dedupeSnapshots,
  defaultV2ReadinessDeps,
  getV2Readiness,
  proposalBucketOf,
  quoteCountWhere,
  snapshotAuditWhere,
  snapshotSummaryOf,
  windowProposalWhere,
  type V2ReadinessDeps,
} from "../v2-readiness-read-model";

let pass = 0;
async function ok(name: string, fn: () => void | Promise<void>) {
  await fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");
const NOW = new Date("2026-10-26T16:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const later = new Date(NOW.getTime() + 86_400_000);

const ALL_KNOWN = { moq: true, productionLeadTime: true, certification: false, costBasis: false, samplePolicy: true };

function input(over: Partial<V2ReadinessInput> = {}): V2ReadinessInput {
  return {
    now: NOW,
    firstProposalAt: daysAgo(45),
    proposals: [],
    proposalsTruncated: false,
    appliedFields: ["moq", "productionLeadTime"],
    appliedTruncated: false,
    snapshots: [],
    snapshotsTruncated: false,
    knowledge: ALL_KNOWN,
    minimumMarginConfigured: false,
    historicalQuotes: 0,
    productCategories: 4,
    ...over,
  };
}

const statusOf = (r: ReturnType<typeof computeV2Readiness>) => Object.fromEntries(r.conditions.map((c) => [c.key, c.status]));

async function main() {
  console.log("v2-readiness");

  console.log("\n口径对照");

  await ok("字段表、待确认文案、动作类型与源码一致（区块侧不 import 服务端模块，所以各存一份）", () => {
    assert.deepEqual([...V2_FACT_FIELDS], [...FACT_FIELDS]);
    assert.deepEqual(V2_FACT_FIELD_LABELS, FACT_FIELD_LABELS);
    const draft = read("src/lib/revenue-spine/reply-draft.ts");
    assert.match(draft, /if \(knowledge\.moq\.status !== "available"\) pending\.push\("MOQ"\);/);
    assert.match(draft, /if \(knowledge\.leadTime\.status !== "available"\) pending\.push\(lang === "zh" \? "生产周期与交期" : "production lead time and delivery schedule"\);/);
    assert.equal(V2_FACT_PROPOSAL_TYPE, FACT_PROPOSAL_ACTION_TYPE);
    assert.equal(V2_FACT_APPLIED_AUDIT_ACTION, FACT_APPLIED_AUDIT_ACTION);
    assert.equal(V2_DRAFT_SNAPSHOT_AUDIT_ACTION, DRAFT_SNAPSHOT_AUDIT_ACTION);
    // 纯函数文件不 import 任何模块（客户端区块引用它）
    assert.doesNotMatch(strip(read("src/lib/revenue-spine/v2-readiness.ts")), /^import /m);
  });

  console.log("\n四条条件与结论");

  await ok("场景「刚开始运行」：第一张提案 10 天前、MOQ 与周期可引用 → 条件 1 未满足（含 10 天、还差 20 天）、2 / 3 已满足、4 无法度量；结论未达到并列出条件 1", () => {
    const r = computeV2Readiness(input({ firstProposalAt: daysAgo(10) }));
    assert.deepEqual(statusOf(r), { fact_proposals_running: "not_met", moq_available: "met", production_lead_time_available: "met", category_level_facts: "not_measurable" });
    assert.equal(r.conditions[0].detail, "第一张事实提案在 10 天前创建，还差 20 天");
    assert.deepEqual(r.verdict.unmet, ["fact_proposals_running"]);
    assert.equal(r.verdict.meetsSuggestedConditions, false);
    assert.equal(r.verdict.summary, `未达到任务书建议的启动条件：${CONDITION_LABELS.fact_proposals_running}未满足；「${CONDITION_LABELS.category_level_facts}」需人工判断`);
    assert.deepEqual(r.conditions.map((c) => c.key), ["fact_proposals_running", "moq_available", "production_lead_time_available", "category_level_facts"]);
  });

  await ok("场景「全部可度量条件满足」：45 天前、MOQ 与周期可引用 → 已达到（组织级口径），并提示条件 4 需人工判断；30 天整为已满足、29 天为未满足", () => {
    const r = computeV2Readiness(input());
    assert.equal(r.verdict.meetsSuggestedConditions, true);
    assert.equal(r.verdict.summary, `已达到任务书建议的启动条件（组织级口径）；「${CONDITION_LABELS.category_level_facts}」需人工判断`);
    assert.deepEqual(r.verdict.needsJudgement, ["category_level_facts"]);
    assert.equal(r.conditions[3].detail, "商务事实目前是组织级、不分类目，无法按类目度量；已配置产品类目 4 个，需人工判断");
    assert.equal(statusOf(computeV2Readiness(input({ firstProposalAt: daysAgo(30) }))).fact_proposals_running, "met");
    const d29 = computeV2Readiness(input({ firstProposalAt: new Date(daysAgo(30).getTime() + 1000) }));
    assert.deepEqual([d29.conditions[0].status, d29.conditions[0].detail], ["not_met", "第一张事实提案在 29 天前创建，还差 1 天"]);
  });

  await ok("场景「没有任何提案」：条件 1 未满足、依据「尚无事实提案」、天数为空", () => {
    const r = computeV2Readiness(input({ firstProposalAt: null }));
    assert.deepEqual([r.conditions[0].status, r.conditions[0].detail, r.proposals.runningDays, r.proposals.firstCreatedAt], ["not_met", "尚无事实提案", null, null]);
  });

  await ok("场景「手工配置的事实」：MOQ 从未经提案写入 → 条件 2 已满足、来源手工；周期经提案写入 2 次 → 来源提案；不可引用 → 未满足、来源为空", () => {
    const r = computeV2Readiness(input({ appliedFields: ["productionLeadTime", "productionLeadTime", "signature", null] }));
    assert.deepEqual(r.facts.moq, { available: true, appliedViaProposal: 0, source: "manual" });
    assert.deepEqual(r.facts.productionLeadTime, { available: true, appliedViaProposal: 2, source: "proposal" });
    assert.equal(r.conditions[1].detail, "草稿已能引用 MOQ（手工配置，未经提案写入）");
    assert.equal(r.conditions[2].detail, "草稿已能引用大货周期（经提案写入过 2 次）");
    const none = computeV2Readiness(input({ knowledge: { ...ALL_KNOWN, moq: false, productionLeadTime: false } }));
    assert.deepEqual(statusOf(none), { fact_proposals_running: "met", moq_available: "not_met", production_lead_time_available: "not_met", category_level_facts: "not_measurable" });
    assert.equal(none.conditions[1].detail, 'MOQ 未配置，首封草稿仍写"需内部确认"');
    assert.equal(none.conditions[2].detail, '大货周期未配置（只配样品时效不算），首封草稿仍写"需内部确认"');
    assert.deepEqual(none.facts.moq.source, null);
    assert.deepEqual(none.verdict.unmet, ["moq_available", "production_lead_time_available"]);
  });

  console.log("\n依据计数");

  await ok("场景「提案状态计数」：MOQ 3 张（已批准 / 已驳回 / 已过期）→ 已批准 1、驳回 1、过期 1；按字段分列；未知字段只计总数", () => {
    const r = computeV2Readiness(
      input({
        proposals: [
          { bucket: "applied", field: "moq" },
          { bucket: "rejected", field: "moq" },
          { bucket: "expired", field: "moq" },
          { bucket: "pending", field: "loadingPorts" },
          { bucket: "other", field: "catalogUrl" },
          { bucket: "other", field: "unknown_field" },
        ],
      }),
    );
    assert.deepEqual(r.proposals.window, { created: 6, pending: 1, applied: 1, rejected: 1, expired: 1, other: 2 });
    assert.deepEqual(r.proposals.byField.find((f) => f.field === "moq"), { field: "moq", label: "起订量", created: 3, applied: 1, rejected: 1 });
    assert.deepEqual(r.proposals.byField.map((f) => f.field), [...V2_FACT_FIELDS]);
    assert.equal(r.proposals.byField.reduce((n, f) => n + f.created, 0), 5); // 未知字段不分列
  });

  await ok("场景「首封草稿占比」/「只发目录不进占比」：4 封首封 + 2 封只发目录 + 2 封跟进，首封 3 封仍写 MOQ → 首封 4、MOQ 3 封 75%、只发目录 2；周期中英两种文案都算；没有首封时占比为空", () => {
    const first = (p: string[]) => ({ followUpStep: null, pendingInternalConfirmation: p });
    const r = computeV2Readiness(
      input({
        snapshots: [
          first(["MOQ", "生产周期与交期", "价格"]),
          first(["MOQ", "production lead time and delivery schedule", "pricing"]),
          first(["MOQ", "pricing"]),
          first(["价格"]),
          first([]),
          first([]),
          { followUpStep: 1, pendingInternalConfirmation: ["MOQ"] },
          { followUpStep: 2, pendingInternalConfirmation: [] },
        ],
      }),
    );
    // 待确认项为空的首封 = 只发目录：单独计数，不进分母（否则 MOQ 未配置时占比被拉低）
    assert.deepEqual(r.drafts, { firstReplies: 4, catalogOnlyReplies: 2, pendingMoq: 3, pendingMoqShare: 0.75, pendingLeadTime: 2, pendingLeadTimeShare: 0.5, sampled: false, sampleLimit: V2_SNAPSHOT_LIMIT });
    const empty = computeV2Readiness(input({ snapshots: [{ followUpStep: 1, pendingInternalConfirmation: ["MOQ"] }] }));
    assert.deepEqual([empty.drafts.firstReplies, empty.drafts.pendingMoqShare, empty.drafts.pendingLeadTimeShare], [0, null, null]);
  });

  await ok("场景「只发目录不进占比」：MOQ 未配置，1 封普通首封 + 3 封只发目录 → 首封 1、只发目录 3、MOQ 占比 100%", () => {
    const r = computeV2Readiness(
      input({
        knowledge: { ...ALL_KNOWN, moq: false },
        snapshots: [
          { followUpStep: null, pendingInternalConfirmation: ["MOQ", "pricing"] },
          ...Array.from({ length: 3 }, () => ({ followUpStep: null, pendingInternalConfirmation: [] as string[] })),
        ],
      }),
    );
    assert.deepEqual([r.drafts.firstReplies, r.drafts.catalogOnlyReplies, r.drafts.pendingMoqShare], [1, 3, 1]);
  });

  await ok("V2 其余数据源：认证 / 成本基础可用性、样品政策 / 最低毛利是否配置、历史报价条数、类目数原样带出", () => {
    const r = computeV2Readiness(input({ minimumMarginConfigured: true, historicalQuotes: 12, productCategories: 2 }));
    assert.deepEqual(r.otherSources, { certificationAvailable: false, costBasisAvailable: false, samplePolicyConfigured: true, minimumMarginConfigured: true, historicalQuotes: 12, productCategories: 2 });
  });

  console.log("\n读模型");

  await ok("查询条件：全部限定组织；提案与快照限定 30 天窗口；快照只取审批草稿；报价只计数", () => {
    const since = daysAgo(30);
    assert.deepEqual(anyProposalWhere("org_1"), { orgId: "org_1", type: "revenue_spine.propose_commercial_fact" });
    assert.deepEqual(windowProposalWhere("org_1", since), { orgId: "org_1", type: "revenue_spine.propose_commercial_fact", createdAt: { gte: since } });
    assert.deepEqual(appliedAuditWhere("org_1"), { orgId: "org_1", action: "revenue_spine.commercial_fact.applied" });
    assert.deepEqual(snapshotAuditWhere("org_1", since), { orgId: "org_1", action: "revenue_spine.inquiry_reply.draft_snapshot", targetType: "pending_action", createdAt: { gte: since } });
    assert.deepEqual(quoteCountWhere("org_1"), { orgId: "org_1" });
  });

  await ok("解析：写入审计取字段；快照只取跟进序号与待确认项，版本不符 / 缺字段 / 坏 JSON 不计", () => {
    assert.equal(appliedFieldOf(JSON.stringify({ field: "moq", valueKey: "x", version: 3 })), "moq");
    assert.equal(appliedFieldOf("not json"), null);
    assert.equal(appliedFieldOf(null), null);
    assert.deepEqual(snapshotSummaryOf(JSON.stringify({ version: 1, followUpStep: null, pendingInternalConfirmation: ["MOQ", 3], body: "x" })), { followUpStep: null, pendingInternalConfirmation: ["MOQ"] });
    assert.deepEqual(snapshotSummaryOf(JSON.stringify({ version: 1, followUpStep: 2, pendingInternalConfirmation: [] })), { followUpStep: 2, pendingInternalConfirmation: [] });
    for (const bad of [null, "{", JSON.stringify({ version: 2, followUpStep: null, pendingInternalConfirmation: [] }), JSON.stringify({ version: 1, followUpStep: "1", pendingInternalConfirmation: [] }), JSON.stringify({ version: 1, followUpStep: null })]) {
      assert.equal(snapshotSummaryOf(bad), null, String(bad));
    }
  });

  // 配了值的 policy：MOQ 987654、周期 611–833 天、最低毛利 0.4321、样品政策 → 响应里一个都不能出现
  const POLICY: RevenueSpinePolicy = {
    ...DEFAULT_REVENUE_SPINE_POLICY,
    businessProfile: mergeBusinessProfile(DEFAULT_REVENUE_SPINE_POLICY.businessProfile, {
      productCategories: ["bathrobe", "blanket"],
      minimumMargin: 0.4321,
      samplePolicy: { available: true, note: "free stock samples within 3 days" },
      commercialFacts: {
        moq: { quantity: 987654, unit: "pcs", per: "style" },
        productionLeadTime: { daysMin: 611, daysMax: 833, startsFrom: "pre-production sample approval" },
        loadingPorts: ["Exampleport"],
        signature: { title: "Sales Director", whatsapp: "+86 138 0000 0000", website: "www.example-home.example" },
        catalogUrl: "https://example-home.example/catalog.pdf",
      },
    }),
  };

  function fakeDeps(over: Partial<{ proposals: number; snapshots: number; applied: number; policy: RevenueSpinePolicy }> = {}) {
    const calls: Record<string, unknown[]> = {};
    const log = (k: string, ...args: unknown[]) => {
      calls[k] = args;
    };
    const snapshot = (i: number) =>
      JSON.stringify({
        version: 1,
        followUpStep: i % 3 === 2 ? 1 : null,
        pendingInternalConfirmation: i % 2 === 0 ? ["MOQ", "pricing"] : ["pricing"],
        body: "Dear Mark (mark@buyer.example), secret body text about 555555 pcs",
        subject: "Re: Example Buyer Co inquiry",
      });
    const deps: V2ReadinessDeps = {
      now: () => NOW,
      firstProposalAt: async (orgId) => (log("firstProposalAt", orgId), daysAgo(40)),
      windowProposals: async (orgId, since, limit) => {
        log("windowProposals", orgId, since, limit);
        // i=0 已执行；i=1 被超时任务清理成"已过期"；其余待审批
        return Array.from({ length: over.proposals ?? 3 }, (_, i) => ({
          status: i === 0 ? "executed" : i === 1 ? "failed" : "pending",
          expiresAt: i === 1 ? daysAgo(1) : later,
          failureReason: i === 1 ? "已过期" : null,
          decidedById: i === 0 ? "u_boss" : null,
          payload: { field: "moq", proposedValue: { quantity: 555555, unit: "pcs", per: "colour" }, evidence: "evidence: buyer said 555555", opportunityId: "opp_1" },
        }));
      },
      appliedAudits: async (orgId, limit) => {
        log("appliedAudits", orgId, limit);
        return Array.from({ length: over.applied ?? 1 }, () => ({ afterData: JSON.stringify({ field: "moq", valueKey: "987654|pcs|style", version: 7 }) }));
      },
      snapshots: async (orgId, since, limit) => {
        log("snapshots", orgId, since, limit);
        return Array.from({ length: over.snapshots ?? 6 }, (_, i) => ({ targetId: `pa_${i}`, afterData: snapshot(i) }));
      },
      historicalQuoteCount: async (orgId) => (log("historicalQuoteCount", orgId), 9),
      loadPolicy: async (orgId) => (log("loadPolicy", orgId), over.policy ?? POLICY),
      knowledgeStatus: defaultV2ReadinessDeps().knowledgeStatus,
    };
    return { deps, calls };
  }

  await ok("假依赖端到端：每个查询都带服务端解析的组织；窗口 30 天；读取上限 +1 判截断；可引用口径与草稿同源（factory-knowledge）", async () => {
    const f = fakeDeps();
    const r = await getV2Readiness("org_srv", f.deps);
    for (const k of ["firstProposalAt", "windowProposals", "appliedAudits", "snapshots", "historicalQuoteCount", "loadPolicy"]) assert.equal(f.calls[k][0], "org_srv", k);
    assert.deepEqual(f.calls.windowProposals.slice(1), [daysAgo(30), 2001]);
    assert.deepEqual(f.calls.appliedAudits.slice(1), [2001]);
    assert.deepEqual(f.calls.snapshots.slice(1), [daysAgo(30), 301]);
    assert.equal(r.verdict.meetsSuggestedConditions, true);
    assert.deepEqual(r.facts.moq, { available: true, appliedViaProposal: 1, source: "proposal" });
    assert.deepEqual(r.facts.productionLeadTime, { available: true, appliedViaProposal: 0, source: "manual" });
    assert.deepEqual(r.otherSources, { certificationAvailable: false, costBasisAvailable: false, samplePolicyConfigured: true, minimumMarginConfigured: true, historicalQuotes: 9, productCategories: 2 });
    // 6 份快照：i=2、5 是跟进；首封 i=0,1,3,4，其中 i=0、4 含 MOQ
    assert.deepEqual([r.drafts.firstReplies, r.drafts.pendingMoq], [4, 2]);
    assert.deepEqual(r.proposals.window, { created: 3, pending: 1, applied: 1, rejected: 0, expired: 1, other: 0 });
    // 默认 policy（什么都没配）→ MOQ / 周期不可引用、样品政策未配置、最低毛利未配置
    const bare = await getV2Readiness("org_srv", fakeDeps({ policy: DEFAULT_REVENUE_SPINE_POLICY }).deps);
    assert.deepEqual(bare.verdict.unmet, ["moq_available", "production_lead_time_available"]);
    assert.deepEqual([bare.otherSources.samplePolicyConfigured, bare.otherSources.minimumMarginConfigured], [false, false]);
    // 只配了样品时效、没配大货周期：条件 2 已满足、条件 3 未满足
    const sampleOnly: RevenueSpinePolicy = {
      ...DEFAULT_REVENUE_SPINE_POLICY,
      businessProfile: mergeBusinessProfile(DEFAULT_REVENUE_SPINE_POLICY.businessProfile, {
        commercialFacts: { moq: { quantity: 100, unit: "pcs", per: "style" }, sampleLeadTime: { stockDays: 3, customDaysMin: 7, customDaysMax: 10 } },
      }),
    };
    const so = await getV2Readiness("org_srv", fakeDeps({ policy: sampleOnly }).deps);
    assert.deepEqual(
      so.conditions.map((c) => c.status),
      ["met", "met", "not_met", "not_measurable"],
    );
  });

  await ok("提案终态口径与 A-4 工作量面板一致：超时清理的 failed + 已过期算过期；取消 / 作废 / 执行失败 / 认领中记其他；值未变的执行完成算已批准", () => {
    const row = (status: string, failureReason: string | null = null, decidedById: string | null = null, expiresAt = later) => ({ status, failureReason, decidedById, expiresAt });
    const cases: Array<[ReturnType<typeof row>, string]> = [
      [row("executed", null, "u1"), "applied"],
      [row("rejected", null, "u1"), "rejected"],
      [row("pending"), "pending"],
      [row("pending", null, null, daysAgo(1)), "expired"], // 已过有效期、还没被清理
      [row("pending", null, null, NOW), "expired"],
      [row("failed", "已过期", null, daysAgo(1)), "expired"], // approval-timeout 清理过的
      [row("failed", "已取消", "u1"), "other"],
      [row("failed", "执行失败：网络", "u1"), "other"],
      [row("approved", null, "u1"), "other"],
      [row("rejected", "关联任务已取消（run cancelled）", "u1"), "other"],
    ];
    for (const [r, want] of cases) assert.equal(proposalBucketOf(r, NOW), want, JSON.stringify(r));
  });

  await ok("同一审批两份快照只算一份（保留最新）；没有 targetId 的照算", () => {
    const rows = [
      { targetId: "pa1", afterData: "new" },
      { targetId: "pa1", afterData: "old" },
      { targetId: null, afterData: "x" },
      { targetId: null, afterData: "y" },
      { targetId: "pa2", afterData: "z" },
    ];
    assert.deepEqual(dedupeSnapshots(rows).map((r) => r.afterData), ["new", "x", "y", "z"]);
  });

  await ok("端到端：同一审批的两份快照只计一封首封", async () => {
    const base = fakeDeps().deps;
    const snap = JSON.stringify({ version: 1, followUpStep: null, pendingInternalConfirmation: ["MOQ", "pricing"] });
    const r = await getV2Readiness("org_srv", { ...base, snapshots: async () => [{ targetId: "pa1", afterData: snap }, { targetId: "pa1", afterData: snap }, { targetId: "pa2", afterData: snap }] });
    assert.deepEqual([r.drafts.firstReplies, r.drafts.pendingMoq], [2, 2]);
  });

  await ok("读取上限：快照 301 条只统计最近 300 条并标 sampled；提案 / 写入审计读满标截断", async () => {
    const r = await getV2Readiness("org_srv", fakeDeps({ snapshots: 301, proposals: 2001, applied: 2001 }).deps);
    assert.equal(r.drafts.sampled, true);
    assert.equal(r.drafts.firstReplies, 200); // 300 条里每 3 条 1 条跟进
    assert.equal(r.proposals.window.created, 2000);
    assert.deepEqual([r.proposals.truncated, r.proposals.appliedAuditTruncated], [true, true]);
    assert.equal(r.facts.moq.appliedViaProposal, 2000);
    const small = await getV2Readiness("org_srv", fakeDeps().deps);
    assert.deepEqual([small.drafts.sampled, small.proposals.truncated, small.proposals.appliedAuditTruncated], [false, false, false]);
  });

  await ok("场景「响应不含值」：配了 MOQ / 周期 / 最低毛利 / 港口 / 落款 / 目录，提案载荷与草稿正文含数量、买家与邮箱 → 序列化后的响应一个都不出现", async () => {
    const json = JSON.stringify(await getV2Readiness("org_srv", fakeDeps().deps));
    for (const v of ["987654", "611", "833", "0.4321", "555555", "Exampleport", "Sales Director", "+86 138", "example-home.example", "catalog.pdf", "stock samples", "Mark", "mark@buyer", "secret body", "Example Buyer", "evidence", "opp_1", "pcs", "colour", "valueKey"]) {
      assert.ok(!json.includes(v), v);
    }
  });

  await ok("场景「组织范围与只读」：读模型与接口不调用任何写入方法；接口用 resolveRevenueAccess 解析组织、不读请求参数", () => {
    const model = strip(read("src/lib/revenue-spine/v2-readiness-read-model.ts"));
    const route = strip(read("src/app/api/revenue/v2-readiness/route.ts"));
    for (const src of [model, route, strip(read("src/lib/revenue-spine/v2-readiness.ts"))]) {
      assert.doesNotMatch(src, /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|publishRevenueSpineRule|requestApproval|logAudit|createNotification|\$executeRaw/);
    }
    assert.match(route, /const access = await resolveRevenueAccess\(request, REVENUE_READ_KEYS\);\s*if \(!access\.ok\) return access\.response;\s*const report = await getV2Readiness\(access\.orgId\);/);
    assert.match(route, /export const dynamic = "force-dynamic";/);
    assert.doesNotMatch(route, /searchParams|request\.json|export async function (POST|PUT|PATCH|DELETE)/);
    // 只取统计需要的列
    assert.match(model, /select: \{ status: true, expiresAt: true, failureReason: true, decidedById: true, payload: true \}/);
    assert.match(model, /select: \{ afterData: true \}/);
    assert.match(model, /select: \{ targetId: true, afterData: true \}/);
    // 每个默认查询都经带 orgId 的条件构造函数（防止回归成不带组织的字面量）
    for (const re of [
      /db\.pendingAction\.findFirst\(\{ where: anyProposalWhere\(orgId\),/,
      /db\.pendingAction\.findMany\(\{\s*where: windowProposalWhere\(orgId, since\),/,
      /db\.auditLog\.findMany\(\{\s*where: appliedAuditWhere\(orgId\),/,
      /db\.auditLog\.findMany\(\{\s*where: snapshotAuditWhere\(orgId, since\),/,
    ]) {
      assert.match(model, re);
    }
    assert.equal(model.match(/db\.(pendingAction|auditLog|tradeQuote|salesQuote)\.(findFirst|findMany|count)\(/g)?.length, 6);
    assert.match(model, /db\.tradeQuote\.count\(\{ where: quoteCountWhere\(orgId\) \}\), db\.salesQuote\.count\(\{ where: quoteCountWhere\(orgId\) \}\)/);
  });

  console.log(`\nv2-readiness: ${pass} passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
