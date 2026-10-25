/**
 * WhatsApp / 微信来信进 Revenue Spine + 去重（PRD F2.2–F2.4）— 真实 DB 端到端（隔离库）
 *
 *   签名的 WhatsApp webhook → 收据（orgId, "whatsapp", wamid）→ Trade 线索 / 消息 → Revenue Spine（按电话建客户 / 商机）
 *   → FDE 只排队（after() 回调由测试注入的调度器捕获）；同一 wamid 重投不重复建对象；未知 phone_number_id 只跳过该条目；
 *   图片消息记「[图片] 说明」；不跑 TradeInquiryAnalysis；无邮箱 FDE 不建审批草稿；
 *   同一买家随后在网站留邮箱 + 本地格式电话 + 国家 → 按 E.164 合并到同一客户、同一商机，FDE 才建审批草稿；
 *   新买家一次并发发几张图 → 仍只有一个客户 / 一个商机（发信人锁）；旧 Trade 通道建的占位线索被复用；
 *   跨组织隔离；收据被中断请求占着 → 500 让 Meta 重投，过期后重投补齐；微信同一 MsgId 重发只写一条消息、不进主干。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/trade/__tests__/channels-to-spine-db.isolated.test.ts
 * 无隔离库时自动跳过。公开仓库：只用虚构企业与 555 / 900 测试号段。
 */
import { createHash, createHmac } from "node:crypto";
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过渠道来信进 Revenue Spine DB 端到端（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "Channels to revenue spine DB e2e" });

// 路由在模块加载时读取这些变量：必须在动态 import 路由之前设置（测试专用值）
const WA_VERIFY = "fixture-verify-token";
const WA_SECRET = "fixture-app-secret";
const WECHAT_TOKEN = "fixture-wechat-token";
process.env.WHATSAPP_VERIFY_TOKEN = WA_VERIFY;
process.env.WHATSAPP_APP_SECRET = WA_SECRET;
process.env.WECHAT_TOKEN = WECHAT_TOKEN;
// 网站 / 微信路径的 TradeInquiryAnalysis 在请求上下文之外会直接调 LLM：指向本机不可达端口，测试绝不外呼
process.env.OPENAI_BASE_URL = "http://127.0.0.1:9/v1";

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

