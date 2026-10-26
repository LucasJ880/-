/**
 * Revenue Spine — 商务事实提案（B-2，openspec change fde-fact-proposals）测试：纯函数 + 假依赖 + 源码静态断言，无 DB。
 *   新增行对齐与证据脱敏、起卡判定（空 / 相同 / 冲突 / 港口并集 / 落款合并 / 待审批 / 24 小时 / 驳回）、卡片内容、
 *   子字段沿用当前值、过不了合并规则不起卡、审批人挑选、起卡器、认领前角色门（按 User.role，审批中心传的是组织角色）、
 *   微信白名单、执行器在最新配置上重新合并与非法值、草稿引用（unavailable → available）、类型注册
 * 运行：npx tsx src/lib/revenue-spine/__tests__/fact-proposals.test.ts
 *
 * 公开仓库：只用虚构企业与域名。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isWeChatConfirmableActionType, WECHAT_CONFIRM_POLICY } from "@/lib/ai-grader/actions/wechat-confirm-policy";
import { postForPendingActionType } from "@/lib/cockpit/posts";
import { FACT_PROPOSAL_DENIED, approverRoleDenial, canApproveCommercialFact, requiresPlatformApproverRole } from "@/lib/pending-actions/approver-roles";
import { DEFAULT_PRODUCTION_STARTS_FROM } from "../fact-extract";
import {
  FACT_APPLIED_AUDIT_ACTION,
  FACT_PROPOSAL_COOLDOWN_MS,
  FACT_PROPOSAL_TTL_HOURS,
  FACT_PROPOSAL_TYPE,
  applyCommercialFact,
  buildFactProposalApproval,
  execProposeCommercialFact,
  extractFromReply,
  factAppliedCleanly,
  pendingProposalWhere,
  pickFactApprover,
  proposalAppliesCleanly,
  proposedValueFor,
  planFactProposals,
  proposalFieldOf,
  proposeCommercialFacts,
  recentProposalWhere,
  rejectedKey,
  rejectedProposalWhere,
  type ApproverCandidate,
  type FactExecDeps,
  type FactProposalDeps,
  type FactProposalPayload,
  type FactWithEvidence,
} from "../fact-proposals";
import { getLeadTime, getMOQ } from "../factory-knowledge";
import { DEFAULT_REVENUE_SPINE_POLICY, EMPTY_COMMERCIAL_FACTS, type BusinessProfile, type CommercialFacts, type RevenueSpinePolicy } from "../policy";

let pass = 0;
async function ok(name: string, fn: () => void | Promise<void>) {
  await fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

const ORG = "org_sunny_home_deco";
const NOW = new Date("2026-10-26T12:00:00Z");
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");
const BUYER = { contactName: "John Smith", companyName: "Acme Home Ltd", recipientEmail: "john@acme-home.example" };

/** FDE 草稿快照（已替换买家信息） */
const DRAFT = [
  "Hi {{buyer_contact}},",
  "",
  "Thank you for your inquiry about bathrobes.",
  "Loading ports: Ningbo.",
  "",
  "Could you share the quantity per color?",
  "",
  "Best regards,",
  "Lucy",
].join("\n");

/** 销售在外贸收件箱的人工回复（原文） */
const MANUAL = [
  "Hi John,",
  "",
  "Thank you for your inquiry about bathrobes.",
  "Loading ports: Ningbo.",
  "John, our MOQ is 500 pcs per color.",
  "Samples can be ready in 7-10 days.",
  "",
  "Best regards,",
  "Lucy",
  "Sales Manager",
  "WhatsApp: +86 138 0013 8000",
  "",
  "On Mon, Oct 26, 2026 at 9:00 AM John Smith <john@acme-home.example> wrote:",
  "> We need 3000 pcs. Our site www.acme-home.example",
].join("\n");

const facts = (current: Partial<CommercialFacts> = {}): CommercialFacts => ({ ...EMPTY_COMMERCIAL_FACTS, ...current });

function fact(f: Partial<FactWithEvidence> & Pick<FactWithEvidence, "field" | "value">): FactWithEvidence {
  return { lineIndex: 0, evidence: "evidence line", ...f } as FactWithEvidence;
}

const noLimits = { pendingFields: new Set<string>(), recentFields: new Set<string>(), rejectedKeys: new Set<string>() };

