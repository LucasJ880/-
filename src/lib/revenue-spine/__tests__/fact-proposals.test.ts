/**
 * Revenue Spine — 商务事实提案（B-2，openspec change fde-fact-proposals）测试：纯函数 + 假依赖 + 源码静态断言，无 DB。
 *   新增行对齐与证据脱敏、起卡判定（空 / 相同 / 冲突 / 港口并集 / 落款合并 / 待审批 / 24 小时 / 驳回）、卡片内容、
 *   起卡器、认领前角色门、微信白名单、执行器合并与非法值、草稿引用（unavailable → available）、类型注册
 * 运行：npx tsx src/lib/revenue-spine/__tests__/fact-proposals.test.ts
 *
 * 公开仓库：只用虚构企业与域名。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isWeChatConfirmableActionType, WECHAT_CONFIRM_POLICY } from "@/lib/ai-grader/actions/wechat-confirm-policy";
import { postForPendingActionType } from "@/lib/cockpit/posts";
import { FACT_PROPOSAL_DENIED, approverRoleDenial, canApproveCommercialFact } from "@/lib/pending-actions/approver-roles";
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
  planFactProposals,
  proposalFieldOf,
  proposeCommercialFacts,
  recentProposalWhere,
  rejectedKey,
  rejectedProposalWhere,
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

  await ok("落款：按子字段合并到现有落款上（只抽到职位时保留现有 WhatsApp / 网站）", () => {
    const r = planFactProposals({
      facts: [fact({ field: "signature", value: { title: "Export Manager", whatsapp: null, website: null } })],
      current: facts({ signature: { title: "Sales", whatsapp: "+86 1", website: "www.example-home.example" } }),
      ...noLimits,
    });
    assert.deepEqual(r.proposals[0].proposedValue, { title: "Export Manager", whatsapp: "+86 1", website: "www.example-home.example" });
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

  function fakeProposalDeps(over: Partial<{ current: CommercialFacts; pending: string[]; recent: string[]; rejected: string[]; owner: string | null; fail: boolean }> = {}) {
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
      ownerUserId: async () => (over.owner === undefined ? "u_boss" : over.owner),
      createApproval: async (input) => {
        created.push(input);
        return over.fail ? { ok: false, error: "x" } : { ok: true, id: `pa_fact_${created.length}` };
      },
    };
    return { deps, created, since, queried: () => queried };
  }

  const input = { orgId: ORG, opportunityId: "opp_1", sourcePendingActionId: "pa_draft_1", principalUserId: "u_sales", snapshotBody: DRAFT, sentRaw: MANUAL, buyer: BUYER, now: NOW };

  await ok("起卡：每个字段一张，审批人为组织所有者，创建人为发出人工回复的人；24 小时窗口从 now 往前算", async () => {
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

  await ok("默认起卡依赖：requestApproval 用新类型、l2_soft、7 天有效期、审批人为组织所有者、按卡幂等", () => {
    const src = strip(read("src/lib/revenue-spine/fact-proposals.ts"));
    assert.equal(FACT_PROPOSAL_TTL_HOURS, 168);
    assert.match(src, /actionType: FACT_PROPOSAL_TYPE,/);
    assert.match(src, /risk: \{ vocabulary: "agent-core\.tool-risk", value: "l2_soft", requiresApproval: true \}/);
    assert.match(src, /ttlHours: FACT_PROPOSAL_TTL_HOURS,/);
    assert.match(src, /approver: \{ approverUserId: input\.approverUserId \?\? undefined, requiredRole: "boss" \}/);
    assert.match(src, /idempotencyKey: input\.idempotencyKey,/);
    assert.match(src, /select: \{ ownerId: true \}/);
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

  await ok("执行器：角色门在通用权限之后、CAS 认领之前（无权时审批保持待审批）；驳回不经过它", () => {
    const src = strip(read("src/lib/pending-actions/executor.ts"));
    const exec = src.slice(src.indexOf("export async function executePendingAction"), src.indexOf("export async function rejectPendingAction"));
    const gate = exec.indexOf("const roleDenial = approverRoleDenial(action.type, ctx.role);");
    const teamGate = exec.indexOf("canDecideTeamApproval(action, ctx)");
    const claim = exec.indexOf('status: "approved"');
    assert.ok(teamGate > 0 && gate > teamGate && claim > gate, JSON.stringify({ teamGate, gate, claim }));
    const reject = src.slice(src.indexOf("export async function rejectPendingAction"));
    assert.ok(!reject.slice(0, reject.indexOf("\n}\n")).includes("approverRoleDenial"));
    assert.match(exec, /case "revenue_spine\.propose_commercial_fact": \{\s*const \{ execProposeCommercialFact \} = await import\("@\/lib\/revenue-spine\/fact-proposals"\);/);
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

  function fakeExecDeps(over: Partial<{ member: boolean; policy: RevenueSpinePolicy }> = {}) {
    const published: Array<{ orgId: string; profile: BusinessProfile; userId: string }> = [];
    const audits: Array<Parameters<FactExecDeps["audit"]>[0]> = [];
    const deps: FactExecDeps = {
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
  const boss = { userId: "u_boss", role: "boss", orgId: ORG };

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

  await ok("执行器防御：缺组织 / 跨组织 / 非 admin·boss / 非成员 / 未知字段 / 无提议值 → 失败且不发布", async () => {
    const cases: Array<[Partial<FactProposalPayload> | null, typeof boss, boolean, string]> = [
      [{ ...payload(), metadata: undefined as never }, boss, true, "缺少组织信息，拒绝执行"],
      [payload(), { ...boss, orgId: "org_other" }, true, "跨组织动作，拒绝执行"],
      [payload(), { ...boss, role: "sales" }, true, FACT_PROPOSAL_DENIED],
      [payload(), boss, false, "无权更新该组织的商务事实"],
      [payload({ field: "price" as never }), boss, true, "未知的商务事实字段"],
      [payload({ proposedValue: null }), boss, true, "缺少提议值"],
    ];
    for (const [p, ctx, member, error] of cases) {
      const f = fakeExecDeps({ member });
      const r = await execProposeCommercialFact(p, ctx, "pa_fact_1", f.deps);
      assert.deepEqual([r.ok, r.error, f.published.length], [false, error, 0], error);
    }
    // 平台管理员不要求组织成员身份
    const f = fakeExecDeps({ member: false });
    assert.equal((await execProposeCommercialFact(payload(), { ...boss, role: "super_admin" }, "pa_fact_1", f.deps)).ok, true);
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
