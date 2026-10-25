/**
 * 老板「今日询盘」— 真实 DB 端到端（隔离库，虚构企业）
 *
 *   [1] buildOwnerToday：组织时区（Asia/Shanghai）切日、回复超时、待审批关联、样品报价合并去重、归档客户排除、跨组织隔离
 *   [2] sendOwnerInquiryBrief：管理层收件、正文不含买家邮箱、同日不重发、未启用外贸模块不发、四栏为 0 不发
 *   [3] FDE 新草稿微信提醒：组织开关打开才推；每个审批人每小时最多一条；关掉后不推
 *   [4] 微信回数字：询盘回复草稿不进数字批次（回「1」不会批准给买家的邮件）；只取当前组织
 *   [5] 微信绑定：不能改 / 解绑别人的绑定；偏好接口不能改归属
 *   [6] 待审批超过查询上限（200）：保留最新的草稿，计数用 count 不截断
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/revenue-spine/__tests__/owner-today-db.isolated.test.ts
 * 无隔离库时自动跳过。公开仓库：只用虚构企业与号码。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过今日询盘 DB 端到端（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "Owner today DB e2e" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 800) : "");
  }
}

const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
const HOUR = 3_600_000;
// 当地（Asia/Shanghai）2026-10-24 10:00
const NOW = new Date("2026-10-24T02:00:00Z");
const ORIGIN = "https://app.example.test";

const RFQ = (company: string) =>
  `Hello, we are ${company}, a home textile importer in Toronto, Canada. We need 3,000 pcs of 100% cotton bath towels, 70x140cm, 550gsm, white, with embroidered logo. Please quote FOB Ningbo and advise the sample lead time. Delivery to Toronto, Canada by March 2027.`;

async function main() {
  const { db } = await import("@/lib/db");
  const { buildOwnerToday } = await import("../owner-today");
  const { sendOwnerInquiryBrief, pushNewDraftToApprover, newDraftPushSourceKey } = await import("../owner-brief");
  const { INQUIRY_REPLY_ACTION_TYPE, runInboundSalesFde } = await import("../fde/inbound-sales");
  const { intakeInquiry } = await import("../inquiry-intake");
  const { publishRevenueSpineRule, RULE_KEY_POLICY } = await import("../policy");
  const { getRecentPendingActionsForWeChat, handleWeChatPendingReply } = await import("@/lib/ai-grader/actions/wechat-confirm");
  const { updateBindingPreferences, removeBinding, sanitizeBindingPreferences } = await import("@/lib/messaging/binding");
  const { __setToolPolicyLoaderForTest } = await import("@/lib/pending-actions/executor");
  __setToolPolicyLoaderForTest(async () => ({ value: {} }));

  const stamp = Date.now().toString(36);
  const ORG_A = `otA_${stamp}`;
  const ORG_B = `otB_${stamp}`;
  const ORG_C = `otC_${stamp}`;
  const ORG_SALES = `otS_${stamp}`;
  const ORG_EMPTY = `otE_${stamp}`;
  const ORG_BULK = `otK_${stamp}`;
  const ORGS = [ORG_A, ORG_B, ORG_C, ORG_SALES, ORG_EMPTY, ORG_BULK];
  const OWNER = `otowner_${stamp}`;
  const REP = `otrep_${stamp}`;
  const OTHER = `otother_${stamp}`;
  const OWNER_C = `otownerc_${stamp}`;
  const REP_C = `otrepc_${stamp}`;
  const USERS = [OWNER, REP, OTHER, OWNER_C, REP_C];

  const trade = { enabled: ["trade", "sales", "product_content"] };
  const sh = { timezone: "Asia/Shanghai" };
  await db.user.create({ data: { id: OWNER, email: `${OWNER}@fixture.test`, name: "Factory Owner", role: "boss" } });
  await db.user.create({ data: { id: REP, email: `${REP}@fixture.test`, name: "Trade Rep", role: "trade" } });
  await db.user.create({ data: { id: OTHER, email: `${OTHER}@fixture.test`, name: "Other Owner", role: "boss" } });
  await db.user.create({ data: { id: OWNER_C, email: `${OWNER_C}@fixture.test`, name: "Owner C", role: "boss" } });
  await db.user.create({ data: { id: REP_C, email: `${REP_C}@fixture.test`, name: "Rep C", role: "trade" } });
  await db.organization.create({ data: { id: ORG_A, name: "Example Textiles Factory", code: `ota-${stamp}`, ownerId: OWNER, modulesJson: trade, settingsJson: sh } });
  await db.organization.create({ data: { id: ORG_B, name: "Other Fixture Factory", code: `otb-${stamp}`, ownerId: OTHER, modulesJson: trade, settingsJson: sh } });
  await db.organization.create({ data: { id: ORG_C, name: "Northwind Fixture Mill", code: `otc-${stamp}`, ownerId: OWNER_C, modulesJson: trade, settingsJson: sh } });
  await db.organization.create({ data: { id: ORG_SALES, name: "Window Fixture Co", code: `ots-${stamp}`, ownerId: OTHER, modulesJson: { enabled: ["sales", "bids", "window_covering"] }, settingsJson: sh } });
  await db.organization.create({ data: { id: ORG_EMPTY, name: "Quiet Fixture Mill", code: `ote-${stamp}`, ownerId: OTHER, modulesJson: trade, settingsJson: sh } });
  await db.organization.create({ data: { id: ORG_BULK, name: "Busy Fixture Mill", code: `otk-${stamp}`, ownerId: OTHER, modulesJson: trade, settingsJson: sh } });
  await db.organizationMember.createMany({
    data: [
      { orgId: ORG_A, userId: OWNER, role: "org_owner", status: "active" },
      { orgId: ORG_A, userId: REP, role: "org_member", status: "active" },
      { orgId: ORG_B, userId: OTHER, role: "org_owner", status: "active" },
      { orgId: ORG_C, userId: OWNER_C, role: "org_owner", status: "active" },
      { orgId: ORG_C, userId: REP_C, role: "org_member", status: "active" },
      { orgId: ORG_SALES, userId: OTHER, role: "org_owner", status: "active" },
      { orgId: ORG_EMPTY, userId: OTHER, role: "org_owner", status: "active" },
    ],
  });

  const customer = (orgId: string, name: string, extra: { email?: string; country?: string; archivedAt?: Date } = {}) =>
    db.salesCustomer.create({ data: { orgId, name, createdById: OWNER, status: "active", ...extra }, select: { id: true } });
  const opportunity = (orgId: string, customerId: string, data: Record<string, unknown>) =>
    db.salesOpportunity.create({ data: { orgId, customerId, title: `Bath towels ${stamp}`, createdById: OWNER, assignedToId: REP, ...data }, select: { id: true } });
  const pending = (orgId: string | null, data: { type?: string; createdById?: string; status?: string; expiresAt?: Date; createdAt?: Date; payload?: Record<string, unknown>; title?: string }) =>
    db.pendingAction.create({
      data: {
        orgId,
        type: data.type ?? INQUIRY_REPLY_ACTION_TYPE,
        title: data.title ?? "发送询盘回复",
        preview: "Subject: Re: towels\n\nDear buyer, …\n\n——— 中文对照（仅供审核，不会发送）———\n…",
        payload: (data.payload ?? {}) as object,
        status: data.status ?? "pending",
        createdById: data.createdById ?? REP,
        approverUserId: data.createdById ?? REP,
        // 微信确认按真实时钟判过期：默认过期时间取夹具时刻与真实时钟的较晚者 + 72h
        expiresAt: data.expiresAt ?? new Date(Math.max(NOW.getTime(), Date.now()) + 72 * HOUR),
        ...(data.createdAt ? { createdAt: data.createdAt } : {}),
      },
      select: { id: true },
    });

  try {
    // ── 夹具 ──
    const cA1 = await customer(ORG_A, `Maple Home Goods ${stamp}`, { email: `buyer1@maple-${stamp}.test`, country: "Canada" });
    const cA2 = await customer(ORG_A, `harbor@harbor-${stamp}.test`, { email: `harbor@harbor-${stamp}.test`, country: "Australia" });
    const cA3 = await customer(ORG_A, `Example Textiles Buyer ${stamp}`, { country: "Canada" });
    const cA4 = await customer(ORG_A, `Archived Buyer ${stamp}`, { archivedAt: new Date("2026-10-01T00:00:00Z") });
    // o1：当地今天 01:00 新建（UTC 仍是 10/23），回复新询盘已超时 60 分钟
    const o1 = await opportunity(ORG_A, cA1.id, {
      createdAt: new Date("2026-10-23T17:00:00Z"), stage: "new_inquiry", score: 82, scoreGrade: "HOT", market: "Canada", source: "website_inquiry",
      nextActionType: "reply_inquiry", nextFollowupAt: new Date("2026-10-24T01:00:00Z"),
    });
    // o2：当地昨天 23:00 新建（与 o1 同一个 UTC 日期）——不算今天
    const o2 = await opportunity(ORG_A, cA2.id, {
      createdAt: new Date("2026-10-23T15:00:00Z"), stage: "needs_info", score: 74, scoreGrade: "HIGH", market: "Australia", source: "trade_show",
      nextActionType: "reply_customer", nextFollowupAt: new Date("2026-10-24T06:00:00Z"),
    });
    const o3 = await opportunity(ORG_A, cA3.id, {
      createdAt: new Date("2026-10-20T02:00:00Z"), stage: "quoted", score: 70, scoreGrade: "HIGH", market: "Canada", source: "email",
      nextActionType: "quote_follow_up", nextFollowupAt: new Date("2026-10-24T08:00:00Z"),
    });
    await opportunity(ORG_A, cA4.id, { createdAt: new Date("2026-10-24T01:00:00Z"), stage: "new_inquiry", source: "website_inquiry" });
    await opportunity(ORG_A, cA3.id, {
      createdAt: new Date("2026-10-19T02:00:00Z"), stage: "quoted", source: "email",
      nextActionType: "quote_follow_up", nextFollowupAt: new Date("2026-10-24T17:00:00Z"), // 当地明天 01:00
    });
    const cB1 = await customer(ORG_B, `Fjord Living ${stamp}`, { country: "Norway" });
    const oB1 = await opportunity(ORG_B, cB1.id, { createdAt: new Date("2026-10-24T00:30:00Z"), stage: "new_inquiry", source: "website_inquiry", assignedToId: OTHER });
    const cS1 = await customer(ORG_SALES, `Blinds Lead ${stamp}`);
    await opportunity(ORG_SALES, cS1.id, { createdAt: new Date("2026-10-24T00:30:00Z"), stage: "new_inquiry", source: "manual", assignedToId: OTHER });

    // 外贸：线索 → 商机映射、寄样单、报价单
    const campaign = await db.tradeCampaign.create({ data: { orgId: ORG_A, name: `Fixture campaign ${stamp}`, productDesc: "towels", targetMarket: "Canada", createdById: OWNER } });
    const prospect = (data: { companyName: string; convertedToSalesOpportunityId?: string | null; country?: string }) =>
      db.tradeProspect.create({ data: { orgId: ORG_A, campaignId: campaign.id, ...data }, select: { id: true } });
    const p3 = await prospect({ companyName: `Example Textiles Buyer ${stamp}`, convertedToSalesOpportunityId: o3.id, country: "Canada" });
    const p6 = await prospect({ companyName: `Harbor Linen Co ${stamp}`, country: "Australia" });
    const p7 = await prospect({ companyName: `Replied Buyer ${stamp}` });
    const p8 = await prospect({ companyName: `Cross Org Mapping ${stamp}`, convertedToSalesOpportunityId: oB1.id });
    const sample = (prospectId: string, shippedAt: string, followUpDueAt: string, extra: Record<string, unknown> = {}) =>
      db.tradeSample.create({ data: { orgId: ORG_A, prospectId, productName: "Bath towel 550gsm", status: "shipped", shippedAt: new Date(shippedAt), followUpDueAt: new Date(followUpDueAt), createdById: OWNER, ...extra }, select: { id: true } });
    const s3 = await sample(p3.id, "2026-10-17T02:00:00Z", "2026-10-24T03:00:00Z");
    const s6 = await sample(p6.id, "2026-10-16T02:00:00Z", "2026-10-23T03:00:00Z");
    await sample(p7.id, "2026-10-15T02:00:00Z", "2026-10-22T03:00:00Z");
    await db.tradeMessage.create({ data: { prospectId: p7.id, direction: "inbound", content: "Received the samples, thanks.", createdAt: new Date("2026-10-20T02:00:00Z") } });
    await sample(p3.id, "2026-10-17T02:00:00Z", "2026-10-24T04:00:00Z", { followedUpAt: new Date("2026-10-23T02:00:00Z") }); // 已跟进
    const quote = (prospectId: string | null, status: string, expiresAt: string, n: string) =>
      db.tradeQuote.create({ data: { orgId: ORG_A, prospectId, quoteNumber: `QT-${stamp}-${n}`, companyName: `Quote Buyer ${n}`, status, expiresAt: new Date(expiresAt), createdById: OWNER }, select: { id: true } });
    const q3 = await quote(p3.id, "sent", "2026-10-24T10:00:00Z", "3");
    const q8 = await quote(p8.id, "negotiating", "2026-10-24T05:00:00Z", "8");
    await quote(p6.id, "draft", "2026-10-24T05:00:00Z", "9");
    await quote(p6.id, "sent", "2026-10-25T05:00:00Z", "10"); // 当地明天 13:00

    // 审批
    const paA1 = await pending(ORG_A, { payload: { opportunityId: o1.id, to: `buyer1@maple-${stamp}.test` }, createdAt: new Date("2026-10-24T01:00:00Z") });
    const paA2 = await pending(ORG_A, { payload: { opportunityId: o2.id }, createdAt: new Date("2026-10-24T01:10:00Z"), expiresAt: new Date(NOW.getTime() + 48 * HOUR) });
    await pending(ORG_A, { payload: { opportunityId: o1.id }, expiresAt: new Date(NOW.getTime() - HOUR) });
    await pending(ORG_A, { payload: { opportunityId: o1.id }, status: "executed" });
    // 微信可确认的内部备注须写内部可见目标（写报价备注的不进微信批次），这里用客户时间线
    const NOTE_PAYLOAD = { targetType: "CUSTOMER", targetId: "cust_fixture", note: "n" };
    const paA5 = await pending(ORG_A, { type: "grader.internal_note", title: "内部备注", createdAt: new Date("2026-10-24T01:20:00Z"), payload: NOTE_PAYLOAD });
    // B 组织的草稿冒用 A 的商机 id：不能出现在 A，也不能在 B 里关联到 A 的商机
    const paB1 = await pending(ORG_B, { payload: { opportunityId: o1.id }, createdById: OTHER });

    console.log("\n[1] buildOwnerToday（Asia/Shanghai，当地 10:00）");
    const t = await buildOwnerToday(ORG_A, { now: NOW });
    ok(t.timeZone === "Asia/Shanghai" && t.day === "2026-10-24" && t.dayStart.toISOString() === "2026-10-23T16:00:00.000Z", "组织时区来自 settingsJson，当地零点 = UTC 16:00", { tz: t.timeZone, day: t.day, start: t.dayStart });
    ok(t.counts.newToday === 1 && t.newToday[0]?.opportunityId === o1.id, "今日新询盘只有 o1（当地昨天 23:00 的 o2 不算；归档客户不算；B 组织不算）", t.newToday.map((c) => c.opportunityId));
    ok(t.newToday[0]?.sourceLabel === "官网" && t.newToday[0]?.market === "Canada" && t.newToday[0]?.ageMinutes === 540, "卡片：来源标签 / 国家 / 已过多久", t.newToday[0]);
    ok(t.counts.overdue === 1 && t.overdue[0]?.opportunityId === o1.id && t.overdue[0]?.overdueMinutes === 60, "回复超时：o1 超时 60 分钟（o2 时限未到）", t.overdue);
    ok(
      t.counts.approvals === 2 && t.approvals.map((a) => a.pendingActionId).join() === [paA1.id, paA2.id].join(),
      "待审批：A 组织 pending 且未过期的询盘回复两封，按评分排序（过期 / 已执行 / 其它类型 / B 组织的都不算）",
      t.approvals.map((a) => a.pendingActionId),
    );
    ok(t.approvals[0]?.opportunity?.opportunityId === o1.id && t.approvals[1]?.opportunity?.scoreGrade === "HIGH" && /中文对照/.test(t.approvals[0]?.preview ?? ""), "审批按 payload.opportunityId 关联商机，并带审批预览", t.approvals[1]?.opportunity);
    const keys = t.samplesQuotesDue.map((d) => d.key);
    ok(keys.join() === [`trade_sample:${s6.id}`, `opp:${o3.id}`, `trade_quote:${q8.id}`].join(), "样品与报价：3 张卡（未映射寄样单 / o3 合并 / 跨组织映射的报价按未映射）", keys);
    const merged = t.samplesQuotesDue.find((d) => d.key === `opp:${o3.id}`);
    ok(
      !!merged && merged.reasons.length === 3 && merged.reasons.some((r) => r.refId === s3.id) && merged.reasons.some((r) => r.refId === q3.id) && merged.kinds.length === 2,
      "o3：Revenue Spine 报价跟进 + 寄样单 + 报价单合并成一张卡（已跟进的寄样单、买家已回信的寄样单不算）",
      merged,
    );
    ok(t.samplesQuotesDue[0]?.overdue === true && t.samplesQuotesDue[0]?.href === `/trade/samples/${s6.id}`, "未映射的寄样单链接到寄样详情，已过期标红", t.samplesQuotesDue[0]);
    const tB = await buildOwnerToday(ORG_B, { now: NOW });
    ok(tB.counts.newToday === 1 && tB.newToday[0]?.opportunityId === oB1.id && tB.counts.approvals === 1 && tB.approvals[0]?.pendingActionId === paB1.id && tB.approvals[0]?.opportunity === null, "B 组织只看到自己的；冒用 A 商机 id 的草稿关联不到 A 的商机", { newToday: tB.newToday, approvals: tB.approvals });
    const tTor = await buildOwnerToday(ORG_A, { now: NOW, timeZone: "America/Toronto" });
    ok(tTor.day === "2026-10-23" && tTor.counts.newToday === 2, "换成多伦多时区：当地还是 10/23，o1 与 o2 都算今天（证明按组织时区而不是 UTC 切日）", { day: tTor.day, n: tTor.counts.newToday });

    console.log("\n[2] 老板询盘早报");
    const pushes: Array<{ userId: string; title: string; text: string }> = [];
    const push = async (userId: string, title: string, text: string) => {
      pushes.push({ userId, title, text });
      return { sent: 1, failed: 0 };
    };
    const brief = await sendOwnerInquiryBrief(ORG_A, "Asia/Shanghai", { now: NOW, push, origin: ORIGIN });
    ok(brief.skipped === null && brief.recipients === 1 && brief.sent === 1 && brief.wechatDelivered === 1 && pushes.length === 1 && pushes[0].userId === OWNER, "发给管理层（组织所有者 / 老板），外贸员不收", { brief, to: pushes.map((p) => p.userId) });
    const text = pushes[0]?.text ?? "";
    ok(text.includes(`HOT 82 · Canada · 官网 · Maple Home Goods ${stamp}`) && text.includes("HIGH 74 · Australia · 展会 · 未留公司名"), "待审批前 3：评分 · 国家 · 来源 · 公司（拿邮箱当名字的客户显示「未留公司名」）", text);
    ok(!EMAIL.test(text) && !EMAIL.test(pushes[0]?.title ?? ""), "早报不含任何邮箱", text);
    ok(text.endsWith(`${ORIGIN}/revenue/today`), "早报带今日询盘页深链", text.slice(-80));
    const note = await db.notification.findUnique({ where: { sourceKey: `owner-inquiry-brief:${ORG_A}:2026-10-24:${OWNER}` } });
    ok(note?.type === "revenue_owner_brief" && note.orgId === ORG_A, "青砚通知 sourceKey 带组织与当地日期", note?.sourceKey);
    const again = await sendOwnerInquiryBrief(ORG_A, "Asia/Shanghai", { now: new Date(NOW.getTime() + HOUR), push, origin: ORIGIN });
    ok(again.sent === 0 && pushes.length === 1, "同一当地日期重跑不重发", again);
    const salesOrg = await sendOwnerInquiryBrief(ORG_SALES, "Asia/Shanghai", { now: NOW, push, origin: ORIGIN });
    ok(salesOrg.skipped === "no_trade_module" && pushes.length === 1, "未启用外贸模块的组织（有今日商机）不发", salesOrg);
    const empty = await sendOwnerInquiryBrief(ORG_EMPTY, "Asia/Shanghai", { now: NOW, push, origin: ORIGIN });
    ok(empty.skipped === "empty" && empty.sent === 0 && pushes.length === 1, "四栏全为 0 不发", empty);
    // pushNotification 在没绑微信 / 静默时段时不抛错，只返回 sent=0：通知照写，但不算微信送达
    const silentBrief = await sendOwnerInquiryBrief(ORG_B, "Asia/Shanghai", { now: NOW, push: async () => ({ sent: 0, failed: 0 }), origin: ORIGIN });
    ok(silentBrief.skipped === null && silentBrief.sent === 1 && silentBrief.wechatDelivered === 0, "微信没送达（未绑定 / 静默时段）：青砚通知照发，wechatDelivered 如实为 0", silentBrief);

    console.log("\n[3] FDE 新草稿微信提醒（按组织开关，每人每小时一条）");
    const draftPushes: Array<{ userId: string; text: string }> = [];
    const pushNewDraft = async (userId: string, _title: string, body: string) => {
      draftPushes.push({ userId, text: body });
      return { sent: 1, failed: 0 };
    };
    const t0 = new Date("2026-10-19T08:00:00Z");
    const BRANDS = ["Northwind", "Bluewater", "Cedarline", "Driftwood", "Elmstone"];
    const runFor = async (n: number, at: Date) => {
      const brand = BRANDS[n];
      const company = `${brand} Home ${stamp}`;
      const intake = await intakeInquiry({
        orgId: ORG_C,
        source: "website_inquiry",
        contact: { name: `Olivia ${brand}`, email: `olivia.${stamp}@${brand.toLowerCase()}-${stamp}.test`, company, country: "Canada" },
        message: RFQ(company),
        now: at,
      });
      if (!intake.ok) throw new Error(`intake ${n} failed: ${JSON.stringify(intake)}`);
      return runInboundSalesFde({ orgId: ORG_C, opportunityId: intake.opportunityId, salesActionId: intake.salesActionId, trigger: "inquiry", useLlm: false, now: at, pushNewDraft });
    };
    const off = await runFor(0, t0);
    ok(!!off.pendingActionId && draftPushes.length === 0, "开关默认关闭：有新草稿也不推", { pa: off.pendingActionId, pushes: draftPushes.length });
    await publishRevenueSpineRule({ orgId: ORG_C, ruleKey: RULE_KEY_POLICY, config: { notify: { wechatOnNewDraft: true } }, userId: OWNER_C });
    const r1 = await runFor(1, new Date(t0.getTime() + HOUR));
    ok(!!r1.pendingActionId && draftPushes.length === 1 && draftPushes[0].userId === REP_C, "打开后：新草稿推给审批人（商机负责人）", { pa: r1.pendingActionId, pushes: draftPushes });
    ok(!EMAIL.test(draftPushes[0]?.text ?? "") && (draftPushes[0]?.text ?? "").includes("/revenue/today") && (draftPushes[0]?.text ?? "").includes("官网"), "提醒不含买家邮箱，带今日询盘链接与来源", draftPushes[0]?.text);
    const r2 = await runFor(2, new Date(t0.getTime() + HOUR + 20 * 60_000));
    ok(!!r2.pendingActionId && draftPushes.length === 1, "同一小时内第二封新草稿不再推", { pa: r2.pendingActionId, pushes: draftPushes.length });
    const rerun = await runInboundSalesFde({ orgId: ORG_C, opportunityId: r1.opportunityId, trigger: "manual", useLlm: false, now: new Date(t0.getTime() + 3 * HOUR), pushNewDraft });
    ok(rerun.pendingActionId === r1.pendingActionId && draftPushes.length === 1, "重跑复用同一封未决草稿：不算新草稿，不推", { rerun: rerun.pendingActionId, first: r1.pendingActionId, pushes: draftPushes.length });
    const r3 = await runFor(3, new Date(t0.getTime() + 2 * HOUR + 5 * 60_000));
    ok(!!r3.pendingActionId && draftPushes.length === 2, "下一个小时的新草稿再推一条", { pushes: draftPushes.length });
    const direct = await pushNewDraftToApprover({ orgId: ORG_C, userId: REP_C, opportunityId: r3.opportunityId, pendingActionId: r3.pendingActionId!, buyer: { scoreGrade: "HOT", score: 90, market: "Canada", source: "email", customerName: "x" }, now: new Date(t0.getTime() + 2 * HOUR + 30 * 60_000), push: pushNewDraft });
    ok(direct.pushed === false && direct.reason === "duplicate_hour" && draftPushes.length === 2, "去重靠通知 sourceKey 的唯一约束（先占位再推）", direct);
    await publishRevenueSpineRule({ orgId: ORG_C, ruleKey: RULE_KEY_POLICY, config: { notify: { wechatOnNewDraft: false } }, userId: OWNER_C });
    const r4 = await runFor(4, new Date(t0.getTime() + 5 * HOUR));
    ok(!!r4.pendingActionId && draftPushes.length === 2, "关掉后不再推", { pushes: draftPushes.length });
    // 没送达就释放本小时的占位：下一封新草稿还会再试
    const directArgs = { orgId: ORG_C, userId: REP_C, opportunityId: r3.opportunityId, pendingActionId: r3.pendingActionId!, buyer: { scoreGrade: "HOT", score: 90, market: "Canada", source: "email", customerName: "x" } };
    const h7 = new Date(t0.getTime() + 7 * HOUR + 5 * 60_000);
    const silent = await pushNewDraftToApprover({ ...directArgs, now: h7, push: async () => ({ sent: 0, failed: 0 }) });
    const silentMarker = await db.notification.findUnique({ where: { sourceKey: newDraftPushSourceKey(ORG_C, REP_C, h7) } });
    ok(silent.pushed === false && silent.reason === "no_binding_or_silent" && !silentMarker, "没绑微信 / 静默时段（sent=0）：不算已提醒，释放本小时占位", { silent, marker: silentMarker?.id ?? null });
    const retry = await pushNewDraftToApprover({ ...directArgs, now: new Date(h7.getTime() + 20 * 60_000), push: pushNewDraft });
    ok(retry.pushed === true && draftPushes.length === 3, "同一小时内的下一封新草稿再试一次并送达", { retry, pushes: draftPushes.length });
    const h8 = new Date(t0.getTime() + 8 * HOUR + 5 * 60_000);
    const failedCh = await pushNewDraftToApprover({ ...directArgs, now: h8, push: async () => ({ sent: 0, failed: 1 }) });
    const thrown = await pushNewDraftToApprover({ ...directArgs, now: new Date(h8.getTime() + 10 * 60_000), push: async () => { throw new Error("adapter down"); } });
    const h8Marker = await db.notification.findUnique({ where: { sourceKey: newDraftPushSourceKey(ORG_C, REP_C, h8) } });
    ok(failedCh.reason === "push_failed" && thrown.reason === "push_failed" && thrown.pushed === false && !h8Marker, "通道失败 / 抛错：报告 push_failed，同样释放占位", { failedCh, thrown, marker: h8Marker?.id ?? null });

    console.log("\n[4] 微信回数字：询盘回复草稿不进批次，只取当前组织");
    const paNull = await pending(null, { type: "grader.internal_note", title: "个人备注", createdAt: new Date("2026-10-24T01:30:00Z"), payload: NOTE_PAYLOAD });
    const paB2 = await pending(ORG_B, { type: "grader.internal_note", title: "B 组织备注", createdAt: new Date("2026-10-24T01:40:00Z"), payload: NOTE_PAYLOAD });
    const batch = await getRecentPendingActionsForWeChat(REP, ORG_A);
    const ids = batch.map((b) => b.id);
    ok(ids.includes(paA5.id) && ids.includes(paNull.id) && !ids.includes(paA1.id) && !ids.includes(paA2.id) && !ids.includes(paB2.id), "批次只有 A 组织 / 无组织的非邮件动作（询盘回复与 B 组织的都不在）", { ids, paA5: paA5.id, paNull: paNull.id });
    const paO1 = await pending(ORG_A, { createdById: OWNER, payload: { opportunityId: o3.id } });
    const reply = await handleWeChatPendingReply("1", { userId: OWNER, orgId: ORG_A });
    const stillPending = await db.pendingAction.findUnique({ where: { id: paO1.id }, select: { status: true } });
    ok(reply.handled && /今日询盘/.test(reply.reply ?? "") && stillPending?.status === "pending", "老板回「1」：不批准给买家的邮件，提示去今日询盘页看草稿", { reply: reply.reply, status: stillPending?.status });
    const cancel = await handleWeChatPendingReply("取消", { userId: OWNER, orgId: ORG_A });
    const afterCancel = await db.pendingAction.findUnique({ where: { id: paO1.id }, select: { status: true } });
    ok(cancel.handled && afterCancel?.status === "pending", "回「取消」也不会拒掉询盘回复草稿", { reply: cancel.reply, status: afterCancel?.status });

    console.log("\n[5] 微信绑定：只能改 / 解绑本人的");
    const bRep = await db.weChatBinding.create({ data: { userId: REP, orgId: ORG_A, channel: "personal_wechat", externalId: `wx_rep_${stamp}` } });
    const bOwner = await db.weChatBinding.create({ data: { userId: OWNER, orgId: ORG_A, channel: "personal_wechat", externalId: `wx_owner_${stamp}` } });
    const hijack = await updateBindingPreferences(REP, bOwner.id, sanitizeBindingPreferences({ pushBriefing: false, userId: REP }));
    const remove = await removeBinding(REP, bOwner.id);
    const ownerAfter = await db.weChatBinding.findUnique({ where: { id: bOwner.id } });
    ok(!hijack && !remove && ownerAfter?.pushBriefing === true && ownerAfter.status === "active" && ownerAfter.userId === OWNER, "别人的绑定：改偏好 / 解绑都不生效", ownerAfter);
    const own = await updateBindingPreferences(REP, bRep.id, sanitizeBindingPreferences({ pushBriefing: false, userId: OWNER, status: "expired" }));
    const repAfter = await db.weChatBinding.findUnique({ where: { id: bRep.id } });
    ok(own && repAfter?.pushBriefing === false && repAfter.userId === REP && repAfter.status === "active", "本人的绑定可改偏好，但改不了归属与状态", repAfter);
    ok((await removeBinding(REP, bRep.id)) && (await db.weChatBinding.findUnique({ where: { id: bRep.id } }))?.status === "disconnected", "本人可以解绑");

    console.log("\n[6] 待审批超过查询上限：保留最新的，计数不截断");
    const BULK = 205;
    const bulkBase = new Date("2026-10-20T00:00:00Z").getTime();
    await db.pendingAction.createMany({
      data: Array.from({ length: BULK }, (_, i) => ({
        id: `otk_pa_${stamp}_${String(i).padStart(3, "0")}`,
        orgId: ORG_BULK,
        type: INQUIRY_REPLY_ACTION_TYPE,
        title: `发送询盘回复 #${i}`,
        preview: "Subject: Re: towels\n\n——— 中文对照（仅供审核，不会发送）———",
        payload: {},
        status: "pending",
        createdById: OTHER,
        approverUserId: OTHER,
        createdAt: new Date(bulkBase + i * 60_000),
        expiresAt: new Date(Math.max(NOW.getTime(), Date.now()) + 72 * HOUR),
      })),
    });
    const bulk = await buildOwnerToday(ORG_BULK, { now: NOW, limit: 1000 });
    const bulkIds = new Set(bulk.approvals.map((a) => a.pendingActionId));
    ok(
      bulk.counts.approvals === BULK && bulk.approvals.length === 200 && bulkIds.has(`otk_pa_${stamp}_204`) && !bulkIds.has(`otk_pa_${stamp}_000`),
      "超过 200 封：计数是真实总数，列表保留最新的草稿（丢的是最早的）",
      { count: bulk.counts.approvals, listed: bulk.approvals.length },
    );
  } finally {
    try {
      for (const orgId of ORGS) {
        const prospects = await db.tradeProspect.findMany({ where: { orgId }, select: { id: true } });
        await db.tradeSample.deleteMany({ where: { orgId } });
        await db.tradeQuote.deleteMany({ where: { orgId } });
        await db.tradeMessage.deleteMany({ where: { prospectId: { in: prospects.map((p) => p.id) } } });
        await db.tradeProspect.deleteMany({ where: { orgId } });
        await db.tradeCampaign.deleteMany({ where: { orgId } });
        await db.websiteInquiryReceipt.deleteMany({ where: { orgId } });
        await db.pendingAction.deleteMany({ where: { orgId } });
        await db.notification.deleteMany({ where: { orgId } });
        await db.weChatBinding.deleteMany({ where: { orgId } });
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
      await db.weChatBinding.deleteMany({ where: { userId: { in: USERS } } });
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