async function main() {
  console.log("\n抽取：新增行与证据");

  await ok("只抽人工回复相对草稿新增的行：MOQ 与样品时效；草稿里已有的港口不抽；引用的买家原信不抽", () => {
    const got = extractFromReply({ snapshotBody: DRAFT, sentRaw: MANUAL, buyer: BUYER });
    assert.deepEqual(got.map((f) => f.field), ["moq", "sampleLeadTime", "signature"]);
    const moq = got.find((f) => f.field === "moq")!;
    assert.deepEqual(moq.value, { quantity: 500, unit: "pcs", per: "color" });
  });

  await ok("证据句替换买家信息（联系人名）；签名的 WhatsApp 从原文取（脱敏会把它当电话替换掉）", () => {
    const got = extractFromReply({ snapshotBody: DRAFT, sentRaw: MANUAL, buyer: BUYER });
    const moq = got.find((f) => f.field === "moq")!;
    assert.equal(moq.evidence, "{{buyer_contact}}, our MOQ is 500 pcs per color.");
    assert.ok(!moq.evidence.includes("John"));
    const sig = got.find((f) => f.field === "signature")!;
    assert.deepEqual(sig.value, { title: "Sales Manager", whatsapp: "+86 138 0013 8000", website: null });
  });

  await ok("没有快照：整封回复都算新增（草稿里已有的港口也会抽到）", () => {
    const got = extractFromReply({ snapshotBody: null, sentRaw: MANUAL, buyer: BUYER });
    assert.ok(got.some((f) => f.field === "loadingPorts"));
  });

  await ok("含价格的新增行不产任何事实", () => {
    const sent = DRAFT.replace("Loading ports: Ningbo.", "Loading ports: Ningbo.\nMOQ 500 pcs, unit price USD 4.80.");
    assert.deepEqual(extractFromReply({ snapshotBody: DRAFT, sentRaw: sent, buyer: BUYER }), []);
  });

  console.log("\n起卡判定");

  await ok("场景「当前为空」：未配置 MOQ → 起 moq 卡，当前值为空", () => {
    const r = planFactProposals({ facts: [fact({ field: "moq", value: { quantity: 500, unit: "pcs", per: "color" } })], current: facts(), ...noLimits });
    assert.equal(r.proposals.length, 1);
    assert.deepEqual(r.proposals[0], {
      field: "moq",
      extractedValue: { quantity: 500, unit: "pcs", per: "color" },
      proposedValue: { quantity: 500, unit: "pcs", per: "color" },
      currentValue: null,
      valueKey: "500|pcs|color",
      evidence: "evidence line",
    });
  });

  await ok("场景「与当前相同」：已配置 500 pcs / color → 不起卡（大小写不同也算相同）", () => {
    const r = planFactProposals({
      facts: [fact({ field: "moq", value: { quantity: 500, unit: "pcs", per: "color" } })],
      current: facts({ moq: { quantity: 500, unit: "PCS", per: "Color" } }),
      ...noLimits,
    });
    assert.deepEqual(r, { proposals: [], skipped: [{ field: "moq", reason: "same" }] });
  });

  await ok("冲突：已配置 1000 pcs / style、抽到 500 pcs / color → 起卡，当前值带上", () => {
    const r = planFactProposals({
      facts: [fact({ field: "moq", value: { quantity: 500, unit: "pcs", per: "color" } })],
      current: facts({ moq: { quantity: 1000, unit: "pcs", per: "style" } }),
      ...noLimits,
    });
    assert.deepEqual(r.proposals[0].currentValue, { quantity: 1000, unit: "pcs", per: "style" });
  });

  await ok("装运港：有新港口才起卡，提议值 = 现有 ∪ 新增（现有写法保留）", () => {
    const add = planFactProposals({ facts: [fact({ field: "loadingPorts", value: ["Ningbo", "Shanghai"] })], current: facts({ loadingPorts: ["宁波"] }), ...noLimits });
    assert.deepEqual(add.proposals[0].proposedValue, ["宁波", "Shanghai"]);
    const same = planFactProposals({ facts: [fact({ field: "loadingPorts", value: ["Ningbo"] })], current: facts({ loadingPorts: ["宁波"] }), ...noLimits });
    assert.deepEqual(same.skipped, [{ field: "loadingPorts", reason: "same" }]);
  });

  await ok("落款：只补当前为空的子字段（已配置的职位 / WhatsApp 不来回改）", () => {
    const fill = planFactProposals({
      facts: [fact({ field: "signature", value: { title: "Export Manager", whatsapp: "+86 2", website: null } })],
      current: facts({ signature: { title: null, whatsapp: "+86 1", website: "www.example-home.example" } }),
      ...noLimits,
    });
    assert.deepEqual(fill.proposals[0].proposedValue, { title: "Export Manager", whatsapp: "+86 1", website: "www.example-home.example" });
    const set = planFactProposals({
      facts: [fact({ field: "signature", value: { title: "Export Manager", whatsapp: "+86 2", website: null } })],
      current: facts({ signature: { title: "Sales", whatsapp: "+86 1", website: null } }),
      ...noLimits,
    });
    assert.deepEqual(set.skipped, [{ field: "signature", reason: "same" }]);
  });

  await ok("回复里没写的子字段沿用当前值：样品只写现货、大货没写起算点、起订量没写按什么计 → 与当前相同则不起卡", () => {
    const cur = facts({
      sampleLeadTime: { stockDays: 3, customDaysMin: 7, customDaysMax: 10 },
      productionLeadTime: { daysMin: 35, daysMax: 45, startsFrom: "deposit received" },
      moq: { quantity: 500, unit: "pcs", per: "style" },
    });
    const r = planFactProposals({
      facts: [
        fact({ field: "sampleLeadTime", value: { stockDays: 3, customDaysMin: null, customDaysMax: null } }),
        fact({ field: "productionLeadTime", value: { daysMin: 35, daysMax: 45, startsFrom: null } }),
        fact({ field: "moq", value: { quantity: 500, unit: "pcs", per: null } }),
      ],
      current: cur,
      ...noLimits,
    });
    assert.deepEqual(r, {
      proposals: [],
      skipped: [
        { field: "sampleLeadTime", reason: "same" },
        { field: "productionLeadTime", reason: "same" },
        { field: "moq", reason: "same" },
      ],
    });
    // 只改了现货样天数：定制样区间保留
    assert.deepEqual(proposedValueFor("sampleLeadTime", { stockDays: 2, customDaysMin: null, customDaysMax: null }, cur.sampleLeadTime), { stockDays: 2, customDaysMin: 7, customDaysMax: 10 });
    // 天数变了、没写起算点：沿用当前起算点；当前也没有时用默认起算点
    assert.deepEqual(proposedValueFor("productionLeadTime", { daysMin: 30, daysMax: 40, startsFrom: null }, cur.productionLeadTime), { daysMin: 30, daysMax: 40, startsFrom: "deposit received" });
    assert.deepEqual(proposedValueFor("productionLeadTime", { daysMin: 30, daysMax: 40, startsFrom: null }, null), { daysMin: 30, daysMax: 40, startsFrom: DEFAULT_PRODUCTION_STARTS_FROM });
    // 起订量没写按什么计：沿用当前；当前也没有时用合并规则的默认 style
    assert.deepEqual(proposedValueFor("moq", { quantity: 800, unit: "pcs", per: null }, cur.moq), { quantity: 800, unit: "pcs", per: "style" });
    assert.deepEqual(proposedValueFor("moq", { quantity: 800, unit: "pcs", per: null }, null), { quantity: 800, unit: "pcs", per: "style" });
  });

  await ok("过不了商务事实合并规则的提议值不起卡（批准后才失败会把卡消耗成 failed）", () => {
    const r = planFactProposals({
      facts: [fact({ field: "catalogUrl", value: "http://example-home.example/catalog" }), fact({ field: "moq", value: { quantity: 0, unit: "pcs", per: "color" } })],
      current: facts(),
      ...noLimits,
    });
    assert.deepEqual(r.skipped, [
      { field: "catalogUrl", reason: "invalid" },
      { field: "moq", reason: "invalid" },
    ]);
    assert.equal(proposalAppliesCleanly(facts(), "catalogUrl", "https://www.example-home.example/catalog"), true);
  });

  await ok("场景「限流」：同字段已有待审批卡 → pending；24 小时内起过 → cooldown", () => {
    const f = [fact({ field: "moq", value: { quantity: 500, unit: "pcs", per: "color" } })];
    assert.deepEqual(planFactProposals({ facts: f, current: facts(), ...noLimits, pendingFields: new Set(["moq"]) }).skipped, [{ field: "moq", reason: "pending" }]);
    assert.deepEqual(planFactProposals({ facts: f, current: facts(), ...noLimits, recentFields: new Set(["moq"]) }).skipped, [{ field: "moq", reason: "cooldown" }]);
    assert.equal(FACT_PROPOSAL_COOLDOWN_MS, 24 * 3_600_000);
  });

  await ok("场景「被驳回过」：同一（字段，提议值）驳回过 → 不起；换一个值仍可起", () => {
    const rejected = new Set([rejectedKey("moq", "500|pcs|color")]);
    const a = planFactProposals({ facts: [fact({ field: "moq", value: { quantity: 500, unit: "pcs", per: "color" } })], current: facts(), ...noLimits, rejectedKeys: rejected });
    assert.deepEqual(a.skipped, [{ field: "moq", reason: "rejected" }]);
    const b = planFactProposals({ facts: [fact({ field: "moq", value: { quantity: 800, unit: "pcs", per: "color" } })], current: facts(), ...noLimits, rejectedKeys: rejected });
    assert.equal(b.proposals.length, 1);
  });

  await ok("每个字段只起一张卡（同一字段多个值取第一个）", () => {
    const r = planFactProposals({
      facts: [fact({ field: "moq", value: { quantity: 500, unit: "pcs", per: "color" } }), fact({ field: "moq", value: { quantity: 300, unit: "pcs", per: "color" } })],
      current: facts(),
      ...noLimits,
    });
    assert.equal(r.proposals.length, 1);
    assert.equal(r.proposals[0].valueKey, "500|pcs|color");
  });

  console.log("\n卡片");

  await ok("场景「卡片内容」：中文标题与预览写明当前 → 提议，证据句已替换买家信息；载荷不含整封回复 / 买家邮箱 / 金额", () => {
    const [p] = extractFromReply({ snapshotBody: DRAFT, sentRaw: MANUAL, buyer: BUYER })
      .filter((f) => f.field === "moq")
      .map((f) => planFactProposals({ facts: [f], current: facts(), ...noLimits }).proposals[0]);
    const card = buildFactProposalApproval(p, { orgId: ORG, opportunityId: "opp_1", sourcePendingActionId: "pa_draft_1" });
    assert.equal(card.title, "商务事实提案：起订量 500 pcs / color");
    assert.match(card.preview, /^起订量：当前 未配置 → 提议 500 pcs \/ color\n/);
    assert.match(card.preview, /\{\{buyer_contact\}\}, our MOQ is 500 pcs per color\./);
    assert.equal(card.idempotencyKey, "revenue-spine:fact:moq:500|pcs|color:pa_draft_1");
    assert.deepEqual(card.payload.metadata, { orgId: ORG, opportunityId: "opp_1", sourcePendingActionId: "pa_draft_1" });
    const json = JSON.stringify(card);
    for (const leak of ["John", "Acme", "john@acme-home.example", "Samples can be ready", "USD", "$"]) assert.ok(!json.includes(leak), leak);
  });

  console.log("\n起卡器");

  const OWNER_BOSS: ApproverCandidate = { userId: "u_boss", platformRole: "boss", isOwner: true, active: true, joinedAt: null };

  function fakeProposalDeps(over: Partial<{ current: CommercialFacts; pending: string[]; recent: string[]; rejected: string[]; candidates: ApproverCandidate[]; fail: boolean }> = {}) {
    const created: Array<Parameters<FactProposalDeps["createApproval"]>[0]> = [];
    const since: Date[] = [];
    let queried = 0;
    const deps: FactProposalDeps = {
      loadCurrentFacts: async () => {
        queried++;
        return over.current ?? facts();
      },
      pendingFields: async () => over.pending ?? [],
      recentFields: async (_orgId, s) => {
        since.push(s);
        return over.recent ?? [];
      },
      rejectedKeys: async () => over.rejected ?? [],
      approverCandidates: async () => over.candidates ?? [OWNER_BOSS],
      createApproval: async (input) => {
        created.push(input);
        return over.fail ? { ok: false, error: "x" } : { ok: true, id: `pa_fact_${created.length}` };
      },
    };
    return { deps, created, since, queried: () => queried };
  }

  const input = { orgId: ORG, opportunityId: "opp_1", sourcePendingActionId: "pa_draft_1", principalUserId: "u_sales", snapshotBody: DRAFT, sentRaw: MANUAL, buyer: BUYER, now: NOW };

  await ok("起卡：每个字段一张，审批人为能批的组织所有者，创建人为发出人工回复的人；24 小时窗口从 now 往前算", async () => {
    const f = fakeProposalDeps();
    const r = await proposeCommercialFacts(input, f.deps);
    assert.equal(r.extracted, 3);
    assert.deepEqual(r.created, ["pa_fact_1", "pa_fact_2", "pa_fact_3"]);
    assert.deepEqual(f.created.map((c) => c.payload.field), ["moq", "sampleLeadTime", "signature"]);
    assert.ok(f.created.every((c) => c.approverUserId === "u_boss" && c.principalUserId === "u_sales" && c.orgId === ORG));
    assert.equal(f.since[0].getTime(), NOW.getTime() - FACT_PROPOSAL_COOLDOWN_MS);
  });

  await ok("起卡：已配置相同 MOQ、样品有待审批卡 → 只起落款卡；创建失败计数", async () => {
    const f = fakeProposalDeps({ current: facts({ moq: { quantity: 500, unit: "pcs", per: "color" } }), pending: ["sampleLeadTime"], fail: true });
    const r = await proposeCommercialFacts(input, f.deps);
    assert.deepEqual(r.skipped, [
      { field: "moq", reason: "same" },
      { field: "sampleLeadTime", reason: "pending" },
    ]);
    assert.equal(f.created.length, 1);
    assert.deepEqual([r.created.length, r.failed], [0, 1]);
  });

  await ok("挑审批人：所有者（能批时）→ 在职 boss → 在职 admin，同类按入职先后；没有能批的人 → null", () => {
    const at = (d: string) => new Date(`2026-0${d}-01T00:00:00Z`);
    const c = (userId: string, platformRole: string | null, o: Partial<ApproverCandidate> = {}): ApproverCandidate => ({ userId, platformRole, isOwner: false, active: true, joinedAt: at("1"), ...o });
    assert.equal(pickFactApprover([c("u_admin", "admin"), c("u_owner", "boss", { isOwner: true, joinedAt: null })]), "u_owner");
    // 所有者平台角色批不了 → 不选所有者（否则卡永远批不了）
    assert.equal(pickFactApprover([c("u_owner", "sales", { isOwner: true }), c("u_admin", "admin"), c("u_boss2", "boss", { joinedAt: at("3") }), c("u_boss1", "boss", { joinedAt: at("2") })]), "u_boss1");
    assert.equal(pickFactApprover([c("u_owner", "sales", { isOwner: true }), c("u_admin", "admin")]), "u_admin");
    assert.equal(pickFactApprover([c("u_boss", "boss", { active: false }), c("u_sales", "sales")]), null);
    assert.equal(pickFactApprover([]), null);
  });

  await ok("组织里没有能批的人：不起卡，逐字段记 no_approver", async () => {
    const f = fakeProposalDeps({ candidates: [{ userId: "u_owner", platformRole: "sales", isOwner: true, active: true, joinedAt: null }] });
    const r = await proposeCommercialFacts(input, f.deps);
    assert.equal(f.created.length, 0);
    assert.deepEqual(r.skipped, [
      { field: "moq", reason: "no_approver" },
      { field: "sampleLeadTime", reason: "no_approver" },
      { field: "signature", reason: "no_approver" },
    ]);
  });

  await ok("没有可抽的事实：不查商务事实、不起卡", async () => {
    const f = fakeProposalDeps();
    const r = await proposeCommercialFacts({ ...input, sentRaw: DRAFT.replace("{{buyer_contact}}", "John") }, f.deps);
    assert.deepEqual([r.extracted, f.queried(), f.created.length], [0, 0, 0]);
  });

  await ok("查询条件：待审批（未过期）/ 24 小时内 / 已驳回，都限定组织与类型；载荷字段解析", () => {
    assert.deepEqual(pendingProposalWhere(ORG, NOW), { orgId: ORG, type: FACT_PROPOSAL_TYPE, status: "pending", expiresAt: { gt: NOW } });
    assert.deepEqual(recentProposalWhere(ORG, NOW), { orgId: ORG, type: FACT_PROPOSAL_TYPE, createdAt: { gte: NOW } });
    assert.deepEqual(rejectedProposalWhere(ORG), { orgId: ORG, type: FACT_PROPOSAL_TYPE, status: "rejected" });
    assert.equal(proposalFieldOf({ field: "moq" }), "moq");
    assert.equal(proposalFieldOf({ field: "price" }), null);
    assert.equal(proposalFieldOf(null), null);
  });

  await ok("默认起卡依赖：requestApproval 用新类型、l2_soft、7 天有效期、审批人按平台角色挑选、按卡幂等", () => {
    const src = strip(read("src/lib/revenue-spine/fact-proposals.ts"));
    assert.equal(FACT_PROPOSAL_TTL_HOURS, 168);
    assert.match(src, /actionType: FACT_PROPOSAL_TYPE,/);
    assert.match(src, /risk: \{ vocabulary: "agent-core\.tool-risk", value: "l2_soft", requiresApproval: true \}/);
    assert.match(src, /ttlHours: FACT_PROPOSAL_TTL_HOURS,/);
    assert.match(src, /approver: \{ approverUserId: input\.approverUserId \?\? undefined, requiredRole: "boss" \}/);
    assert.match(src, /idempotencyKey: input\.idempotencyKey,/);
    assert.match(src, /select: \{ ownerId: true, owner: \{ select: \{ role: true \} \} \}/);
    assert.match(src, /where: \{ orgId, status: "active", user: \{ role: \{ in: \["boss", "admin", "super_admin"\] \} \} \}/);
  });

  await ok("端到端：人工回复作废 → 记录器写改稿事件 → 起 moq / 样品 / 落款卡（假依赖）", async () => {
    const { recordInquiryReplyFeedback, buildDraftSnapshot } = await import("../fde/draft-feedback");
    const snapshot = buildDraftSnapshot({
      orgId: ORG,
      actorUserId: "u_owner",
      pendingActionId: "pa_draft_1",
      opportunityId: "opp_1",
      followUpStep: null,
      subject: "Re: bathrobes",
      body: DRAFT.replace("{{buyer_contact}}", "John"),
      language: "en",
      buyer: BUYER,
      guardrailViolations: [],
      factsUsed: [],
      pendingInternalConfirmation: [],
      templateOnly: true,
    });
    const f = fakeProposalDeps();
    const events: unknown[] = [];
    const r = await recordInquiryReplyFeedback("pa_draft_1", {
      loadAction: async () => ({
        id: "pa_draft_1",
        orgId: ORG,
        type: "sales.send_inquiry_reply",
        status: "failed",
        failureReason: "SUPERSEDED_BY_MANUAL_REPLY tradeMessageId=tm outboundInteractionId=ix triggeredBy=u_sales terminationMode=system_superseded",
        decidedById: null,
        approverUserId: "u_owner",
        createdById: "u_owner",
        payload: { opportunityId: "opp_1", body: DRAFT, metadata: { orgId: ORG } },
      }),
      loadManualReply: async () => ({ content: MANUAL, source: "trade_inbox.reply" }),
      loadSnapshots: async () => [snapshot],
      // 买家电话与回复里的 WhatsApp 相同 → 落款只剩职位
      loadBuyer: async () => ({ ...BUYER, phone: "+86 138 0013 8000", testInquiry: false }),
      hasFeedback: async () => false,
      createFeedback: async (input) => {
        events.push(input);
        return { id: "ev_1" };
      },
      withLock: async (_id, fn) => fn(),
      afterRecorded: async (ctx) => {
        await proposeCommercialFacts({ ...ctx, now: NOW }, f.deps);
      },
    });
    assert.equal(r.status, "recorded");
    assert.equal(events.length, 1);
    assert.deepEqual(f.created.map((c) => c.payload.field), ["moq", "sampleLeadTime", "signature"]);
    assert.ok(f.created.every((c) => c.principalUserId === "u_sales" && c.payload.sourcePendingActionId === "pa_draft_1"));
    assert.deepEqual(f.created[2].payload.proposedValue, { title: "Sales Manager", whatsapp: null, website: null });
  });

  console.log("\n审批权限");

  await ok("场景「销售角色批准」：sales / trade / manager 被拒；admin / super_admin / boss 放行；其它类型不受影响", () => {
    for (const role of ["sales", "trade", "manager", "user", null, undefined]) {
      assert.equal(approverRoleDenial(FACT_PROPOSAL_TYPE, role), FACT_PROPOSAL_DENIED, String(role));
    }
    for (const role of ["admin", "super_admin", "boss"]) {
      assert.equal(approverRoleDenial(FACT_PROPOSAL_TYPE, role), null, role);
      assert.equal(canApproveCommercialFact(role), true);
    }
    assert.equal(approverRoleDenial("sales.send_inquiry_reply", "sales"), null);
    assert.equal(FACT_PROPOSAL_DENIED, "仅企业负责人或管理员可批准商务事实提案");
  });

  await ok("执行器：角色门在通用权限之后、CAS 认领之前（无权时审批保持待审批）；按 userId 读 User.role，不用 ctx.role；驳回不经过它", () => {
    const src = strip(read("src/lib/pending-actions/executor.ts"));
    const exec = src.slice(src.indexOf("export async function executePendingAction"), src.indexOf("export async function rejectPendingAction"));
    assert.ok(requiresPlatformApproverRole(FACT_PROPOSAL_TYPE) && !requiresPlatformApproverRole("sales.send_inquiry_reply"));
    assert.match(exec, /if \(requiresPlatformApproverRole\(action\.type\)\) \{\s*const approver = await db\.user\.findUnique\(\{ where: \{ id: ctx\.userId \}, select: \{ role: true \} \}\);\s*const roleDenial = approverRoleDenial\(action\.type, approver\?\.role\);/);
    assert.doesNotMatch(src, /approverRoleDenial\(action\.type, ctx\.role\)/);
    const gate = exec.indexOf("const roleDenial = approverRoleDenial(action.type, approver?.role);");
    const teamGate = exec.indexOf("canDecideTeamApproval(action, ctx)");
    const claim = exec.indexOf('status: "approved"');
    assert.ok(teamGate > 0 && gate > teamGate && claim > gate, JSON.stringify({ teamGate, gate, claim }));
    const reject = src.slice(src.indexOf("export async function rejectPendingAction"));
    assert.ok(!reject.slice(0, reject.indexOf("\n}\n")).includes("approverRoleDenial"));
    assert.match(exec, /case "revenue_spine\.propose_commercial_fact": \{\s*const \{ execProposeCommercialFact \} = await import\("@\/lib\/revenue-spine\/fact-proposals"\);/);
  });

  await ok("审批中心传给执行器的是组织成员角色：所以角色门不能信 ctx.role（锁定这条前提）", () => {
    const decision = strip(read("src/lib/capabilities/approvals/decision.ts"));
    assert.match(decision, /approveApprovalItem\("pending_action", row\.id, \{\s*userId: access\.userId,\s*role: access\.orgRole,/);
  });

  await ok("场景「微信确认」：该类型只能网页审批，不在回数字确认白名单", () => {
    assert.equal(WECHAT_CONFIRM_POLICY[FACT_PROPOSAL_TYPE], "web_only_review");
    assert.equal(isWeChatConfirmableActionType(FACT_PROPOSAL_TYPE), false);
  });

  await ok("类型注册：联合成员、岗位认领（询盘销售）", () => {
    assert.match(read("src/lib/pending-actions/types.ts"), /\| "revenue_spine\.propose_commercial_fact";/);
    assert.equal(postForPendingActionType(FACT_PROPOSAL_TYPE), "inbound_sales");
  });

  console.log("\n执行器");

  function fakeExecDeps(over: Partial<{ member: boolean; policy: RevenueSpinePolicy; platformRole: string | null }> = {}) {
    const published: Array<{ orgId: string; profile: BusinessProfile; userId: string }> = [];
    const audits: Array<Parameters<FactExecDeps["audit"]>[0]> = [];
    const deps: FactExecDeps = {
      platformRole: async () => (over.platformRole === undefined ? "boss" : over.platformRole),
      membershipActive: async () => over.member ?? true,
      isSuperAdmin: (role) => role === "super_admin" || role === "admin",
      loadPolicy: async () => over.policy ?? DEFAULT_REVENUE_SPINE_POLICY,
      publishProfile: async (orgId, profile, userId) => {
        published.push({ orgId, profile, userId });
        return { version: 7 };
      },
      audit: async (a) => {
        audits.push(a);
      },
    };
    return { deps, published, audits };
  }

  const payload = (over: Partial<FactProposalPayload> = {}): FactProposalPayload => ({
    field: "moq",
    proposedValue: { quantity: 500, unit: "pcs", per: "color" },
    currentValue: null,
    valueKey: "500|pcs|color",
    evidence: "our MOQ is 500 pcs per color.",
    opportunityId: "opp_1",
    sourcePendingActionId: "pa_draft_1",
    metadata: { orgId: ORG, opportunityId: "opp_1", sourcePendingActionId: "pa_draft_1" },
    ...over,
  });
  // 审批中心传进来的 role 是组织成员角色：执行器不看它，按 userId 读平台角色
  const boss = { userId: "u_boss", role: "org_owner", orgId: ORG };

  await ok("场景「从未配置到可用」：批准 → 合并进商务事实并发布新版本，其余字段不变，记审计", async () => {
    const f = fakeExecDeps();
    const r = await execProposeCommercialFact(payload(), boss, "pa_fact_1", f.deps);
    assert.deepEqual(r, { ok: true, resultRef: "business_profile:v7", message: "起订量已写入商务事实，此后 FDE 草稿会引用" });
    assert.equal(f.published.length, 1);
    const profile = f.published[0].profile;
    assert.deepEqual(profile.commercialFacts.moq, { quantity: 500, unit: "pcs", per: "color" });
    const withoutMoq = (c: CommercialFacts) => ({ ...c, moq: null });
    assert.deepEqual(withoutMoq(profile.commercialFacts), withoutMoq(DEFAULT_REVENUE_SPINE_POLICY.businessProfile.commercialFacts));
    assert.deepEqual(f.audits[0].afterData, { field: "moq", valueKey: "500|pcs|color", version: 7, pendingActionId: "pa_fact_1", sourcePendingActionId: "pa_draft_1", opportunityId: "opp_1" });
    assert.deepEqual(f.audits[0].beforeData, { field: "moq", valueKey: null });
    assert.equal(FACT_APPLIED_AUDIT_ACTION, "revenue_spine.commercial_fact.applied");
  });

  await ok("草稿引用：getMOQ / getLeadTime 先 unavailable → 批准合并后 available", () => {
    const before = DEFAULT_REVENUE_SPINE_POLICY;
    assert.equal(getMOQ("bathrobe", before).status, "unavailable");
    assert.equal(getLeadTime("bathrobe", before).status, "unavailable");
    let profile = applyCommercialFact(before.businessProfile, "moq", { quantity: 500, unit: "pcs", per: "color" });
    profile = applyCommercialFact(profile, "productionLeadTime", { daysMin: 35, daysMax: 45, startsFrom: DEFAULT_PRODUCTION_STARTS_FROM });
    const after: RevenueSpinePolicy = { ...before, businessProfile: profile };
    const moq = getMOQ("bathrobe", after);
    assert.equal(moq.status, "available");
    assert.deepEqual(moq.status === "available" ? [moq.value.quantity, moq.value.unit, moq.value.per] : null, [500, "pcs", "color"]);
    assert.equal(getLeadTime("bathrobe", after).status, "available");
  });

  await ok("场景「非法提议值」：数量 0 / 倒置区间被合并规则丢弃 → 执行失败、不发布", async () => {
    for (const bad of [
      payload({ proposedValue: { quantity: 0, unit: "pcs", per: "color" } }),
      payload({ field: "productionLeadTime", proposedValue: { daysMin: 45, daysMax: 30, startsFrom: "x" } }),
    ]) {
      const f = fakeExecDeps();
      const r = await execProposeCommercialFact(bad, boss, "pa_fact_1", f.deps);
      assert.deepEqual([r.ok, r.error, f.published.length], [false, "提议值不合法，未写入商务事实", 0]);
    }
    assert.equal(factAppliedCleanly(applyCommercialFact(DEFAULT_REVENUE_SPINE_POLICY.businessProfile, "moq", { quantity: -1, unit: "pcs", per: "x" }), "moq", { quantity: -1 }), false);
  });

  await ok("执行器防御：缺组织 / 跨组织 / 平台角色非 admin·boss / 非成员 / 未知字段 / 无提议值 → 失败且不发布", async () => {
    const cases: Array<[Partial<FactProposalPayload> | null, typeof boss, { member?: boolean; platformRole?: string | null }, string]> = [
      [{ ...payload(), metadata: undefined as never }, boss, {}, "缺少组织信息，拒绝执行"],
      [payload(), { ...boss, orgId: "org_other" }, {}, "跨组织动作，拒绝执行"],
      [payload(), boss, { platformRole: "sales" }, FACT_PROPOSAL_DENIED],
      [payload(), boss, { platformRole: null }, FACT_PROPOSAL_DENIED],
      // ctx.role 写成 boss 也没用：平台角色是 sales
      [payload(), { ...boss, role: "boss" }, { platformRole: "sales" }, FACT_PROPOSAL_DENIED],
      [payload(), boss, { member: false }, "无权更新该组织的商务事实"],
      [payload({ field: "price" as never }), boss, {}, "未知的商务事实字段"],
      [payload({ proposedValue: null }), boss, {}, "缺少提议值"],
    ];
    for (const [p, ctx, over, error] of cases) {
      const f = fakeExecDeps(over);
      const r = await execProposeCommercialFact(p, ctx, "pa_fact_1", f.deps);
      assert.deepEqual([r.ok, r.error, f.published.length], [false, error, 0], error);
    }
    // 平台管理员不要求组织成员身份
    const f = fakeExecDeps({ member: false, platformRole: "super_admin" });
    assert.equal((await execProposeCommercialFact(payload(), boss, "pa_fact_1", f.deps)).ok, true);
  });

  await ok("审批中心路径：组织角色 org_owner、平台角色 boss → 能批准并写入", async () => {
    const f = fakeExecDeps({ platformRole: "boss" });
    const r = await execProposeCommercialFact(payload(), { userId: "u_boss", role: "org_owner", orgId: ORG }, "pa_fact_1", f.deps);
    assert.equal(r.ok, true);
    assert.equal(f.published.length, 1);
  });

  await ok("批准时在最新配置上重新合并：起卡后老板改过的港口不被覆盖；已是该值时不发布新版本", async () => {
    const withPorts = (ports: string[]): RevenueSpinePolicy => ({
      ...DEFAULT_REVENUE_SPINE_POLICY,
      businessProfile: { ...DEFAULT_REVENUE_SPINE_POLICY.businessProfile, commercialFacts: { ...EMPTY_COMMERCIAL_FACTS, loadingPorts: ports } },
    });
    // 起卡时当前为空 → 提议 Ningbo、Shanghai；批准前老板把港口改成了 Qingdao
    const p = payload({ field: "loadingPorts", extractedValue: ["Ningbo", "Shanghai"], proposedValue: ["Ningbo", "Shanghai"], valueKey: "Ningbo|Shanghai" });
    const f = fakeExecDeps({ policy: withPorts(["Qingdao"]) });
    assert.equal((await execProposeCommercialFact(p, boss, "pa_fact_1", f.deps)).ok, true);
    assert.deepEqual(f.published[0].profile.commercialFacts.loadingPorts, ["Qingdao", "Ningbo", "Shanghai"]);
    assert.equal(f.audits[0].afterData.valueKey, "Ningbo|Qingdao|Shanghai");
    // 批准前已经有这些港口 → 成功但不发布
    const g = fakeExecDeps({ policy: withPorts(["Shanghai", "Ningbo"]) });
    const r = await execProposeCommercialFact(p, boss, "pa_fact_1", g.deps);
    assert.deepEqual([r.ok, r.resultRef, g.published.length, g.audits.length], [true, "business_profile:unchanged", 0, 0]);
  });

  await ok("默认执行依赖：经 publishRevenueSpineRule(business_profile) 发布，审计动作固定", () => {
    const src = strip(read("src/lib/revenue-spine/fact-proposals.ts"));
    assert.match(src, /publishRevenueSpineRule\(\{ orgId, ruleKey: RULE_KEY_BUSINESS_PROFILE, config: profile as unknown as Record<string, unknown>, userId \}\)/);
    assert.match(src, /action: FACT_APPLIED_AUDIT_ACTION,/);
    assert.doesNotMatch(src, /settingsJson/);
  });

  console.log(`\nfact-proposals: ${pass} passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
