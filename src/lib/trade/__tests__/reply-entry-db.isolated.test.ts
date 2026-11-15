/**
 * NAV-1c：看到来信就能回 — 真实 DB 端到端（隔离库，虚构企业；spec trade/inquiry-reply-entry）
 *
 *   [1] 网站询盘进线 → 客户详情接口给出回复目标（= 这次进线建立的线索）；
 *       窗饰销售的客户详情全部为空；有商机无线索为空；别的企业的线索指向同一商机也不出目标。
 *   [2] 单会话接口：120 天前的会话不在列表（默认 90 天）里，按线索 id / 商机 id 都能取到全文；
 *       不存在 / 别的企业 / 商机没有线索 → 同样的 404；没有外贸键 → 403；只读。
 *   [3] 手写回复经回复接口（mark_sent：测试里不真发邮件）→ 留底 aiDraft=false、会话已回复、
 *       同商机待批草稿被系统作废、客户时间线多一条发出互动；声明来自草稿 → aiDraft=true。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/trade/__tests__/reply-entry-db.isolated.test.ts
 * 无隔离库时自动跳过。只用虚构企业名与 fixture.test 邮箱。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 NAV-1c 回复入口隔离 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "NAV-1c reply entry DB test" });
process.env.JWT_SECRET = process.env.JWT_SECRET || "nav1c-isolated-test-secret-0123456789abcdef";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1200) : "");
  }
}

type Json = Record<string, unknown>;
type InteractionJson = { id: string; direction: string | null; opportunityId: string | null; replyTarget?: { prospectId: string } | null };

const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const id = (p: string) => `fx_nav1c_${p}_${stamp}`;
const CATHY = id("cathy");
const LYNN = id("lynn");
const OTHER = id("other");
const VIEWER = id("viewer"); // NAV-6：只持查看外贸键的成员（测试岗位只建在本测试的夹具里）
const USERS = [CATHY, LYNN, OTHER, VIEWER];
const HT = id("orght"); // 家纺外贸（岗位模式）
const WC = id("orgwc"); // 窗饰
const HT2 = id("orght2"); // 另一家外贸企业
const ORGS = [HT, WC, HT2];

async function main() {
  const { db } = await import("@/lib/db");
  const { NextRequest } = await import("next/server");
  const { createSession } = await import("@/lib/auth/session");
  const { seedOrgAuthorizationProfiles } = await import("@/lib/authorization/seed-org-profiles");
  const { DEFAULT_MENGXIN_MODULES, DEFAULT_SUNNY_MODULES } = await import("@/lib/tenancy");
  const { ingestWebsiteInquiry, normalizeInquiry } = await import("@/lib/trade/website-inquiry");
  const { intakeInquiry } = await import("@/lib/revenue-spine/inquiry-intake");
  const { INQUIRY_REPLY_ACTION_TYPE } = await import("@/lib/revenue-spine/fde/inbound-sales");
  const { createProspect, createMessage } = await import("@/lib/trade/service");
  const { ensureInquiryCampaign } = await import("@/lib/trade/website-inquiry");
  const customerRoute = await import("@/app/api/sales/customers/[id]/route");
  const inboxRoute = await import("@/app/api/trade/inbox/route");
  const focusRoute = await import("@/app/api/trade/inbox/focus/route");
  const replyRoute = await import("@/app/api/trade/inbox/[prospectId]/reply/route");

  const req = async (userId: string, url: string, init?: { method?: string; body?: Json }) => {
    const token = await createSession({ sub: userId, email: `${userId}@fixture.test`, role: "user" });
    return new NextRequest(`http://localhost${url}`, {
      method: init?.method ?? "GET",
      headers: { cookie: `qy_session=${token}`, "content-type": "application/json" },
      ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
    });
  };
  const customerDetail = async (userId: string, orgId: string, customerId: string) => {
    const res = await customerRoute.GET(await req(userId, `/api/sales/customers/${customerId}?orgId=${orgId}`), { params: Promise.resolve({ id: customerId }) });
    return { status: res.status, body: (await res.json()) as { interactions?: InteractionJson[] } & Json };
  };
  const focus = async (userId: string, orgId: string, query: string) => {
    const res = await focusRoute.GET(await req(userId, `/api/trade/inbox/focus?orgId=${orgId}&${query}`));
    return { status: res.status, body: (await res.json()) as Json };
  };

  try {
    // ── 种子 ──
    for (const uid of USERS) await db.user.create({ data: { id: uid, email: `${uid}@fixture.test`, name: `Example ${uid.slice(9, 15)}`, role: "user" } });
    await db.organization.create({ data: { id: HT, name: `Example Textiles ${stamp}`, code: `fx-nav1c-ht-${stamp}`, ownerId: CATHY, industryPackId: "home_textile_trade_v1", modulesJson: { enabled: [...DEFAULT_MENGXIN_MODULES] } } });
    await db.organization.create({ data: { id: WC, name: `Example Blinds ${stamp}`, code: `fx-nav1c-wc-${stamp}`, ownerId: LYNN, industryPackId: "window_covering_services_v1", modulesJson: { enabled: [...DEFAULT_SUNNY_MODULES] } } });
    await db.organization.create({ data: { id: HT2, name: `Example Linen ${stamp}`, code: `fx-nav1c-ht2-${stamp}`, ownerId: OTHER, industryPackId: "home_textile_trade_v1", modulesJson: { enabled: [...DEFAULT_MENGXIN_MODULES] } } });
    await db.organizationMember.createMany({
      data: [
        { orgId: HT, userId: CATHY, role: "org_admin", status: "active" },
        { orgId: WC, userId: LYNN, role: "org_member", status: "active" },
        { orgId: HT2, userId: OTHER, role: "org_admin", status: "active" },
        { orgId: HT, userId: VIEWER, role: "org_member", status: "active" },
      ],
    });
    await db.user.update({ where: { id: CATHY }, data: { activeOrgId: HT } });
    await db.user.update({ where: { id: LYNN }, data: { activeOrgId: WC } });
    await db.user.update({ where: { id: OTHER }, data: { activeOrgId: HT2 } });
    await db.user.update({ where: { id: VIEWER }, data: { activeOrgId: HT } });
    for (const o of ORGS) await seedOrgAuthorizationProfiles(o);
    const bind = async (orgId: string, userId: string, key: string) => {
      const profile = await db.roleProfile.findUnique({ where: { orgId_key: { orgId, key } } });
      if (!profile) throw new Error(`岗位 ${key} 不存在于 ${orgId}`);
      await db.principalRoleBinding.create({ data: { orgId, principalType: "HUMAN", principalId: userId, roleProfileId: profile.id, status: "active" } });
    };
    await bind(HT, CATHY, "owner");
    await bind(HT, CATHY, "trade_rep");
    await bind(WC, LYNN, "sales_rep");
    await bind(HT2, OTHER, "owner");
    await bind(HT2, OTHER, "trade_rep");
    // NAV-6：系统里没有只读的外贸岗位模板，这里在夹具企业里建一个只含 trade.read 的测试岗位
    const viewerProfile = await db.roleProfile.create({ data: { orgId: HT, key: "fx_trade_viewer", name: "外贸查看（测试）", principalType: "HUMAN", isSystem: false, status: "active" } });
    await db.rolePermissionBinding.create({ data: { orgId: HT, roleProfileId: viewerProfile.id, permissionKey: "trade.read", dataScope: "ORG", effect: "ALLOW" } });
    await bind(HT, VIEWER, "fx_trade_viewer");

    // ───────── [1] 回复目标 ─────────
    console.log("\n[1] 客户互动的回复目标");
    const form = normalizeInquiry({ name: "Mark Chen", email: "mark@maple-hotels.fixture.test", company: "Maple Hotels Group", country: "Canada", message: "We need 3,000 blackout curtains for a hotel project. Please advise MOQ, pricing and delivery time." });
    if (!form.ok || form.value.honeypotTripped) throw new Error("fixture normalize failed");
    const w = await ingestWebsiteInquiry(HT, form.value, { runFde: false });
    if (!w.spine.ok) throw new Error(`fixture ingest failed: ${JSON.stringify(w.spine)}`);
    const prospectId = w.prospectId;
    const opportunityId = w.spine.opportunityId;
    const customerId = w.spine.customerId;

    const d1 = await customerDetail(CATHY, HT, customerId);
    const inbound1 = (d1.body.interactions ?? []).filter((i) => i.direction === "inbound");
    ok(d1.status === 200 && inbound1.length === 1 && inbound1[0].replyTarget?.prospectId === prospectId, "网站询盘进线后，老板 + 外贸业务员看到的来信互动带回复目标 = 这次进线的线索", { status: d1.status, inbound1, prospectId });

    // 有商机无线索（邮件进线不建外贸线索）
    const mail = await intakeInquiry({ orgId: HT, source: "email", contact: { name: "Anna", email: "anna@nordic-linen.fixture.test", company: "Nordic Linen AB" }, message: "Need 1000 blankets.", actorUserId: CATHY });
    if (!mail.ok) throw new Error("fixture email intake failed");
    const d2 = await customerDetail(CATHY, HT, mail.customerId);
    const inbound2 = (d2.body.interactions ?? []).filter((i) => i.direction === "inbound");
    ok(d2.status === 200 && inbound2.length >= 1 && inbound2.every((i) => i.replyTarget === null), "有商机、没有对应线索的来信：回复目标为空", inbound2);

    // 别的企业里有线索指向同一个商机 id：不出目标
    const camp2 = await ensureInquiryCampaign(HT2);
    const foreign = await createProspect({ campaignId: camp2, orgId: HT2, companyName: "Foreign Prospect", contactEmail: "x@foreign.fixture.test", source: "website_inquiry" });
    await db.tradeProspect.update({ where: { id: foreign.id }, data: { convertedToSalesOpportunityId: mail.opportunityId } });
    const d3 = await customerDetail(CATHY, HT, mail.customerId);
    ok((d3.body.interactions ?? []).every((i) => i.replyTarget === null), "别的企业的线索指向同一商机 id：本企业仍为空（只在本企业内解析）", d3.body.interactions);
    const d1b = await customerDetail(CATHY, HT, customerId);
    ok((d1b.body.interactions ?? []).find((i) => i.direction === "inbound")?.replyTarget?.prospectId === prospectId, "本企业自己的线索不受别的企业影响");

    // 窗饰销售：自己的客户，来信挂着商机，但企业没开外贸模块、也没有外贸键
    const wcIn = await intakeInquiry({ orgId: WC, source: "email", contact: { name: "Homeowner", email: "owner@home.fixture.test" }, message: "Quote for 6 zebra blinds please.", actorUserId: LYNN });
    if (!wcIn.ok) throw new Error("fixture wc intake failed");
    const d4 = await customerDetail(LYNN, WC, wcIn.customerId);
    const lynnInteractions = d4.body.interactions ?? [];
    ok(d4.status === 200 && lynnInteractions.length >= 1 && lynnInteractions.every((i) => i.replyTarget === null), "窗饰销售的客户详情：每条互动的回复目标都为空", { status: d4.status, lynnInteractions });

    // ───────── [2] 单会话接口 ─────────
    console.log("\n[2] 单个买家会话的只读接口");
    const camp = await ensureInquiryCampaign(HT);
    const old = await createProspect({ campaignId: camp, orgId: HT, companyName: "Old Buyer Co", contactName: "Olga", contactEmail: "olga@old-buyer.fixture.test", source: "website_inquiry" });
    const longText = `Hello, ${"we are still interested in your bedding sets. ".repeat(12)}Regards, Olga`;
    const oldMsg = await createMessage({ prospectId: old.id, direction: "inbound", channel: "email", subject: "Bedding inquiry", content: longText });
    const daysAgo = new Date(Date.now() - 120 * 86_400_000);
    await db.tradeMessage.update({ where: { id: oldMsg.id }, data: { createdAt: daysAgo } });
    await db.tradeProspect.update({ where: { id: old.id }, data: { convertedToSalesOpportunityId: mail.opportunityId } }); // 借用上面那个没有线索的商机

    const listRes = await inboxRoute.GET(await req(CATHY, `/api/trade/inbox?orgId=${HT}&filter=all`));
    const list = (await listRes.json()) as { items: Array<{ prospectId: string }> };
    ok(listRes.status === 200 && !list.items.some((t) => t.prospectId === old.id) && list.items.some((t) => t.prospectId === prospectId), "列表接口（默认 90 天）：不含 120 天前的会话，含刚进线的会话");

    const counts = async () => ({
      prospects: await db.tradeProspect.count({ where: { orgId: { in: ORGS } } }),
      messages: await db.tradeMessage.count({ where: { prospect: { orgId: { in: ORGS } } } }),
      opportunities: await db.salesOpportunity.count({ where: { orgId: { in: ORGS } } }),
      interactions: await db.customerInteraction.count({ where: { orgId: { in: ORGS } } }),
      pending: await db.pendingAction.count({ where: { orgId: { in: ORGS } } }),
    });
    const before = await counts();
    const f1 = await focus(CATHY, HT, `prospectId=${old.id}`);
    const f1Thread = f1.body.thread as { prospectId: string; replied: boolean; lastInboundSubject: string | null; lastInboundExcerpt: string } | undefined;
    const f1Last = f1.body.lastInbound as { subject: string | null; content: string } | null;
    ok(f1.status === 200 && f1Thread?.prospectId === old.id && f1Thread.replied === false && f1Last?.subject === "Bedding inquiry" && f1Last.content === longText && f1Thread.lastInboundExcerpt.length < longText.length, "按线索 id：取到 120 天前的会话与最后一封来信全文（列表里只有摘要）", { status: f1.status, thread: f1Thread, len: f1Last?.content.length });
    const f2 = await focus(CATHY, HT, `opportunityId=${mail.opportunityId}`);
    ok(f2.status === 200 && (f2.body.thread as { prospectId?: string } | undefined)?.prospectId === old.id, "按商机 id：换成本企业的线索，得到同一位买家（不是别的企业那条）", f2.body);

    const nf = await Promise.all([
      focus(CATHY, HT, `prospectId=${id("nope")}`),
      focus(CATHY, HT, `prospectId=${foreign.id}`),
      focus(CATHY, HT, `opportunityId=${wcIn.opportunityId}`),
    ]);
    ok(nf.every((r) => r.status === 404 && r.body.code === "THREAD_NOT_FOUND" && !("thread" in r.body)) && new Set(nf.map((r) => JSON.stringify(r.body))).size === 1, "不存在 / 别的企业的线索 / 没有线索的商机：同样的 404，不含买家信息", nf.map((r) => ({ s: r.status, b: r.body })));
    const noParam = await focus(CATHY, HT, "x=1");
    ok(noParam.status === 400, "缺少 prospectId 与 opportunityId → 400");
    const denied = await focus(LYNN, WC, `prospectId=${old.id}`);
    ok(denied.status === 403, "没有外贸键的成员 → 403", denied);
    const after = await counts();
    ok(JSON.stringify(before) === JSON.stringify(after), "单会话接口只读：线索、消息、商机、互动、审批记录条数不变", { before, after });

    // ───────── [3] 手写回复 ─────────
    console.log("\n[3] 手写回复的留底与连带效果");
    const draft = await db.pendingAction.create({
      data: {
        type: INQUIRY_REPLY_ACTION_TYPE,
        title: "回复询盘：Maple Hotels Group",
        preview: "Dear Mark, thank you for your inquiry…",
        payload: { opportunityId, customerId, to: "mark@maple-hotels.fixture.test", subject: "Re: your inquiry", body: "Dear Mark…" },
        status: "pending",
        createdById: CATHY,
        orgId: HT,
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      },
      select: { id: true },
    });
    const f3 = await focus(CATHY, HT, `prospectId=${prospectId}`);
    ok(f3.status === 200 && (f3.body.thread as { replied: boolean }).replied === false, "前置：这位买家待回复，且有一张待批回复草稿");

    const r1 = await replyRoute.POST(
      await req(CATHY, `/api/trade/inbox/${prospectId}/reply`, { method: "POST", body: { orgId: HT, subject: "Re: blackout curtains", body: "Hi Mark, thanks — which sizes do you need?", mode: "mark_sent" } }),
      { params: Promise.resolve({ prospectId }) },
    );
    const r1Body = (await r1.json()) as { ok?: boolean; messageId?: string; revenueSync?: { linked: boolean; supersededPendingActionIds: string[] } };
    ok(r1.status === 200 && r1Body.ok === true, "手写回复经回复接口提交成功（不声明来自 AI 草稿）", { status: r1.status, r1Body });
    const m1 = await db.tradeMessage.findUnique({ where: { id: r1Body.messageId ?? "none" }, select: { aiDraft: true, direction: true } });
    ok(m1?.direction === "outbound" && m1.aiDraft === false, "留底的出站消息：AI 草稿标记为假", m1);
    const f4 = await focus(CATHY, HT, `prospectId=${prospectId}`);
    ok((f4.body.thread as { replied: boolean }).replied === true, "会话变为已回复");
    const draftAfter = await db.pendingAction.findUnique({ where: { id: draft.id }, select: { status: true, failureReason: true } });
    ok(draftAfter?.status === "failed" && (draftAfter.failureReason ?? "").startsWith("SUPERSEDED_") && !!r1Body.revenueSync?.supersededPendingActionIds.includes(draft.id), "同一商机的待批回复草稿被系统作废", { draftAfter, sync: r1Body.revenueSync });
    const d5 = await customerDetail(CATHY, HT, customerId);
    const outbound = (d5.body.interactions ?? []).filter((i) => i.direction === "outbound");
    ok(outbound.length === 1 && outbound[0].replyTarget === null && outbound[0].opportunityId === opportunityId, "客户时间线多出一条发出的互动（界面显示为「我方发出」），它自己没有回复目标", outbound);

    const r2 = await replyRoute.POST(
      await req(CATHY, `/api/trade/inbox/${prospectId}/reply`, { method: "POST", body: { orgId: HT, subject: "Re: blackout curtains", body: "Dear Mark, please find our offer below.", mode: "mark_sent", fromAiDraft: true } }),
      { params: Promise.resolve({ prospectId }) },
    );
    const r2Body = (await r2.json()) as { messageId?: string };
    const m2 = await db.tradeMessage.findUnique({ where: { id: r2Body.messageId ?? "none" }, select: { aiDraft: true } });
    ok(r2.status === 200 && m2?.aiDraft === true, "声明正文来自 AI 草稿时：标记为真", { status: r2.status, m2 });
    const r3 = await replyRoute.POST(
      await req(CATHY, `/api/trade/inbox/${prospectId}/reply`, { method: "POST", body: { orgId: HT, subject: "x", body: "y", mode: "mark_sent", fromAiDraft: "true" } }),
      { params: Promise.resolve({ prospectId }) },
    );
    const m3 = await db.tradeMessage.findUnique({ where: { id: ((await r3.json()) as { messageId?: string }).messageId ?? "none" }, select: { aiDraft: true } });
    ok(m3?.aiDraft === false, "只有布尔 true 才算声明（字符串 \"true\" 不算）", m3);
    const lynnReply = await replyRoute.POST(
      await req(LYNN, `/api/trade/inbox/${prospectId}/reply`, { method: "POST", body: { orgId: WC, subject: "x", body: "y", mode: "mark_sent" } }),
      { params: Promise.resolve({ prospectId }) },
    );
    ok(lynnReply.status === 403 || lynnReply.status === 404, "没有外贸键的成员不能经回复接口提交（权限没有放宽）", lynnReply.status);

    // ───────── [4] 回复能力标记（NAV-6）─────────
    console.log("\n[4] 回复能力标记：能回复与只能查看的成员");
    type Caps = { emailSend?: unknown; reply?: unknown };
    const listAs = async (userId: string) => {
      const res = await inboxRoute.GET(await req(userId, `/api/trade/inbox?orgId=${HT}&filter=all`));
      return { status: res.status, body: (await res.json()) as { items?: Array<{ prospectId: string }>; counts?: Json; capabilities?: Caps } };
    };
    const [cathyList, viewerList] = [await listAs(CATHY), await listAs(VIEWER)];
    ok(cathyList.status === 200 && cathyList.body.capabilities?.reply === true, "列表接口：持处理外贸键的成员 capabilities.reply 为真", cathyList.body.capabilities);
    ok(viewerList.status === 200 && viewerList.body.capabilities?.reply === false, "列表接口：只持查看外贸键的成员 capabilities.reply 为假", { status: viewerList.status, caps: viewerList.body.capabilities });
    ok(typeof cathyList.body.capabilities?.emailSend === "boolean" && cathyList.body.capabilities?.emailSend === viewerList.body.capabilities?.emailSend, "列表接口：原有的 emailSend 仍在，两人相同");
    ok(JSON.stringify(cathyList.body.items) === JSON.stringify(viewerList.body.items) && JSON.stringify(cathyList.body.counts) === JSON.stringify(viewerList.body.counts) && (cathyList.body.items ?? []).length >= 1, "列表接口：两人读到的会话与计数相同（读权限没有收窄）");
    const [cathyFocus, viewerFocus] = [await focus(CATHY, HT, `prospectId=${prospectId}`), await focus(VIEWER, HT, `prospectId=${prospectId}`)];
    ok(cathyFocus.status === 200 && (cathyFocus.body.capabilities as Caps | undefined)?.reply === true && viewerFocus.status === 200 && (viewerFocus.body.capabilities as Caps | undefined)?.reply === false, "单会话接口：同样的真与假", { c: cathyFocus.body.capabilities, v: viewerFocus.body.capabilities });
    ok(JSON.stringify(cathyFocus.body.thread) === JSON.stringify(viewerFocus.body.thread) && JSON.stringify(cathyFocus.body.lastInbound) === JSON.stringify(viewerFocus.body.lastInbound), "单会话接口：两人读到的会话与来信全文相同");
    const messagesBefore = await db.tradeMessage.count({ where: { prospectId } });
    const viewerReply = await replyRoute.POST(
      await req(VIEWER, `/api/trade/inbox/${prospectId}/reply`, { method: "POST", body: { orgId: HT, subject: "x", body: "y", mode: "mark_sent" } }),
      { params: Promise.resolve({ prospectId }) },
    );
    ok(viewerReply.status === 403 && (await db.tradeMessage.count({ where: { prospectId } })) === messagesBefore, "只持查看外贸键的成员提交回复仍是 403，没有留底（标记不代替服务端校验）", viewerReply.status);
  } finally {
    // ── 清理（只删本次夹具）──
    const { db: d } = await import("@/lib/db");
    const prospects = await d.tradeProspect.findMany({ where: { orgId: { in: ORGS } }, select: { id: true } });
    const opps = await d.salesOpportunity.findMany({ where: { orgId: { in: ORGS } }, select: { id: true } });
    await d.tradeMessage.deleteMany({ where: { prospectId: { in: prospects.map((p) => p.id) } } });
    await d.websiteInquiryReceipt.deleteMany({ where: { orgId: { in: ORGS } } });
    await d.tradeProspect.deleteMany({ where: { orgId: { in: ORGS } } });
    await d.tradeCampaign.deleteMany({ where: { orgId: { in: ORGS } } });
    await d.pendingAction.deleteMany({ where: { orgId: { in: ORGS } } });
    await d.notification.deleteMany({ where: { OR: [{ orgId: { in: ORGS } }, { userId: { in: USERS } }] } });
    await d.customerInteraction.deleteMany({ where: { orgId: { in: ORGS } } });
    await d.salesAction.deleteMany({ where: { orgId: { in: ORGS } } });
    await d.salesRfqEvidence.deleteMany({ where: { orgId: { in: ORGS } } });
    await d.salesRfq.deleteMany({ where: { orgId: { in: ORGS } } });
    await d.salesOpportunityAssessment.deleteMany({ where: { orgId: { in: ORGS } } });
    await d.businessOutcome.deleteMany({ where: { orgId: { in: ORGS } } });
    await d.salesOpportunity.deleteMany({ where: { id: { in: opps.map((o) => o.id) } } });
    await d.salesCustomer.deleteMany({ where: { orgId: { in: ORGS } } });
    await d.agentRunEvent.deleteMany({ where: { orgId: { in: ORGS } } });
    await d.agentRun.deleteMany({ where: { orgId: { in: ORGS } } });
    await d.agentSession.deleteMany({ where: { orgId: { in: ORGS } } });
    await d.auditLog.deleteMany({ where: { OR: [{ orgId: { in: ORGS } }, { userId: { in: USERS } }] } });
    await d.principalRoleBinding.deleteMany({ where: { orgId: { in: ORGS } } });
    await d.rolePermissionBinding.deleteMany({ where: { roleProfile: { orgId: { in: ORGS } } } }).catch(() => {});
    await d.roleProfile.deleteMany({ where: { orgId: { in: ORGS } } });
    await d.organizationMember.deleteMany({ where: { orgId: { in: ORGS } } });
    await d.user.updateMany({ where: { id: { in: USERS } }, data: { activeOrgId: null } });
    await d.organization.deleteMany({ where: { id: { in: ORGS } } });
    await d.user.deleteMany({ where: { id: { in: USERS } } });
  }
}

main()
  .then(() => {
    console.log(`\nreply-entry-db: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
