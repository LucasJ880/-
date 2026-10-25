/**
 * 邮件转发入站（PRD F1.2 / F6.3b）— 真实 DB 端到端（隔离库）
 *
 *   签名的 Resend 事件 → POST /api/trade/webhook/email → 别名解析组织 → 解析 → 隔离 / 双重入站判定
 *   → ingestWebsiteInquiry(origin=email_forward, deferred)：收据 source=email、eventId=email:<Message-ID>、
 *     Trade 线索 / 商机来源 email、FDE 只排队（注入的调度器捕获 after() 回调，不执行 LLM）
 *   + 别名生成与解析（跨组织不串、停用通道不认）；Resend 重试按 Message-ID 幂等；同内容另一封转发记为内容重复；
 *     正文经注入 fetcher 获取 / 获取失败 502 不落收据；三种隔离（白名单 / DKIM / 无联系方式）+ 管理员通知幂等；
 *     隔离收据不被当成内容孪生；官网已入站的同一询盘（按编号 / 48 小时内内容孪生）记 duplicate 不建商机；
 *     48 小时外不算；别的组织的官网收据不影响本组织；入驻状态的邮件转发步骤。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/trade/__tests__/email-inbound-db.isolated.test.ts
 * 无隔离库时自动跳过。公开仓库：只用虚构企业与保留域名（.example）。
 */
import { createHmac, randomBytes } from "node:crypto";
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过邮件转发入站 DB 端到端（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "Email forward inbound DB e2e" });

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

type Body = { ok?: boolean; outcome?: string; reason?: string; reasons?: string[]; eventId?: string; error?: string };