async function main() {
  const { db } = await import("@/lib/db");
  const { NextRequest } = await import("next/server");
  const { ingestWebsiteInquiry, normalizeInquiry, __setDefaultFdeSchedulerForTest } = await import("@/lib/trade/website-inquiry");
  type FdeScheduler = import("@/lib/trade/website-inquiry").FdeScheduler;
  const { INQUIRY_REPLY_ACTION_TYPE } = await import("@/lib/revenue-spine/fde/inbound-sales");
  const { findReceiptByEventId, WHATSAPP_INBOUND_SOURCE, WECHAT_INBOUND_SOURCE } = await import("@/lib/trade/website-inquiry-receipts");
  const { __setToolPolicyLoaderForTest } = await import("@/lib/pending-actions/executor");
  const { __setInquiryReplySenderForTest } = await import("@/lib/pending-actions/exec-sales-inquiry-reply");
  const { POST: waPost } = await import("@/app/api/trade/webhook/whatsapp/route");
  const { POST: wechatPost } = await import("@/app/api/trade/webhook/wechat/route");
  __setToolPolicyLoaderForTest(async () => ({ value: {} }));

  const stamp = Date.now().toString(36);
  const ORG = `wsorg_${stamp}`;
  const ORG2 = `wsorg2_${stamp}`;
  const OWNER = `wsowner_${stamp}`;
  const TRADE = `wstrade_${stamp}`;
  const OTHER = `wsother_${stamp}`;
  // phone_number_id 全局扫描匹配（不分组织）：每次运行用不同值，避免与残留夹具冲突
  const PNID = `9${Date.now()}1`;
  const PNID2 = `9${Date.now()}2`;
  const PNID_UNKNOWN = `9${Date.now()}9`;
  const GH = `gh_${stamp}`;
  const WA1 = "16475550142";
  const WA2 = "447700900123";
  const WA3 = "61412345678";
  const sent: string[] = [];

  await db.user.create({ data: { id: OWNER, email: `${OWNER}@fixture.test`, name: "Example Owner", role: "boss" } });
  await db.user.create({ data: { id: TRADE, email: `${TRADE}@fixture.test`, name: "Example Trade Rep", role: "trade" } });
  await db.user.create({ data: { id: OTHER, email: `${OTHER}@fixture.test`, name: "Other Owner", role: "boss" } });
  await db.organization.create({ data: { id: ORG, name: "Example Textiles Fixture", code: `ws-${stamp}`, ownerId: OWNER } });
  await db.organization.create({ data: { id: ORG2, name: "Other Fixture Org", code: `ws2-${stamp}`, ownerId: OTHER } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: OWNER, role: "org_owner", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: TRADE, role: "org_member", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG2, userId: OTHER, role: "org_owner", status: "active" } });
  await db.tradeChannel.create({ data: { orgId: ORG, channel: "whatsapp", name: "fixture wa", status: "active", config: { phoneNumberId: PNID } } });
  await db.tradeChannel.create({ data: { orgId: ORG2, channel: "whatsapp", name: "other wa", status: "active", config: { phoneNumberId: PNID2 } } });
  await db.tradeChannel.create({ data: { orgId: ORG, channel: "wechat", name: "fixture oa", status: "active", config: { originalId: GH } } });

  const tasks: Array<() => Promise<void>> = [];
  const capture: FdeScheduler = (task) => {
    tasks.push(task);
  };
  const runTasks = async () => {
    const batch = tasks.splice(0);
    for (const t of batch) await t();
    return batch.length;
  };

  const sign = (raw: string) => `sha256=${createHmac("sha256", WA_SECRET).update(raw).digest("hex")}`;
  const postWa = async (body: unknown, opts: { badSignature?: boolean } = {}) => {
    const raw = JSON.stringify(body);
    const res = await waPost(
      new NextRequest("http://localhost/api/trade/webhook/whatsapp", {
        method: "POST",
        headers: { "content-type": "application/json", "x-hub-signature-256": opts.badSignature ? "sha256=deadbeef" : sign(raw) },
        body: raw,
      }),
    );
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  type Msg = Record<string, unknown>;
  const waBody = (changes: Array<{ pnid: string; messages: Msg[]; contacts?: Msg[] }>) => ({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "200000000000001",
        changes: changes.map((c) => ({
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { phone_number_id: c.pnid, display_phone_number: "15555550100" },
            contacts: c.contacts ?? [{ profile: { name: "Maple Home Goods" }, wa_id: WA1 }],
            messages: c.messages,
          },
        })),
      },
    ],
  });
  const text = (id: string, body: string, from = WA1): Msg => ({ id, from, timestamp: "1790000000", type: "text", text: { body } });
  const image = (id: string, caption: string, from = WA1): Msg => ({ id, from, timestamp: "1790000001", type: "image", image: { caption, id: `media_${id}` } });
  const wamid = (k: string) => `wamid.${k}.${stamp}`;

  const placeholder = (wa: string) => `WhatsApp ${wa}`;
  const customersByPhone = (orgId: string, e164: string) => db.salesCustomer.findMany({ where: { orgId, phone: e164 }, select: { id: true, email: true, name: true, source: true } });
  const prospectsNamed = (orgId: string, name: string) =>
    db.tradeProspect.findMany({ where: { orgId, companyName: name }, select: { id: true, source: true, contactName: true, convertedToSalesOpportunityId: true } });
  const pendingFor = (opportunityId: string) =>
    db.pendingAction.findMany({ where: { orgId: ORG, type: INQUIRY_REPLY_ACTION_TYPE, payload: { path: ["opportunityId"], equals: opportunityId } }, select: { id: true, status: true, payload: true } });

  __setInquiryReplySenderForTest(async (input) => {
    sent.push(input.to);
    return { channel: "test", messageId: `msg_${sent.length}` };
  });
  __setDefaultFdeSchedulerForTest(capture);

  try {
    console.log("\n[1] WhatsApp 文字来信（新买家）：收据 → Trade → Revenue Spine，FDE 只排队");
    const W1 = wamid("w1");
    const r1 = await postWa(waBody([{ pnid: PNID, messages: [text(W1, "Hi, we need 800 waffle bathrobes 380gsm with embroidered logo for hotels in Toronto. Price and MOQ?")] }]));
    ok(r1.status === 200 && r1.body.status === "ok", "HTTP 200 ok", r1);
    const receipt1 = await findReceiptByEventId(ORG, W1, WHATSAPP_INBOUND_SOURCE);
    ok(receipt1?.status === "linked" && receipt1.attempts === 1 && !!receipt1.opportunityId && !!receipt1.salesActionId && receipt1.processingSince === null, "收据（whatsapp, wamid）已建并在返回前释放", receipt1 && { status: receipt1.status, attempts: receipt1.attempts });
    const [p1] = await prospectsNamed(ORG, placeholder(WA1));
    ok(!!p1 && p1.source === "whatsapp" && p1.contactName === "Maple Home Goods" && p1.convertedToSalesOpportunityId === receipt1?.opportunityId, "Trade 线索：「WhatsApp <号码>」占位名、资料名为联系人、已关联商机", p1);
    const msgs1 = await db.tradeMessage.findMany({ where: { prospectId: p1?.id ?? "-" }, select: { channel: true, content: true } });
    ok(msgs1.length === 1 && msgs1[0].channel === "whatsapp" && msgs1[0].content.includes("留言：Hi, we need 800 waffle bathrobes"), "Trade 消息 channel=whatsapp，含原文", msgs1);
    const [c1, ...moreC1] = await customersByPhone(ORG, "+16475550142");
    ok(!!c1 && moreC1.length === 0 && c1.email === null && c1.name === "Maple Home Goods" && c1.source === "whatsapp", "SalesCustomer：电话 +<wa_id>、无邮箱、名称取资料名、来源 whatsapp", { c1, more: moreC1.length });
    const opp1 = await db.salesOpportunity.findFirst({ where: { id: receipt1?.opportunityId ?? "-", orgId: ORG }, select: { id: true, source: true, customerId: true } });
    ok(opp1?.source === "whatsapp" && opp1.customerId === c1?.id, "商机来源 whatsapp", opp1);
    const int1 = await db.customerInteraction.findFirst({ where: { id: receipt1?.interactionId ?? "-", orgId: ORG }, select: { channel: true, type: true, content: true } });
    ok(int1?.channel === "whatsapp" && int1.type === "whatsapp", "互动 channel / type = whatsapp", int1);
    const action1 = await db.salesAction.findFirst({ where: { id: receipt1?.salesActionId ?? "-" }, select: { inputContext: true } });
    ok((action1?.inputContext as Record<string, unknown> | null)?.fdeStatus === "queued" && tasks.length === 1, "FDE 行动 queued，安排了一个 after() 回调（请求内没跑）", { ctx: action1?.inputContext, tasks: tasks.length });
    const runs0 = await db.agentRun.count({ where: { orgId: ORG } });
    const analyses1 = await db.tradeInquiryAnalysis.count({ where: { prospectId: p1?.id ?? "-" } });
    const outreach1 = await db.tradeOutreachStep.count({ where: { prospectId: p1?.id ?? "-" } });
    ok(runs0 === 0 && analyses1 === 0 && outreach1 === 0, "单管线：没有 AgentRun、没有 TradeInquiryAnalysis、没有邮件外联序列", { runs0, analyses1, outreach1 });

    console.log("\n[2] 同一 wamid 重投（Meta 重试）：不重复建任何对象");
    const r2 = await postWa(waBody([{ pnid: PNID, messages: [text(W1, "Hi, we need 800 waffle bathrobes 380gsm with embroidered logo for hotels in Toronto. Price and MOQ?")] }]));
    const receipt1b = await findReceiptByEventId(ORG, W1, WHATSAPP_INBOUND_SOURCE);
    const counts2 = {
      msgs: await db.tradeMessage.count({ where: { prospect: { orgId: ORG } } }),
      interactions: await db.customerInteraction.count({ where: { orgId: ORG } }),
      opps: await db.salesOpportunity.count({ where: { orgId: ORG } }),
      customers: await db.salesCustomer.count({ where: { orgId: ORG } }),
      prospects: await db.tradeProspect.count({ where: { orgId: ORG } }),
    };
    ok(r2.status === 200 && receipt1b?.attempts === 2 && receipt1b.id === receipt1?.id, "重投 200，收据 attempts=2", { status: r2.status, attempts: receipt1b?.attempts });
    ok(counts2.msgs === 1 && counts2.interactions === 1 && counts2.opps === 1 && counts2.customers === 1 && counts2.prospects === 1, "消息 / 互动 / 商机 / 客户 / 线索 各仍只有 1 个", counts2);

    console.log("\n[3] 一批里混着未知 phone_number_id：只跳过该条目；图片消息记「[图片] 说明」；表情回应不进");
    const WU = wamid("unknown");
    const W2 = wamid("img");
    const WR = wamid("reaction");
    const r3 = await postWa(
      waBody([
        { pnid: PNID_UNKNOWN, messages: [text(WU, "to an unknown business number")] },
        { pnid: PNID, messages: [image(W2, "This colour, logo on chest"), { id: WR, from: WA1, type: "reaction", reaction: { message_id: W1, emoji: "👍" } }] },
      ]),
    );
    ok(r3.status === 200 && r3.body.status === "ok", "整批 200（不是 403）", r3);
    const unknownReceipts = await db.websiteInquiryReceipt.count({ where: { eventId: { in: [WU, WR] } } });
    ok(unknownReceipts === 0, "未知号码 / 表情回应：没有收据、没有任何对象", unknownReceipts);
    const receipt2 = await findReceiptByEventId(ORG, W2, WHATSAPP_INBOUND_SOURCE);
    const int2 = await db.customerInteraction.findFirst({ where: { id: receipt2?.interactionId ?? "-", orgId: ORG }, select: { content: true, opportunityId: true, customerId: true } });
    ok(int2?.content === "[图片] This colour, logo on chest" && int2.opportunityId === opp1?.id && int2.customerId === c1?.id, "图片消息：附到同一客户的同一商机（补充信息）", int2);
    const msgs3 = await db.tradeMessage.count({ where: { prospectId: p1?.id ?? "-" } });
    ok(msgs3 === 2 && (await prospectsNamed(ORG, placeholder(WA1))).length === 1, "同一 Trade 线索上第 2 条消息（按占位名复用线索）", msgs3);

    console.log("\n[4] 执行排队的 FDE：无邮箱 → 评分照常，但不建审批草稿");
    const ran4 = await runTasks();
    const runs4 = await db.agentRun.count({ where: { orgId: ORG, runType: "fde_inbound_sales" } });
    const drafts4 = await pendingFor(opp1?.id ?? "-");
    const ctx4 = (await db.salesAction.findFirst({ where: { id: receipt1?.salesActionId ?? "-" }, select: { inputContext: true } }))?.inputContext as Record<string, unknown> | undefined;
    ok(ran4 >= 2 && runs4 >= 1 && drafts4.length === 0 && sent.length === 0, "FDE 跑完，没有审批草稿、没有发送", { ran4, runs4, drafts: drafts4.length });
    ok(ctx4?.fdeStatus === "completed", "首条来信的 FDE completed", ctx4?.fdeStatus);
    const receipt1c = await findReceiptByEventId(ORG, W1, WHATSAPP_INBOUND_SOURCE);
    ok(receipt1c?.status === "complete" && !!receipt1c.agentRunId, "收据回填 run 并标 complete", receipt1c && { status: receipt1c.status, run: receipt1c.agentRunId });

    console.log("\n[5] 同一买家随后在网站留邮箱 + 本地格式电话 + 国家 → 合并到同一客户 / 同一商机");
    const email = `jane@maple-home-${stamp}.example`;
    const form = normalizeInquiry({
      eventId: `evt_web_${stamp}`,
      name: "Jane Maple",
      email,
      phone: "(647) 555-0142",
      company: "Maple Home Goods",
      country: "Canada",
      message: "Following up on WhatsApp: 800 waffle bathrobes 380gsm, embroidered logo, delivery to Toronto in March. Please quote FOB.",
    });
    if (!form.ok) throw new Error("fixture normalize failed");
    const web = await ingestWebsiteInquiry(ORG, form.value, { fdeMode: "deferred" });
    ok(web.spine.ok && web.spine.matchLevel === "phone" && web.spine.customerId === c1?.id && web.spine.opportunityId === opp1?.id && !web.spine.opportunityCreated, "matchLevel=phone：同一客户、同一商机（不建第二个）", web.spine);
    const merged = await db.salesCustomer.findUnique({ where: { id: c1?.id ?? "-" }, select: { email: true, phone: true, contactName: true, emailDomain: true } });
    ok(merged?.email === email && merged.phone === "+16475550142" && merged.contactName === "Maple Home Goods", "客户补上邮箱（不覆盖既有电话 / 联系人）", merged);
    const oppCount5 = await db.salesOpportunity.count({ where: { orgId: ORG, customerId: c1?.id ?? "-" } });
    const custCount5 = await db.salesCustomer.count({ where: { orgId: ORG } });
    ok(oppCount5 === 1 && custCount5 === 1, "组织内仍只有 1 个客户、该客户 1 个商机", { oppCount5, custCount5 });
    const webProspect = await db.tradeProspect.findFirst({ where: { id: web.prospectId }, select: { companyName: true, convertedToSalesOpportunityId: true, source: true } });
    ok(webProspect?.source === "website" && webProspect.convertedToSalesOpportunityId === opp1?.id, "网站线索（按邮箱建）关联到同一商机", webProspect);
    await runTasks();
    const drafts5 = await pendingFor(opp1?.id ?? "-");
    ok(drafts5.length === 1 && drafts5[0].status === "pending" && (drafts5[0].payload as Record<string, unknown>).to === email && sent.length === 0, "有了邮箱：FDE 建 1 份待审批草稿（发往买家邮箱），未自动发送", drafts5.map((d) => ({ status: d.status, to: (d.payload as Record<string, unknown>).to })));

    console.log("\n[6] 新买家一次并发发 3 张图（3 个 webhook 同时到）→ 仍只有 1 个客户 / 1 个商机");
    const contacts2 = [{ profile: { name: "Example Linen Buyer" }, wa_id: WA2 }];
    const burst = await Promise.all(
      [1, 2, 3].map((n) => postWa(waBody([{ pnid: PNID, contacts: contacts2, messages: [image(wamid(`burst${n}`), `Towel style ${n}, 600 pcs`, WA2)] }]))),
    );
    const c2 = await customersByPhone(ORG, "+447700900123");
    const opps6 = c2[0] ? await db.salesOpportunity.count({ where: { orgId: ORG, customerId: c2[0].id } }) : -1;
    const ints6 = c2[0] ? await db.customerInteraction.count({ where: { orgId: ORG, customerId: c2[0].id } }) : -1;
    const pros6 = await prospectsNamed(ORG, placeholder(WA2));
    ok(burst.every((b) => b.status === 200), "3 个并发投递都 200", burst.map((b) => b.status));
    ok(c2.length === 1 && opps6 === 1 && ints6 === 3 && pros6.length === 1, "1 个客户、1 个商机、3 条互动、1 个 Trade 线索（发信人锁）", { customers: c2.length, opps6, ints6, prospects: pros6.length });
    tasks.splice(0);

    console.log("\n[7] 旧 Trade 通道建的占位线索：新来信复用它，不另建");
    const legacyCampaign = await db.tradeCampaign.create({
      data: { orgId: ORG, name: "渠道询盘", productDesc: "消息通道陌生来信自动归集的询盘", targetMarket: "海外", searchKeywords: [], status: "active", createdById: OWNER },
      select: { id: true },
    }).catch(async () => (await db.tradeCampaign.findFirstOrThrow({ where: { orgId: ORG, name: "渠道询盘" }, select: { id: true } })));
    const legacy = await db.tradeProspect.create({
      data: { orgId: ORG, campaignId: legacyCampaign.id, companyName: placeholder(WA3), contactName: WA3, source: "whatsapp", stage: "replied" },
      select: { id: true },
    });
    const W3 = wamid("legacy");
    const r7 = await postWa(waBody([{ pnid: PNID, contacts: [{ profile: { name: "Example Coastal Hotels" }, wa_id: WA3 }], messages: [text(W3, "Need 300 beach towels 90x180 for a resort in Perth.", WA3)] }]));
    const pros7 = await prospectsNamed(ORG, placeholder(WA3));
    const receipt7 = await findReceiptByEventId(ORG, W3, WHATSAPP_INBOUND_SOURCE);
    ok(r7.status === 200 && pros7.length === 1 && pros7[0].id === legacy.id && receipt7?.prospectId === legacy.id && pros7[0].convertedToSalesOpportunityId === receipt7?.opportunityId, "复用旧占位线索并回填商机关联", { pros7, receiptProspect: receipt7?.prospectId });
    tasks.splice(0);

    console.log("\n[8] 跨组织：同一号码发给另一家工厂的号码 → 另一组织自己的客户，互不合并");
    const W4 = wamid("org2");
    const r8 = await postWa(waBody([{ pnid: PNID2, messages: [text(W4, "Do you also make bath mats?")] }]));
    const org2Customers = await customersByPhone(ORG2, "+16475550142");
    const orgCustomers = await customersByPhone(ORG, "+16475550142");
    const orgReceiptForW4 = await findReceiptByEventId(ORG, W4, WHATSAPP_INBOUND_SOURCE);
    ok(r8.status === 200 && org2Customers.length === 1 && org2Customers[0].id !== c1?.id && orgCustomers.length === 1 && orgReceiptForW4 === null, "ORG2 自建客户；ORG 不受影响；收据按组织隔离", { org2: org2Customers.length, org: orgCustomers.length });
    tasks.splice(0);

    console.log("\n[9] 收据被中断的请求占着（processing 未过期）→ 500 让 Meta 重投；过期后重投补齐");
    const WB = wamid("busy");
    const busyPayload = { name: "Example Linen Buyer", email: "", phone: `+${WA2}`, company: "", country: "", message: "Is 600 pcs your MOQ?", product: "", website: "", page: "", utm: { source: "", medium: "", campaign: "", content: "", term: "" }, eventId: WB };
    await db.websiteInquiryReceipt.create({
      data: {
        orgId: ORG,
        source: WHATSAPP_INBOUND_SOURCE,
        eventId: WB,
        payload: busyPayload,
        payloadHash: createHash("sha256").update(`busy-${stamp}`).digest("hex"),
        status: "processing",
        processingSince: new Date(),
      },
    });
    const busyBody = waBody([{ pnid: PNID, contacts: contacts2, messages: [text(WB, "Is 600 pcs your MOQ?", WA2)] }]);
    const r9 = await postWa(busyBody);
    ok(r9.status === 500 && r9.body.status === "retry", "busy → 500 retry", r9);
    await db.websiteInquiryReceipt.update({ where: { orgId_source_eventId: { orgId: ORG, source: WHATSAPP_INBOUND_SOURCE, eventId: WB } }, data: { processingSince: new Date(Date.now() - 7 * 60_000) } });
    const r9b = await postWa(busyBody);
    const receipt9 = await findReceiptByEventId(ORG, WB, WHATSAPP_INBOUND_SOURCE);
    const int9 = receipt9?.interactionId ? await db.customerInteraction.findFirst({ where: { id: receipt9.interactionId, orgId: ORG }, select: { customerId: true, content: true } }) : null;
    ok(r9b.status === 200 && receipt9?.status === "linked" && int9?.customerId === c2[0]?.id && int9.content === "Is 600 pcs your MOQ?", "过期后重投：补齐 Trade / 主干，附到同一买家", { status: r9b.status, receipt: receipt9?.status, int9 });
    tasks.splice(0);

    console.log("\n[10] 签名错误 → 401；只有未知号码的批次 → 200（不是 403）");
    const r10a = await postWa(waBody([{ pnid: PNID, messages: [text(wamid("sig"), "x")] }]), { badSignature: true });
    const r10b = await postWa(waBody([{ pnid: PNID_UNKNOWN, messages: [text(wamid("only-unknown"), "x")] }]));
    ok(r10a.status === 401 && r10b.status === 200, "401 / 200", { a: r10a.status, b: r10b.status });

    console.log("\n[11] 微信公众号：同一 MsgId 重发只写一条消息；只走 Trade 通道，不建主干客户");
    const OPENID = `o_fixture_${stamp}`;
    const customersBefore = await db.salesCustomer.count({ where: { orgId: ORG } });
    const postWechat = async (msgId: string, content: string) => {
      const timestamp = "1790000100";
      const nonce = `n${stamp}`;
      const signature = createHash("sha1").update([WECHAT_TOKEN, timestamp, nonce].sort().join("")).digest("hex");
      const xml = `<xml><ToUserName><![CDATA[${GH}]]></ToUserName><FromUserName><![CDATA[${OPENID}]]></FromUserName><CreateTime>1790000100</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[${content}]]></Content><MsgId>${msgId}</MsgId></xml>`;
      const res = await wechatPost(
        new NextRequest(`http://localhost/api/trade/webhook/wechat?signature=${signature}&timestamp=${timestamp}&nonce=${nonce}`, {
          method: "POST",
          headers: { "content-type": "text/xml" },
          body: xml,
        }),
      );
      return { status: res.status, text: await res.text() };
    };
    const MSG = `24${Date.now()}`;
    const wc1 = await postWechat(MSG, "你好，想要浴袍报价，500 件");
    const wc2 = await postWechat(MSG, "你好，想要浴袍报价，500 件");
    const wcProspects = await db.tradeProspect.findMany({ where: { orgId: ORG, companyName: `微信 ${OPENID}` }, select: { id: true } });
    const wcMsgs = wcProspects[0] ? await db.tradeMessage.count({ where: { prospectId: wcProspects[0].id, channel: "wechat" } }) : -1;
    const wcReceipt = await findReceiptByEventId(ORG, MSG, WECHAT_INBOUND_SOURCE);
    ok(wc1.status === 200 && wc1.text === "success" && wc2.status === 200 && wc2.text === "success", "两次都回 success", { wc1, wc2 });
    ok(wcProspects.length === 1 && wcMsgs === 1, "只有 1 条 Trade 消息", { prospects: wcProspects.length, wcMsgs });
    ok(wcReceipt?.status === "complete" && wcReceipt.attempts === 2 && wcReceipt.tradeMessageId !== null && wcReceipt.prospectId === wcProspects[0]?.id, "收据（wechat, MsgId）complete、attempts=2、回填线索 / 消息", wcReceipt && { status: wcReceipt.status, attempts: wcReceipt.attempts });
    ok((await db.salesCustomer.count({ where: { orgId: ORG } })) === customersBefore, "微信来信不进 Revenue Spine（openid 无电话 / 邮箱）");
    const wc3 = await postWechat(`${MSG}7`, "另外还要拖鞋");
    const wcMsgs3 = wcProspects[0] ? await db.tradeMessage.count({ where: { prospectId: wcProspects[0].id, channel: "wechat" } }) : -1;
    ok(wc3.text === "success" && wcMsgs3 === 2, "新的 MsgId 照常写入", wcMsgs3);
  } finally {
    __setDefaultFdeSchedulerForTest(null);
    __setInquiryReplySenderForTest(null);
    try {
      for (const orgId of [ORG, ORG2]) {
        const opps = await db.salesOpportunity.findMany({ where: { orgId }, select: { id: true } });
        await db.businessOutcome.deleteMany({ where: { orgId } }).catch(() => undefined);
        await db.websiteInquiryReceipt.deleteMany({ where: { orgId } });
        await db.tradeInquiryAnalysis.deleteMany({ where: { prospect: { orgId } } }).catch(() => undefined);
        await db.tradeOutreachStep.deleteMany({ where: { prospect: { orgId } } }).catch(() => undefined);
        await db.tradeMessage.deleteMany({ where: { prospect: { orgId } } });
        await db.tradeProspect.deleteMany({ where: { orgId } });
        await db.tradeCampaign.deleteMany({ where: { orgId } });
        await db.tradeChannel.deleteMany({ where: { orgId } });
        await db.pendingAction.deleteMany({ where: { orgId } });
        await db.notification.deleteMany({ where: { orgId } });
        await db.customerInteraction.deleteMany({ where: { orgId } });
        await db.salesAction.deleteMany({ where: { orgId } });
        await db.salesRfqEvidence.deleteMany({ where: { orgId } });
        await db.salesRfq.deleteMany({ where: { orgId } });
        await db.salesOpportunityAssessment.deleteMany({ where: { orgId } });
        await db.salesOpportunity.deleteMany({ where: { id: { in: opps.map((o) => o.id) } } });
        await db.salesCustomer.deleteMany({ where: { orgId } });
        await db.agentRunEvent.deleteMany({ where: { orgId } });
        await db.agentRun.deleteMany({ where: { orgId } });
        await db.agentSession.deleteMany({ where: { orgId } });
        await db.capabilityQuotaReservation.deleteMany({ where: { orgId } }).catch(() => undefined);
        await db.capabilityQuotaPolicy.deleteMany({ where: { orgId } }).catch(() => undefined);
        await db.orgBusinessRule.deleteMany({ where: { orgId } }).catch(() => undefined);
        await db.auditLog.deleteMany({ where: { orgId } });
        await db.organizationMember.deleteMany({ where: { orgId } });
      }
      await db.organization.deleteMany({ where: { id: { in: [ORG, ORG2] } } });
      await db.auditLog.deleteMany({ where: { userId: { in: [OWNER, TRADE, OTHER] } } });
      await db.notification.deleteMany({ where: { userId: { in: [OWNER, TRADE, OTHER] } } });
      await db.user.deleteMany({ where: { id: { in: [OWNER, TRADE, OTHER] } } });
    } catch (cleanupErr) {
      console.warn("[cleanup] 清理未完成（不覆盖原始错误）：", cleanupErr instanceof Error ? cleanupErr.message : cleanupErr);
    }
  }

  console.log(`\n渠道来信进 Revenue Spine DB e2e 结果: ${pass} 通过, ${fail} 失败`);
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
