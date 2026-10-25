/**
 * 首响 SLA 分级提醒 + SLA 指标 — 真实 DB 端到端（隔离库，虚构企业）
 *
 *   [1] 工作时间：新询盘的 SalesAction.dueAt / 商机下一步按组织工作时间算；未配置的组织与旧口径一致
 *   [2] 分级：T+15 分钟提醒负责人（站内 + 微信）、T+2 小时升级管理层、T+24 小时告知草稿状态；每档只发一次；
 *       负责人中途换人不重发；已回复 / 测试询盘 / 展会速记卡不提醒；FDE 写入 draftStatus 标记
 *   [3] 未启用分级的组织：runSlaTiersForOrg 不查不发；inquiry-sla 旧提醒照常（含已进 Revenue Spine 的线索）
 *   [4] 启用分级的组织：inquiry-sla 旧线程提醒跳过被分级跟踪的询盘，其余线程照常；
 *       秘书跟进阶梯不扫描已链接 Revenue Spine 商机的线索（手动转入 CRM 的旧阶段商机仍扫描）
 *   [5] 跟进草稿被护栏拦下：AuditLog 标记只写一次
 *   [6] 指标加载：首次回复三种来源、测试排除、展会单列、护栏计数、跨组织隔离
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/revenue-spine/__tests__/sla-tiers-db.isolated.test.ts
 * 无隔离库时自动跳过。公开仓库：只用虚构企业与号码。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过首响分级 DB 端到端（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "SLA tiers DB e2e" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 900) : "");
  }
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ORIGIN = "https://app.example.test";
const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;

const RFQ = (company: string) =>
  `Hello, we are ${company}, a home textile importer in Toronto, Canada. We need 3,000 pcs of 100% cotton bath towels, 70x140cm, 550gsm, white, with embroidered logo. Please quote FOB Ningbo and advise the sample lead time. Delivery to Toronto, Canada by March 2027.`;

async function main() {
  const { db } = await import("@/lib/db");
  const { intakeInquiry } = await import("../inquiry-intake");
  const { runInboundSalesFde, INQUIRY_REPLY_ACTION_TYPE } = await import("../fde/inbound-sales");
  const { draftNoReplyFollowUps, FOLLOW_UP_GUARDRAIL_AUDIT_ACTION } = await import("../fde/no-reply-followup");
  const { logRevenueInteraction } = await import("../interactions");
  const { publishRevenueSpineRule, RULE_KEY_POLICY, loadRevenueSpinePolicy } = await import("../policy");
  const { addBusinessHours } = await import("../business-days");
  const { runSlaTiersForOrg, slaTierSourceKey } = await import("../sla-tiers");
  const { loadSlaMetrics } = await import("../sla-metrics");
  const { runInquirySla } = await import("@/lib/trade/inquiry-sla");
  const { scanFollowups } = await import("@/lib/secretary/followup-engine");
  const { __setToolPolicyLoaderForTest } = await import("@/lib/pending-actions/executor");
  __setToolPolicyLoaderForTest(async () => ({ value: {} }));

  const stamp = Date.now().toString(36);
  const ORG_T = `slaT_${stamp}`; // 启用分级（自然时间）
  const ORG_L = `slaL_${stamp}`; // 未配置（旧行为）
  const ORG_C = `slaC_${stamp}`; // 工作时间（上海）
  const ORGS = [ORG_T, ORG_L, ORG_C];
  const OWNER = `slaowner_${stamp}`;
  const REP = `slarep_${stamp}`;
  const MANAGER = `slamgr_${stamp}`;
  const OWNER_L = `slaownerl_${stamp}`;
  const REP_L = `slarepl_${stamp}`;
  const OWNER_C = `slaownerc_${stamp}`;
  const USERS = [OWNER, REP, MANAGER, OWNER_L, REP_L, OWNER_C];

  const pushes: Array<{ userId: string; title: string; text: string }> = [];
  const push = async (userId: string, title: string, text: string) => {
    pushes.push({ userId, title, text });
    return { sent: 1, failed: 0 };
  };

  await db.user.createMany({
    data: [
      { id: OWNER, email: `${OWNER}@fixture.test`, name: "Factory Owner", role: "boss" },
      { id: REP, email: `${REP}@fixture.test`, name: "Trade Rep", role: "trade" },
      { id: MANAGER, email: `${MANAGER}@fixture.test`, name: "Sales Manager", role: "manager" },
      { id: OWNER_L, email: `${OWNER_L}@fixture.test`, name: "Legacy Owner", role: "boss" },
      { id: REP_L, email: `${REP_L}@fixture.test`, name: "Legacy Rep", role: "trade" },
      { id: OWNER_C, email: `${OWNER_C}@fixture.test`, name: "Calendar Owner", role: "boss" },
    ],
  });
  const trade = { enabled: ["trade", "sales"] };
  await db.organization.create({ data: { id: ORG_T, name: "Example Textiles Mill", code: `slat-${stamp}`, ownerId: OWNER, modulesJson: trade, settingsJson: { timezone: "Asia/Shanghai" } } });
  await db.organization.create({ data: { id: ORG_L, name: "Legacy Fixture Mill", code: `slal-${stamp}`, ownerId: OWNER_L, modulesJson: trade, settingsJson: { timezone: "Asia/Shanghai" } } });
  await db.organization.create({ data: { id: ORG_C, name: "Calendar Fixture Mill", code: `slac-${stamp}`, ownerId: OWNER_C, modulesJson: trade, settingsJson: { timezone: "Asia/Shanghai" } } });
  await db.organizationMember.createMany({
    data: [
      { orgId: ORG_T, userId: OWNER, role: "org_owner", status: "active" },
      { orgId: ORG_T, userId: REP, role: "org_member", status: "active" },
      { orgId: ORG_T, userId: MANAGER, role: "org_member", status: "active" },
      { orgId: ORG_L, userId: OWNER_L, role: "org_owner", status: "active" },
      { orgId: ORG_L, userId: REP_L, role: "org_member", status: "active" },
      { orgId: ORG_C, userId: OWNER_C, role: "org_owner", status: "active" },
    ],
  });
  await publishRevenueSpineRule({
    orgId: ORG_T,
    ruleKey: RULE_KEY_POLICY,
    config: { salesSla: { unclaimedAlertMinutes: 15, ownerEscalationMinutes: 120, overdueDraftHours: 24 } },
    userId: OWNER,
  });
  const SH = { timezone: "Asia/Shanghai", start: "09:00", end: "18:00", workdays: [1, 2, 3, 4, 5] };
  await publishRevenueSpineRule({ orgId: ORG_C, ruleKey: RULE_KEY_POLICY, config: { salesSla: { businessHours: SH } }, userId: OWNER_C });

  const inquiry = (orgId: string, brand: string, extra: { source?: "website_inquiry" | "trade_show"; utm?: Record<string, string>; now?: Date } = {}) =>
    intakeInquiry({
      orgId,
      source: extra.source ?? "website_inquiry",
      contact: { name: `Olivia ${brand}`, email: `olivia.${stamp}@${brand.toLowerCase()}-${stamp}.test`, company: `${brand} Home Goods`, country: "Canada" },
      message: RFQ(`${brand} Home Goods`),
      meta: { utm: extra.utm ?? { source: "google" } },
      now: extra.now,
    });
  const actionOf = async (id: string | null) =>
    db.salesAction.findUniqueOrThrow({ where: { id: id ?? "" }, select: { id: true, createdAt: true, dueAt: true, inputContext: true, opportunityId: true } });
  const notesWithPrefix = (prefix: string) => db.notification.findMany({ where: { sourceKey: { startsWith: prefix } }, select: { userId: true, sourceKey: true, title: true, summary: true } });

  try {
    // ── [1] 工作时间 → 新行动的 dueAt ──
    console.log("\n[1] 工作时间");
    {
      const fri17 = new Date("2026-10-23T09:00:00Z"); // 周五 17:00 上海
      const c = await inquiry(ORG_C, "Calendar", { now: fri17 });
      ok(c.ok, "工作时间组织：询盘入链", c);
      if (c.ok) {
        const a = await actionOf(c.salesActionId);
        ok(a.dueAt?.toISOString() === "2026-10-26T04:00:00.000Z", "SalesAction.dueAt = 周一 12:00 上海（4 个工作小时）", a.dueAt);
        const opp = await db.salesOpportunity.findUniqueOrThrow({ where: { id: c.opportunityId }, select: { nextActionType: true, nextFollowupAt: true } });
        ok(opp.nextActionType === "reply_inquiry" && opp.nextFollowupAt?.toISOString() === "2026-10-26T04:00:00.000Z", "商机下一步按工作时间", opp);
      }
      const l = await inquiry(ORG_L, "Legacy", { now: fri17 });
      if (l.ok) {
        const a = await actionOf(l.salesActionId);
        ok(a.dueAt?.toISOString() === addBusinessHours(fri17, 4).toISOString(), "未配置的组织：dueAt 与 V1 口径一致", a.dueAt);
      }
      const p = await loadRevenueSpinePolicy(ORG_L);
      ok(p.salesSla.businessHours === null && p.salesSla.unclaimedAlertMinutes === null, "未配置的组织：新字段全 null", p.salesSla);
    }

    // ── [2] 分级 ──
    console.log("\n[2] 分级提醒");
    const a1Intake = await inquiry(ORG_T, "Maple");
    ok(a1Intake.ok && a1Intake.ownerUserId === REP, "询盘入链，负责人 = 外贸业务员", a1Intake);
    if (!a1Intake.ok) throw new Error("intake failed");
    const a1 = await actionOf(a1Intake.salesActionId);
    const T = a1.createdAt;
    const at = (ms: number) => new Date(T.getTime() + ms);
    const prefix1 = (tier: "unclaimed" | "escalation" | "overdue_draft") => slaTierSourceKey(tier, ORG_T, a1.id);

    const r0 = await runSlaTiersForOrg(ORG_T, { now: at(10 * MIN), push, origin: ORIGIN });
    ok(r0.enabled && r0.tracked >= 1 && r0.fired.unclaimed === 0 && r0.trackedOpportunityIds.includes(a1Intake.opportunityId), "T+10 分钟：在跟踪，未到第一档", r0);

    const r1 = await runSlaTiersForOrg(ORG_T, { now: at(16 * MIN), push, origin: ORIGIN });
    const n1 = await notesWithPrefix(prefix1("unclaimed"));
    ok(r1.fired.unclaimed === 1 && n1.length === 1 && n1[0].userId === REP && n1[0].sourceKey === prefix1("unclaimed"), "T+16 分钟：第一档只提醒负责人（站内）", { r1, n1 });
    ok(pushes.length === 1 && pushes[0].userId === REP && r1.wechatDelivered === 1, "第一档同时推微信给负责人", pushes);
    ok(!EMAIL.test(n1[0]?.summary ?? "") && !EMAIL.test(pushes[0]?.text ?? ""), "正文不含买家邮箱", n1[0]?.summary);
    ok((n1[0]?.summary ?? "").includes(`${ORIGIN}/revenue/${a1Intake.opportunityId}`), "正文带商机链接");

    const r1b = await runSlaTiersForOrg(ORG_T, { now: at(20 * MIN), push, origin: ORIGIN });
    ok(r1b.fired.unclaimed === 0 && pushes.length === 1 && (await notesWithPrefix(prefix1("unclaimed"))).length === 1, "再跑一次：第一档不重发", r1b);

    // FDE 跑完：草稿进审批中心，draftStatus 标记写入
    const fde = await runInboundSalesFde({ orgId: ORG_T, opportunityId: a1Intake.opportunityId, salesActionId: a1.id, trigger: "inquiry", useLlm: false, now: at(30 * MIN) });
    const a1After = await actionOf(a1.id);
    const ctx = (a1After.inputContext ?? {}) as Record<string, unknown>;
    ok(fde.ok && !!fde.pendingActionId && ctx.draftStatus === "created" && ctx.fdeStatus === "completed", "FDE：草稿已建，inputContext.draftStatus = created", { ok: fde.ok, pa: fde.pendingActionId, ctx: { draftStatus: ctx.draftStatus, fdeStatus: ctx.fdeStatus } });

    const r2 = await runSlaTiersForOrg(ORG_T, { now: at(2 * HOUR + MIN), push, origin: ORIGIN });
    const n2 = await notesWithPrefix(prefix1("escalation"));
    ok(r2.fired.escalation === 1 && n2.length === 2 && new Set(n2.map((n) => n.userId)).size === 2 && n2.every((n) => [OWNER, MANAGER].includes(n.userId)), "T+2 小时：升级给管理层（老板 + 经理），每人一条", { r2, n2 });
    ok(n2.some((n) => n.sourceKey === prefix1("escalation")) && n2.some((n) => n.sourceKey?.startsWith(`${prefix1("escalation")}:`)), "第一位收件人占位键不带 userId，其余带");
    ok((n2[0]?.summary ?? "").includes("负责人：Trade Rep"), "升级正文写明负责人", n2[0]?.summary);
    ok(pushes.filter((p) => p.title.includes("已升级")).length === 2, "升级同时推微信给管理层", pushes.map((p) => p.userId));

    // 负责人换人：第一档不重发
    await db.salesOpportunity.update({ where: { id: a1Intake.opportunityId }, data: { assignedToId: OWNER } });
    const r2b = await runSlaTiersForOrg(ORG_T, { now: at(2 * HOUR + 10 * MIN), push, origin: ORIGIN });
    ok(r2b.fired.unclaimed === 0 && r2b.fired.escalation === 0 && (await notesWithPrefix(prefix1("unclaimed"))).length === 1, "负责人中途换人：已发过的档位不重发", r2b);

    const r3 = await runSlaTiersForOrg(ORG_T, { now: at(24 * HOUR + MIN), push, origin: ORIGIN });
    const n3 = await notesWithPrefix(prefix1("overdue_draft"));
    ok(r3.fired.overdue_draft === 1 && n3.length === 2, "T+24 小时：第三档告知管理层", { r3, n3: n3.length });
    ok((n3[0]?.summary ?? "").includes("审批中心等待批准") && (n3[0]?.summary ?? "").includes("不会自动给买家发邮件"), "第三档：说明草稿在审批中心、系统不会自动发信", n3[0]?.summary);
    ok((n3[0]?.summary ?? "").includes(`${ORIGIN}/revenue/today#approvals`), "有草稿时链接到今日询盘的待审批栏");

    const sentToBuyer = await db.customerInteraction.count({ where: { orgId: ORG_T, opportunityId: a1Intake.opportunityId, direction: "outbound" } });
    const executed = await db.pendingAction.count({ where: { orgId: ORG_T, type: INQUIRY_REPLY_ACTION_TYPE, status: "executed" } });
    ok(sentToBuyer === 0 && executed === 0, "全程没有给买家发任何邮件（无外发互动、无已执行草稿）", { sentToBuyer, executed });

    // 没有草稿：不做类目
    const a3Intake = await inquiry(ORG_T, "Birch");
    if (!a3Intake.ok) throw new Error("intake a3 failed");
    const a3 = await actionOf(a3Intake.salesActionId);
    await db.salesAction.update({ where: { id: a3.id }, data: { inputContext: { ...((a3.inputContext as Record<string, unknown>) ?? {}), fdeStatus: "completed", draftStatus: "out_of_range" } } });
    await runSlaTiersForOrg(ORG_T, { now: new Date(a3.createdAt.getTime() + 24 * HOUR + MIN), push, origin: ORIGIN });
    const n3b = await notesWithPrefix(slaTierSourceKey("overdue_draft", ORG_T, a3.id));
    ok(n3b.length === 2 && (n3b[0]?.summary ?? "").includes("不做的类目"), "第三档：没有草稿时说明原因（不做的类目）", n3b[0]?.summary);

    // 已回复：不提醒
    const a2Intake = await inquiry(ORG_T, "Cedar");
    if (!a2Intake.ok) throw new Error("intake a2 failed");
    const a2 = await actionOf(a2Intake.salesActionId);
    const replied = await logRevenueInteraction({ orgId: ORG_T, opportunityId: a2Intake.opportunityId, direction: "outbound", channel: "email", content: "Thanks for your inquiry", actorUserId: REP, occurredAt: new Date(a2.createdAt.getTime() + 5 * MIN) });
    // 互动的 createdAt 由库生成：对齐到「5 分钟后回复」，指标测试据此计算首响
    await db.customerInteraction.update({ where: { id: replied.interactionId }, data: { createdAt: new Date(a2.createdAt.getTime() + 5 * MIN) } });
    const rA2 = await runSlaTiersForOrg(ORG_T, { now: new Date(a2.createdAt.getTime() + 16 * MIN), push, origin: ORIGIN });
    ok(!rA2.trackedOpportunityIds.includes(a2Intake.opportunityId) && (await notesWithPrefix(slaTierSourceKey("unclaimed", ORG_T, a2.id))).length === 0, "已回复的询盘不跟踪、不提醒", rA2);

    // 已被人认领（in_progress）：不发第一档，升级照常
    const a6Intake = await inquiry(ORG_T, "Hazel");
    if (!a6Intake.ok) throw new Error("intake a6 failed");
    const a6 = await actionOf(a6Intake.salesActionId);
    await db.salesAction.update({ where: { id: a6.id }, data: { status: "in_progress", startedAt: new Date() } });
    await runSlaTiersForOrg(ORG_T, { now: new Date(a6.createdAt.getTime() + 2 * HOUR + MIN), push, origin: ORIGIN });
    ok(
      (await notesWithPrefix(slaTierSourceKey("unclaimed", ORG_T, a6.id))).length === 0 &&
        (await notesWithPrefix(slaTierSourceKey("escalation", ORG_T, a6.id))).length === 2,
      "已被人认领：不发未认领提醒，2 小时仍未回复照常升级",
    );

    // 入驻测试询盘 / 展会速记卡：不提醒
    const a4Intake = await inquiry(ORG_T, "Onboard", { utm: { source: "qingyan_onboarding_test" } });
    const a5Intake = await inquiry(ORG_T, "Booth", { source: "trade_show" });
    if (!a4Intake.ok || !a5Intake.ok) throw new Error("intake a4/a5 failed");
    const a4 = await actionOf(a4Intake.salesActionId);
    const a5 = await actionOf(a5Intake.salesActionId);
    const rA45 = await runSlaTiersForOrg(ORG_T, { now: new Date(Math.max(a4.createdAt.getTime(), a5.createdAt.getTime()) + 16 * MIN), push, origin: ORIGIN });
    ok(
      !rA45.trackedOpportunityIds.includes(a4Intake.opportunityId) &&
        !rA45.trackedOpportunityIds.includes(a5Intake.opportunityId) &&
        (await notesWithPrefix(slaTierSourceKey("unclaimed", ORG_T, a4.id))).length === 0 &&
        (await notesWithPrefix(slaTierSourceKey("unclaimed", ORG_T, a5.id))).length === 0,
      "入驻测试询盘、展会速记卡不进分级",
      rA45.trackedOpportunityIds,
    );

    // ── [3] 未启用分级的组织 ──
    console.log("\n[3] 未启用分级的组织");
    const lIntake = await inquiry(ORG_L, "Spruce");
    if (!lIntake.ok) throw new Error("intake L failed");
    const lAction = await actionOf(lIntake.salesActionId);
    const pushesBefore = pushes.length;
    const rL = await runSlaTiersForOrg(ORG_L, { now: new Date(lAction.createdAt.getTime() + 3 * HOUR), push, origin: ORIGIN });
    ok(!rL.enabled && rL.tracked === 0 && pushes.length === pushesBefore, "未配置：不跟踪、不发", rL);
    ok((await db.notification.count({ where: { orgId: ORG_L, sourceKey: { startsWith: "inquiry-sla:v2:" } } })) === 0, "未配置：没有任何 v2 分级通知");

    // ── [4] inquiry-sla 旧线程提醒与分级的分工 ──
    console.log("\n[4] 旧线程提醒的分工");
    const campaign = (orgId: string, userId: string) =>
      db.tradeCampaign.create({ data: { orgId, name: `SLA fixture ${stamp}`, productDesc: "Bath towels", targetMarket: "Canada", createdById: userId }, select: { id: true } });
    const cT = await campaign(ORG_T, OWNER);
    const cL = await campaign(ORG_L, OWNER_L);
    const prospect = (orgId: string, campaignId: string, name: string, oppId: string | null) =>
      db.tradeProspect.create({ data: { orgId, campaignId, companyName: name, stage: "replied", convertedToSalesOpportunityId: oppId }, select: { id: true } });
    const tenMinAgo = new Date(Date.now() - 10 * MIN);
    // ORG_T：P1 链接到被分级跟踪的 a1 商机；P2 没进 Revenue Spine
    const p1 = await prospect(ORG_T, cT.id, `Maple Home Goods ${stamp}`, a1Intake.opportunityId);
    const p2 = await prospect(ORG_T, cT.id, `Walnut Trading ${stamp}`, null);
    // ORG_L：链接到 Revenue Spine 商机，但组织未启用分级 → 旧提醒照常
    const pl = await prospect(ORG_L, cL.id, `Spruce Home Goods ${stamp}`, lIntake.opportunityId);
    for (const p of [p1, p2, pl]) {
      await db.tradeMessage.create({ data: { prospectId: p.id, direction: "inbound", channel: "website", subject: "网站询盘", content: "Need towels", createdAt: tenMinAgo } });
    }
    // a1 仍未回复（草稿在审批中心、没有外发）→ 仍被分级跟踪
    const outcome = await runInquirySla({ push });
    const legacy = (prospectId: string) => db.notification.count({ where: { sourceKey: { startsWith: `inquiry-sla:5m:${prospectId}:` } } });
    ok((await legacy(p1.id)) === 0, "启用分级：被分级跟踪的询盘，旧 5 分钟线程提醒跳过", { p1: await legacy(p1.id) });
    ok((await legacy(p2.id)) > 0, "启用分级：没进 Revenue Spine 的线程，旧提醒照常", { p2: await legacy(p2.id) });
    ok((await legacy(pl.id)) > 0, "未启用分级的组织：旧提醒照常（含已进 Revenue Spine 的线索）", { pl: await legacy(pl.id) });
    ok(outcome.tiers.legacyThreadsSkipped >= 1 && outcome.tiers.orgsEnabled >= 1, "cron 结果记录分级与跳过数", outcome.tiers);

    // 秘书跟进阶梯：链接到 Revenue Spine（canonical 阶段）商机的线索不扫描；手动转入 CRM 的旧阶段商机仍扫描
    {
      const legacyCust = await db.salesCustomer.create({ data: { orgId: ORG_T, name: `Poplar Retail ${stamp}`, createdById: OWNER, status: "active" }, select: { id: true } });
      const legacyOpp = await db.salesOpportunity.create({ data: { orgId: ORG_T, customerId: legacyCust.id, title: `Manual convert ${stamp}`, stage: "new_lead", createdById: OWNER }, select: { id: true } });
      const pm = await prospect(ORG_T, cT.id, `Poplar Retail ${stamp}`, legacyOpp.id);
      const due = new Date(Date.now() - HOUR);
      await db.tradeProspect.updateMany({ where: { id: { in: [p1.id, p2.id, pm.id] } }, data: { nextFollowUpAt: due } });
      const candidates = await scanFollowups(ORG_T);
      const ids = new Set(candidates.map((c) => c.prospectId));
      ok(!ids.has(p1.id) && ids.has(p2.id) && ids.has(pm.id), "秘书跟进：Revenue Spine 线索排除；未链接 / 旧阶段商机的线索照常", {
        p1: ids.has(p1.id),
        p2: ids.has(p2.id),
        pm: ids.has(pm.id),
      });
    }

    // ── [5] 跟进草稿护栏标记 ──
    console.log("\n[5] 跟进草稿护栏标记");
    {
      const cust = await db.salesCustomer.create({ data: { orgId: ORG_T, name: `Aspen Imports ${stamp}`, email: `buyer@aspen-${stamp}.test`, createdById: OWNER, status: "active" }, select: { id: true } });
      const sent = new Date(Date.now() - 3 * DAY - HOUR);
      const opp = await db.salesOpportunity.create({
        data: { orgId: ORG_T, customerId: cust.id, title: `Towels ${stamp}`, stage: "qualified", createdById: OWNER, assignedToId: REP, lastOutboundAt: sent, followUpCount: 1, source: "website_inquiry" },
        select: { id: true },
      });
      await db.customerInteraction.create({ data: { orgId: ORG_T, customerId: cust.id, opportunityId: opp.id, type: "web_form", direction: "inbound", summary: "RFQ", content: "Need towels", channel: "website", createdById: OWNER, createdAt: new Date(sent.getTime() - DAY) } });
      // 产品名里带价格数字 → 跟进模板触发价格守卫
      await db.salesRfq.create({ data: { orgId: ORG_T, opportunityId: opp.id, customerId: cust.id, productName: "Bath towels USD 5 each" } });
      const f1 = await draftNoReplyFollowUps(ORG_T, {});
      const f2 = await draftNoReplyFollowUps(ORG_T, {});
      const marks = await db.auditLog.count({ where: { orgId: ORG_T, action: FOLLOW_UP_GUARDRAIL_AUDIT_ACTION, targetId: opp.id } });
      ok(
        f1.skipped.some((s) => s.opportunityId === opp.id && s.reason.startsWith("guardrail:")) && f2.skipped.some((s) => s.opportunityId === opp.id) && marks === 1,
        "跟进草稿被护栏拦下：不起草，审计标记只写一次",
        { f1: f1.skipped, marks },
      );
    }

    // ── [6] 指标加载 ──
    console.log("\n[6] 指标加载");
    {
      // a3：关联线索的外发消息算首次回复；a1：标记首封护栏拦截
      const p3 = await prospect(ORG_T, cT.id, `Birch Home Goods ${stamp}`, a3Intake.opportunityId);
      await db.tradeMessage.create({ data: { prospectId: p3.id, direction: "outbound", channel: "email", subject: "Re", content: "Hello", createdAt: new Date(a3.createdAt.getTime() + 2 * HOUR) } });
      const cur = await actionOf(a1.id);
      await db.salesAction.update({ where: { id: a1.id }, data: { inputContext: { ...((cur.inputContext as Record<string, unknown>) ?? {}), guardrailBlockedAt: new Date().toISOString() } } });

      const m = await loadSlaMetrics(ORG_T, { now: new Date(Date.now() + MIN) });
      // ORG_T 的询盘：a1（未回复）、a2（5 分钟回复）、a3（2 小时，外贸消息）、a6（已认领未回复）、a4（测试，排除）、a5（展会）；
      // [5] 的商机没有 FDE 行动
      ok(m.inquiries.received === 4, "询盘数：不含测试询盘与展会速记卡", m.inquiries);
      ok(m.inquiries.answered === 2 && m.inquiries.unanswered === 2, "已回复 2（外发互动 / 外贸消息），未回复 2", m.inquiries);
      ok(m.inquiries.medianFirstResponseMinutes !== null && Math.abs(m.inquiries.medianFirstResponseMinutes - 62.5) < 1.5, "首响中位 ≈ (5 + 120) / 2 分钟", m.inquiries.medianFirstResponseMinutes);
      ok(m.tradeShow.received === 1 && m.excludedTests === 1, "展会单列 1 张、排除测试 1 条", { tradeShow: m.tradeShow, excludedTests: m.excludedTests });
      ok(m.guardrail.firstReply === 1 && m.guardrail.followUp === 1 && m.guardrail.total === 2, "护栏拦截：首封 1 + 跟进 1", m.guardrail);
      ok(m.basis === "wall_clock", "未配工作时间：按自然时间");

      const mC = await loadSlaMetrics(ORG_C, { now: new Date(Date.now() + MIN) });
      ok(mC.basis === "business" && mC.inquiries.received === 1, "工作时间组织：按工作时间口径，只看本组织", mC.inquiries);
      const mL = await loadSlaMetrics(ORG_L, { now: new Date(Date.now() + MIN) });
      ok(mL.inquiries.received === 2 && mL.guardrail.total === 0, "未配置组织：只看本组织（不串 ORG_T 的数据）", mL.inquiries);
    }
  } finally {
    try {
      for (const orgId of ORGS) {
        const prospects = await db.tradeProspect.findMany({ where: { orgId }, select: { id: true } });
        await db.tradeMessage.deleteMany({ where: { prospectId: { in: prospects.map((p) => p.id) } } });
        await db.tradeProspect.deleteMany({ where: { orgId } });
        await db.tradeCampaign.deleteMany({ where: { orgId } });
        await db.pendingAction.deleteMany({ where: { orgId } });
        await db.notification.deleteMany({ where: { orgId } });
        await db.businessOutcome.deleteMany({ where: { orgId } });
        await db.customerInteraction.deleteMany({ where: { orgId } });
        await db.salesAction.deleteMany({ where: { orgId } });
        await db.salesRfqEvidence.deleteMany({ where: { orgId } });
        await db.salesRfq.deleteMany({ where: { orgId } });
        await db.salesOpportunityAssessment.deleteMany({ where: { orgId } });
        await db.salesOpportunity.deleteMany({ where: { orgId } });
        await db.salesCustomer.deleteMany({ where: { orgId } });
        await db.agentRunEvent.deleteMany({ where: { orgId } });
        await db.agentRun.deleteMany({ where: { orgId } });
        await db.agentSession.deleteMany({ where: { orgId } });
        await db.capabilityQuotaReservation.deleteMany({ where: { orgId } }).catch(() => undefined);
        await db.orgBusinessRule.deleteMany({ where: { orgId } });
        await db.auditLog.deleteMany({ where: { orgId } });
        await db.organizationMember.deleteMany({ where: { orgId } });
      }
      await db.pendingAction.deleteMany({ where: { createdById: { in: USERS } } });
      await db.organization.deleteMany({ where: { id: { in: ORGS } } });
      await db.auditLog.deleteMany({ where: { userId: { in: USERS } } });
      await db.notification.deleteMany({ where: { userId: { in: USERS } } });
      await db.user.deleteMany({ where: { id: { in: USERS } } });
    } catch (cleanupErr) {
      console.warn("[cleanup] 清理未完成：", cleanupErr instanceof Error ? cleanupErr.message : cleanupErr);
    }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    const { db } = await import("@/lib/db");
    await db.$disconnect();
  });