async function main() {
  // 入链路径里旧的线索分析（scheduleInquiryAnalysis）在请求上下文之外会直接调 LLM：指到本机不可达端口，测试绝不访问外网
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:9/v1";
  const { db } = await import("@/lib/db");
  const { NextRequest } = await import("next/server");
  const { POST } = await import("@/app/api/trade/webhook/email/route");
  const { __setInboundEmailFetcherForTest, handleResendInboundEvent } = await import("@/lib/trade/email-inbound");
  const { __setDefaultFdeSchedulerForTest, ingestWebsiteInquiry, normalizeInquiry, EMAIL_FORWARD_CAMPAIGN_NAME } = await import("@/lib/trade/website-inquiry");
  type FdeScheduler = import("@/lib/trade/website-inquiry").FdeScheduler;
  const { upsertEmailChannel } = await import("@/lib/trade/channel-service");
  const { findTradeChannelOrgByInboundAlias, resolveInboundTradeOrgId } = await import("@/lib/trade/inbound-org");
  const { INBOUND_ALIAS_RE } = await import("@/lib/trade/email-inbound-rules");
  const { getOnboardingStatus } = await import("@/lib/organizations/onboarding");

  const stamp = Date.now().toString(36);
  const ORG = `eiorg_${stamp}`;
  const ORG2 = `eiorg2_${stamp}`;
  const OWNER = `eiowner_${stamp}`;
  const TRADE = `eitrade_${stamp}`;
  const OTHER = `eiother_${stamp}`;
  const DOMAIN = "in.qingyan.example";
  const FACTORY = "exampletextiles.example";
  const LILY = `lily@${FACTORY}`;
  const SECRET = `whsec_${randomBytes(24).toString("base64")}`;
  const AUTH_OK = { "authentication-results": `mx.${DOMAIN}; dkim=pass header.d=${FACTORY}; spf=pass smtp.mailfrom=${FACTORY}; dmarc=pass header.from=${FACTORY}` };

  const prevEnv = { secret: process.env.RESEND_INBOUND_WEBHOOK_SECRET, domain: process.env.INBOUND_EMAIL_DOMAIN, authserv: process.env.INBOUND_EMAIL_AUTHSERV_ID };
  process.env.RESEND_INBOUND_WEBHOOK_SECRET = SECRET;
  process.env.INBOUND_EMAIL_DOMAIN = DOMAIN;
  delete process.env.INBOUND_EMAIL_AUTHSERV_ID;

  const tasks: Array<() => Promise<void>> = [];
  const capture: FdeScheduler = (task) => {
    tasks.push(task);
  };
  __setDefaultFdeSchedulerForTest(capture);
  const fetched: string[] = [];
  let fetchBody: { text: string | null; html: string | null; headers: unknown } | Error = new Error("no fetch expected");
  __setInboundEmailFetcherForTest(async (id) => {
    fetched.push(id);
    if (fetchBody instanceof Error) throw fetchBody;
    return fetchBody;
  });

  await db.user.create({ data: { id: OWNER, email: `${OWNER}@fixture.test`, name: "Example Owner", role: "boss" } });
  await db.user.create({ data: { id: TRADE, email: `${TRADE}@fixture.test`, name: "Example Trade Rep", role: "trade" } });
  await db.user.create({ data: { id: OTHER, email: `${OTHER}@fixture.test`, name: "Other Owner", role: "boss" } });
  await db.organization.create({ data: { id: ORG, name: "Example Textiles Fixture", code: `ei-${stamp}`, ownerId: OWNER } });
  await db.organization.create({ data: { id: ORG2, name: "Other Fixture Org", code: `ei2-${stamp}`, ownerId: OTHER } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: OWNER, role: "org_owner", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: TRADE, role: "org_member", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG2, userId: OTHER, role: "org_owner", status: "active" } });

  const sign = (id: string, body: string) => {
    const ts = Math.floor(Date.now() / 1000);
    const sig = createHmac("sha256", Buffer.from(SECRET.replace(/^whsec_/, ""), "base64")).update(`${id}.${ts}.${body}`).digest("base64");
    return { "svix-id": id, "svix-timestamp": String(ts), "svix-signature": `v1,${sig}` };
  };
  const event = (o: { msgId: string; from: string; to: string[]; subject: string; text?: string; headers?: unknown; extra?: Record<string, unknown> }) => ({
    type: "email.received",
    created_at: new Date().toISOString(),
    data: {
      email_id: `em_${o.msgId}`,
      created_at: new Date().toISOString(),
      from: o.from,
      to: o.to,
      cc: [],
      bcc: [],
      message_id: `<${o.msgId}@mail.${FACTORY}>`,
      subject: o.subject,
      attachments: [],
      ...(o.text !== undefined ? { text: o.text } : {}),
      ...(o.headers !== undefined ? { headers: o.headers } : {}),
      ...(o.extra ?? {}),
    },
  });
  let svixSeq = 0;
  const post = async (ev: unknown) => {
    const body = JSON.stringify(ev);
    const res = await POST(
      new NextRequest("http://localhost/api/trade/webhook/email", {
        method: "POST",
        headers: { "content-type": "application/json", ...sign(`msg_${stamp}_${svixSeq++}`, body) },
        body,
      }),
    );
    return { status: res.status, body: (await res.json()) as Body };
  };
  const counts = async (orgId: string) => ({
    receipts: await db.websiteInquiryReceipt.count({ where: { orgId } }),
    prospects: await db.tradeProspect.count({ where: { orgId } }),
    opps: await db.salesOpportunity.count({ where: { orgId } }),
    messages: await db.tradeMessage.count({ where: { prospect: { orgId } } }),
  });
  const receiptOf = (orgId: string, msgId: string) =>
    db.websiteInquiryReceipt.findUnique({ where: { orgId_source_eventId: { orgId, source: "email", eventId: `email:${msgId}@mail.${FACTORY}` } } });
  const gmailForward = (buyerName: string, buyerEmail: string, subject: string, body: string) => `Please follow up.

---------- Forwarded message ---------
From: ${buyerName} <${buyerEmail}>
Date: Mon, Oct 20, 2026 at 9:15 AM
Subject: ${subject}
To: <${LILY}>

${body}

Best regards,
${buyerName}
Maple Home Goods Inc.
Tel: +1 416 555 0134`;

  try {
    // ── 别名 ──────────────────────────────────────────────────────────────
    const ch = await upsertEmailChannel({ orgId: ORG, name: "询盘邮箱", forwarderAllowlist: [LILY] });
    const alias = (ch.config as { inboundAlias: string }).inboundAlias;
    const again = await upsertEmailChannel({ orgId: ORG, name: "询盘邮箱", forwarderAllowlist: [LILY, `kevin@${FACTORY}`] });
    const ch2 = await upsertEmailChannel({ orgId: ORG2, name: "other inbox", forwarderAllowlist: ["sales@otherfactory.example"] });
    const alias2 = (ch2.config as { inboundAlias: string }).inboundAlias;
    ok(
      INBOUND_ALIAS_RE.test(alias) && !alias.includes(`ei-${stamp}`) && (again.config as { inboundAlias: string }).inboundAlias === alias && alias2 !== alias,
      "别名 inq- + 10 位随机 base32，与 org code 无关；重复保存不变；不同组织不同",
      { alias, alias2 },
    );
    ok(
      JSON.stringify((again.config as { forwarderAllowlist: string[] }).forwarderAllowlist) === JSON.stringify([LILY, `kevin@${FACTORY}`]),
      "重复保存只更新白名单",
    );
    const r1 = await findTradeChannelOrgByInboundAlias(alias);
    const r2 = await resolveInboundTradeOrgId({ provider: "email", providerAccountId: alias2 });
    const rUnknown = await resolveInboundTradeOrgId({ provider: "email", providerAccountId: "inq-zzzzzzzzzz" });
    ok(r1?.orgId === ORG && r2.ok && r2.orgId === ORG2 && !rUnknown.ok, "别名解析到各自组织；未知别名 channel_not_found", { r1, r2, rUnknown });
    await db.tradeChannel.update({ where: { id: ch2.id }, data: { status: "inactive" } });
    ok((await findTradeChannelOrgByInboundAlias(alias2)) === null, "停用的通道不认别名");
    await db.tradeChannel.update({ where: { id: ch2.id }, data: { status: "active" } });
    const ADDR = `${alias}@${DOMAIN}`;
    const ADDR2 = `${alias2}@${DOMAIN}`;

    // ── 正常入链 ─────────────────────────────────────────────────────────
    const before = await counts(ORG);
    const evA = event({
      msgId: `a-${stamp}`,
      from: `Lily Chen <${LILY}>`,
      to: [ADDR],
      subject: "Fwd: RFQ bath towels",
      text: gmailForward("Jane Doe", `jane.${stamp}@maplehomegoods.example`, "RFQ bath towels", "We need 5,000 pcs 550gsm bath towels, 3 colors. Please quote FOB."),
      headers: AUTH_OK,
      extra: { orgId: ORG2 }, // 载荷里的 org 字段一律无效
    });
    const a = await post(evA);
    const ra = await receiptOf(ORG, `a-${stamp}`);
    const afterA = await counts(ORG);
    ok(a.status === 200 && a.body.outcome === "ingested" && a.body.eventId === `email:a-${stamp}@mail.${FACTORY}`, "转发邮件入链：200 ingested，eventId = email:<Message-ID>", a);
    ok(
      !!ra && ra.source === "email" && ra.status === "linked" && !!ra.opportunityId && !!ra.salesActionId,
      "收据 source=email、业务对象已建、FDE 未执行（linked）",
      ra && { status: ra.status, opp: ra.opportunityId },
    );
    const meta = (ra?.payload as { meta?: Record<string, unknown> } | null)?.meta ?? {};
    ok(
      meta.forwarder === LILY && (meta.parse as { format?: string })?.format === "gmail_forward" && meta.subject === "RFQ bath towels" && (meta.auth as { verdict?: string })?.verdict === "pass",
      "收据 meta 记录转发人 / 解析格式 / 原主题 / 验证结论",
      meta,
    );
    ok(afterA.opps === before.opps + 1 && afterA.prospects === before.prospects + 1 && afterA.messages === before.messages + 1, "建 1 个线索 + 1 条消息 + 1 个商机", { before, afterA });
    const prospectA = ra?.prospectId ? await db.tradeProspect.findFirst({ where: { id: ra.prospectId, orgId: ORG }, select: { source: true, contactEmail: true, campaign: { select: { name: true } } } }) : null;
    const oppA = ra?.opportunityId ? await db.salesOpportunity.findFirst({ where: { id: ra.opportunityId, orgId: ORG }, select: { source: true } }) : null;
    const interA = ra?.interactionId ? await db.customerInteraction.findFirst({ where: { id: ra.interactionId, orgId: ORG }, select: { channel: true, type: true } }) : null;
    const actionA = ra?.salesActionId ? await db.salesAction.findFirst({ where: { id: ra.salesActionId, orgId: ORG }, select: { inputContext: true } }) : null;
    ok(
      prospectA?.source === "email" &&
        prospectA.contactEmail === `jane.${stamp}@maplehomegoods.example` &&
        prospectA.campaign?.name === EMAIL_FORWARD_CAMPAIGN_NAME &&
        oppA?.source === "email" &&
        interA?.channel === "email",
      "买家取原发件人（不是转发人）；线索 / 商机 / 互动来源都是 email；活动「邮件转发询盘」",
      { prospectA, oppA, interA },
    );
    ok(
      (actionA?.inputContext as { fdeStatus?: string } | null)?.fdeStatus === "queued" && tasks.length === 1,
      "FDE 只排队：after() 回调被捕获、请求内未执行",
      { ctx: actionA?.inputContext, tasks: tasks.length },
    );
    tasks.splice(0);
    ok((await counts(ORG2)).receipts === 0, "载荷里的 orgId 被忽略：另一组织没有任何收据");

    // ── Resend 重试 / 另一封同内容转发 ───────────────────────────────────
    const a2 = await post(evA);
    const ra2 = await receiptOf(ORG, `a-${stamp}`);
    ok(a2.status === 200 && a2.body.outcome === "replay" && (await counts(ORG)).opps === afterA.opps && ra2?.attempts === 2, "同一 Message-ID 重发：replay，不新建任何对象", { a2, attempts: ra2?.attempts });
    const evA3 = { ...evA, data: { ...evA.data, email_id: `em_a3-${stamp}`, message_id: `<a3-${stamp}@mail.${FACTORY}>` } };
    const a3 = await post(evA3);
    const ra3 = await receiptOf(ORG, `a3-${stamp}`);
    ok(
      a3.body.outcome === "replay" && ra3?.duplicateOfReceiptId === ra?.id && (await counts(ORG)).opps === afterA.opps,
      "同内容的另一封转发（不同 Message-ID）：独立收据指向原事件，不新建商机",
      { a3, dup: ra3?.duplicateOfReceiptId },
    );
    tasks.splice(0);

    // ── 正文经 fetcher 获取 ──────────────────────────────────────────────
    fetchBody = { text: gmailForward("Omar Example", `omar.${stamp}@examplebuyer.example`, "Sheets", "Please quote 1,200 percale sheet sets."), html: null, headers: AUTH_OK };
    const f1 = await post(event({ msgId: `f-${stamp}`, from: LILY, to: [ADDR], subject: "Fwd: Sheets" }));
    const rf = await receiptOf(ORG, `f-${stamp}`);
    ok(f1.body.outcome === "ingested" && fetched.includes(`em_f-${stamp}`) && (rf?.payload as { email?: string })?.email === `omar.${stamp}@examplebuyer.example`, "载荷无正文 → 经注入 fetcher 读 Resend receiving API", { f1, fetched });
    fetchBody = new Error("resend down");
    const f2 = await post(event({ msgId: `f2-${stamp}`, from: LILY, to: [ADDR], subject: "Fwd: x", headers: AUTH_OK }));
    ok(f2.status === 502 && !(await receiptOf(ORG, `f2-${stamp}`)), "正文取不到 → 502（Resend 重试），不落收据", f2);
    tasks.splice(0);

    // ── 隔离 ─────────────────────────────────────────────────────────────
    const c0 = await counts(ORG);
    const benText = gmailForward("Ben Example", `ben.${stamp}@examplefurnishings.example`, "Blankets", "We would like 3000 flannel fleece blankets.");
    const q1 = await post(event({ msgId: `q1-${stamp}`, from: "Mallory <mallory@evil.example>", to: [ADDR], subject: "Fwd: Blankets", text: benText, headers: { "authentication-results": "mx; dkim=pass header.d=evil.example; dmarc=pass header.from=evil.example" } }));
    const rq1 = await receiptOf(ORG, `q1-${stamp}`);
    const notes1 = rq1 ? await db.notification.findMany({ where: { orgId: ORG, sourceKey: { startsWith: `email-quarantine:${rq1.id}` } }, select: { userId: true, type: true } }) : [];
    ok(q1.status === 200 && q1.body.outcome === "quarantined" && q1.body.reasons?.join() === "sender_not_allowed", "发件人不在白名单 → 隔离", q1);
    ok(rq1?.status === "quarantined" && !rq1.prospectId && !rq1.opportunityId && JSON.stringify(await counts(ORG)) === JSON.stringify({ ...c0, receipts: c0.receipts + 1 }), "隔离：只记收据，不建线索 / 商机 / 消息", { status: rq1?.status });
    ok(notes1.length === 1 && notes1[0].userId === OWNER && notes1[0].type === "system", "隔离通知企业 owner / 管理员（不通知普通业务员）", notes1);
    const q1b = await post(event({ msgId: `q1-${stamp}`, from: "Mallory <mallory@evil.example>", to: [ADDR], subject: "Fwd: Blankets", text: benText }));
    const notes1b = await db.notification.count({ where: { orgId: ORG, sourceKey: { startsWith: `email-quarantine:${rq1?.id}` } } });
    ok(q1b.body.outcome === "quarantined" && q1b.body.reasons?.join() === "sender_not_allowed" && notes1b === 1, "隔离邮件重发：原结论，不重复通知", { q1b, notes1b });

    const q2 = await post(event({ msgId: `q2-${stamp}`, from: LILY, to: [ADDR], subject: "Fwd: Blankets", text: benText }));
    ok(q2.body.outcome === "quarantined" && q2.body.reasons?.join() === "auth_unverified", "白名单发件人但没有 DKIM / DMARC 结果 → 隔离", q2);
    const q3 = await post(
      event({
        msgId: `q3-${stamp}`,
        from: LILY,
        to: [ADDR],
        subject: "Fwd: You have a new inquiry",
        headers: AUTH_OK,
        text: `---------- Forwarded message ---------\nFrom: Alibaba.com <notice@service.alibaba.com>\nDate: Wed, Oct 22, 2026\nSubject: You have a new inquiry\nTo: <${LILY}>\n\nBuyer Name: Ahmed Example\nCompany: Example Trading LLC\nProduct: Bed Sheets\nInquiry ID: 778899\nMessage:\nPlease quote bed sheets.`,
      }),
    );
    const rq3 = await receiptOf(ORG, `q3-${stamp}`);
    ok(
      q3.body.outcome === "quarantined" && q3.body.reasons?.join() === "no_buyer_contact" && (rq3?.payload as { meta?: { parse?: { platform?: string; platformInquiryId?: string } } })?.meta?.parse?.platform === "alibaba",
      "平台通知没有买家邮箱 / 电话 → 隔离（解析结论仍留在收据里）",
      q3,
    );
    const q4 = await post(event({ msgId: `q4-${stamp}`, from: LILY, to: [ADDR], subject: "Fwd: Blankets", text: benText, headers: AUTH_OK }));
    const rq4 = await receiptOf(ORG, `q4-${stamp}`);
    ok(q4.body.outcome === "ingested" && rq4?.duplicateOfReceiptId === null && !!rq4?.opportunityId, "同内容此前被隔离过：可信转发照常新建（隔离收据不当内容孪生）", { q4, dup: rq4?.duplicateOfReceiptId });
    tasks.splice(0);

    // ── 双重入站：官网已推送的同一询盘 ───────────────────────────────────
    const webEventId = `inq_web_${stamp}`;
    const carolEmail = `carol.${stamp}@examplecoastal.example`;
    const carolMsg = "We need 800 waffle bathrobes with embroidered logo for our resort, please quote.";
    const web = normalizeInquiry({ name: "Carol Example", email: carolEmail, company: "Example Coastal Resorts", country: "Australia", product: "Bathrobes", message: carolMsg, eventId: webEventId });
    if (!web.ok) throw new Error(web.error);
    const w = await ingestWebsiteInquiry(ORG, web.value, { fdeMode: "deferred", scheduleFde: () => undefined });
    tasks.splice(0);
    const c1 = await counts(ORG);
    const notice = (eventLine: string) => `---------- Forwarded message ---------
From: Example Textiles Website <website@${FACTORY}>
Date: Mon, Oct 20, 2026 at 9:16 AM
Subject: New Website Inquiry - Bathrobes - Example Coastal Resorts
To: <${LILY}>

New inquiry submitted from Example Textiles website.

Name: Carol Example
Company: Example Coastal Resorts
Email: ${carolEmail}
Country / Region: Australia
Product Interest: Bathrobes

Message:
${carolMsg}

Inquiry Source: Contact page
${eventLine}`;
    const d1 = await post(event({ msgId: `d1-${stamp}`, from: LILY, to: [ADDR], subject: "Fwd: New Website Inquiry", text: notice(`Inquiry ID / eventId: ${webEventId}`), headers: AUTH_OK }));
    const rd1 = await receiptOf(ORG, `d1-${stamp}`);
    const c2 = await counts(ORG);
    ok(
      d1.body.outcome === "duplicate" && rd1?.status === "duplicate" && rd1.duplicateOfReceiptId === w.receiptId && rd1.opportunityId === (w.spine.ok ? w.spine.opportunityId : "?") && !rd1.salesActionId,
      "转发官网通知（带官网询盘编号）→ duplicate，指向官网收据并关联其商机",
      { d1, rd1: rd1 && { status: rd1.status, dup: rd1.duplicateOfReceiptId } },
    );
    ok(c2.opps === c1.opps && c2.prospects === c1.prospects && c2.messages === c1.messages && tasks.length === 0, "双重入站不新建线索 / 消息 / 商机，也不排 FDE", { c1, c2 });
    const d2 = await post(event({ msgId: `d2-${stamp}`, from: LILY, to: [ADDR], subject: "Fwd: New Website Inquiry", text: notice("Submitted At: 2026-10-20"), headers: AUTH_OK }));
    const rd2 = await receiptOf(ORG, `d2-${stamp}`);
    ok(d2.body.outcome === "duplicate" && (rd2?.payload as { meta?: { duplicate?: { matchedBy?: string } } })?.meta?.duplicate?.matchedBy === "content_twin" && (await counts(ORG)).opps === c1.opps, "没有编号：48 小时内内容孪生 → duplicate", d2);
    const later = new Date(Date.now() + 49 * 60 * 60 * 1000);
    const d3 = await handleResendInboundEvent(
      event({ msgId: `d3-${stamp}`, from: LILY, to: [ADDR], subject: "Fwd: New Website Inquiry", text: notice("Submitted At: 2026-10-20"), headers: AUTH_OK }),
      { domain: DOMAIN, now: later, scheduleFde: () => undefined },
    );
    const rd3 = await receiptOf(ORG, `d3-${stamp}`);
    ok(d3.body.outcome !== "duplicate" && rd3?.status !== "duplicate" && rd3?.status !== "quarantined", "48 小时以外的内容孪生不算双重入站（正常入链）", { d3: d3.body, status: rd3?.status });

    // ── 跨组织 ───────────────────────────────────────────────────────────
    const danaEvent = `inq_org2_${stamp}`;
    const danaEmail = `dana.${stamp}@exampleretail.example`;
    const web2 = normalizeInquiry({ name: "Dana Example", email: danaEmail, message: "Need 500 cushion covers in linen, natural color, 45x45cm.", eventId: danaEvent });
    if (!web2.ok) throw new Error(web2.error);
    await ingestWebsiteInquiry(ORG2, web2.value, { runFde: false });
    const org2Before = await counts(ORG2);
    const x1 = await post(
      event({
        msgId: `x1-${stamp}`,
        from: LILY,
        to: [ADDR],
        subject: "Fwd: New Website Inquiry",
        headers: AUTH_OK,
        text: `---------- Forwarded message ---------\nFrom: Site <website@${FACTORY}>\nDate: Mon, Oct 20, 2026\nSubject: New Website Inquiry\nTo: <${LILY}>\n\nName: Dana Example\nEmail: ${danaEmail}\nMessage:\nNeed 500 cushion covers in linen, natural color, 45x45cm.\n\nInquiry ID / eventId: ${danaEvent}`,
      }),
    );
    ok(x1.body.outcome === "ingested" && JSON.stringify(await counts(ORG2)) === JSON.stringify(org2Before), "别的组织的官网收据不让本组织的转发变成 duplicate，也不写别的组织", { x1 });
    const x2 = await post(event({ msgId: `x2-${stamp}`, from: LILY, to: [ADDR2], subject: "Fwd: RFQ", text: benText, headers: AUTH_OK }));
    const rx2 = await db.websiteInquiryReceipt.findFirst({ where: { orgId: ORG2, source: "email" }, select: { status: true } });
    ok(x2.body.outcome === "quarantined" && x2.body.reasons?.includes("sender_not_allowed") && rx2?.status === "quarantined", "发到另一组织别名：按那个组织的白名单判定（本组织白名单不跨用）", x2);
    const x3 = await post(event({ msgId: `x3-${stamp}`, from: LILY, to: [`inq-zzzzzzzzzz@${DOMAIN}`, "someone@else.example"], subject: "x", text: benText, headers: AUTH_OK }));
    ok(x3.status === 200 && x3.body.outcome === "ignored" && x3.body.reason === "unknown_recipient", "未知收件别名 → 200 ignored，不落收据", x3);
    tasks.splice(0);

    // ── 入驻状态：邮件转发步骤 ───────────────────────────────────────────
    const s1 = await getOnboardingStatus(ORG);
    const step1 = s1?.steps.find((s) => s.key === "email_inbound");
    ok(s1?.emailInbound.address === ADDR && step1?.status === "done" && step1.required === false, "入驻状态：已配置收信域名 + 有白名单 → 邮件转发步骤完成（推荐项）", { addr: s1?.emailInbound, step1 });
    delete process.env.INBOUND_EMAIL_DOMAIN;
    const s2 = await getOnboardingStatus(ORG);
    ok(s2?.emailInbound.address === null && s2.steps.find((s) => s.key === "email_inbound")?.status === "skipped", "未配置收信域名：不生成地址，步骤为「平台未开通」", s2?.emailInbound);
    process.env.INBOUND_EMAIL_DOMAIN = DOMAIN;
  } finally {
    __setDefaultFdeSchedulerForTest(null);
    __setInboundEmailFetcherForTest(null);
    for (const [k, v] of [["RESEND_INBOUND_WEBHOOK_SECRET", prevEnv.secret], ["INBOUND_EMAIL_DOMAIN", prevEnv.domain], ["INBOUND_EMAIL_AUTHSERV_ID", prevEnv.authserv]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
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
        await db.salesRfqEvidence.deleteMany({ where: { orgId } }).catch(() => undefined);
        await db.salesRfq.deleteMany({ where: { orgId } }).catch(() => undefined);
        await db.salesOpportunityAssessment.deleteMany({ where: { orgId } }).catch(() => undefined);
        await db.salesOpportunity.deleteMany({ where: { id: { in: opps.map((o) => o.id) } } });
        await db.salesCustomer.deleteMany({ where: { orgId } });
        await db.agentRunEvent.deleteMany({ where: { orgId } }).catch(() => undefined);
        await db.agentRun.deleteMany({ where: { orgId } }).catch(() => undefined);
        await db.agentSession.deleteMany({ where: { orgId } }).catch(() => undefined);
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

  console.log(`\n邮件转发入站 DB e2e 结果: ${pass} 通过, ${fail} 失败`);
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
