/**
 * 嵌入表单 + 渠道凭证加固（PRD F1.1 / F1.4）— 真实 DB 端到端（隔离库）
 *
 *   嵌入接口：错误 / 停用 key → 401、来源不在白名单 → 403（均不回显 CORS）、预检只回显已登记来源、
 *   成功只返回 { ok, receiptId } 并走异步入站（收据 source=embed、emb:<uuid>、meta.ipHash 不进指纹、FDE 只排队）、
 *   同一 uuid 重试幂等、蜜罐假成功不落库、字段错误 400、限流 429（每组织 × IP 10 分钟、每组织每小时；重试不占额度；
 *   组织之间互不影响）。
 *   渠道凭证：服务端密钥轮换后旧密钥宽限期内仍被 webhook / 状态接口接受、过期 401；
 *   渠道接口：外贸成员只看到末 4 位、拿不到 website 凭证、不能增删改；企业负责人可查看 / 轮换 / 改白名单，审计只记掩码；
 *   跨组织指定 orgId 被拒；重复保存沿用凭证与白名单。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/trade/__tests__/embed-intake-db.isolated.test.ts
 * 无隔离库时自动跳过。公开仓库：只用虚构企业。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过嵌入表单 DB 端到端（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "Embed inquiry form DB e2e" });

// 路由级测试需要签发会话（仅本进程内的测试密钥）
process.env.JWT_SECRET = process.env.JWT_SECRET || "embed-isolated-test-secret-0123456789";
// 链路里的 LLM 调用（询盘分析等）指向本机不可达端口：测试绝不外呼任何模型 / 搜索服务
process.env.OPENAI_BASE_URL = "http://127.0.0.1:9/v1";
delete process.env.OPENAI_API_KEY;
delete process.env.SERPER_API_KEY;
// 请求次数粗筛走内存实现（不连 Upstash）
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

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
  const { randomUUID } = await import("node:crypto");
  const { db } = await import("@/lib/db");
  const { NextRequest } = await import("next/server");
  const { createSession } = await import("@/lib/auth/session");
  const { __setDefaultFdeSchedulerForTest } = await import("@/lib/trade/website-inquiry");
  const { computePayloadHash, fromReceiptPayload, EMBED_INQUIRY_SOURCE } = await import("@/lib/trade/website-inquiry-receipts");
  const { hashClientIp, readWebsiteCredentials } = await import("@/lib/trade/website-channel-credentials");
  const { EMBED_RATE_LIMITS } = await import("@/lib/trade/embed-rate-limit");
  const { upsertWebsiteChannel, setWebsiteChannelAllowedOrigins, rotateWebsiteChannelSecret } = await import("@/lib/trade/channel-service");
  const embedRoute = await import("@/app/api/trade/webhook/website/embed/route");
  const webhookRoute = await import("@/app/api/trade/webhook/website/route");
  const statusRoute = await import("@/app/api/trade/webhook/website/status/route");
  const channelsRoute = await import("@/app/api/trade/channels/route");
  const channelRoute = await import("@/app/api/trade/channels/[channel]/route");

  const stamp = Date.now().toString(36);
  const ORG = `emborg_${stamp}`;
  const ORG2 = `emborg2_${stamp}`;
  const OWNER = `embowner_${stamp}`;
  const TRADE = `embtrade_${stamp}`;
  const OTHER = `embother_${stamp}`;
  const SITE = "https://www.example-textiles.example";
  const SITE2 = "https://maple-home.example";
  const users = [OWNER, TRADE, OTHER];

  await db.user.create({ data: { id: OWNER, email: `${OWNER}@fixture.test`, name: "Example Owner", role: "trade" } });
  await db.user.create({ data: { id: TRADE, email: `${TRADE}@fixture.test`, name: "Example Trade Rep", role: "trade" } });
  await db.user.create({ data: { id: OTHER, email: `${OTHER}@fixture.test`, name: "Maple Owner", role: "trade" } });
  await db.organization.create({ data: { id: ORG, name: "Example Textiles Fixture", code: `emb-${stamp}`, ownerId: OWNER } });
  await db.organization.create({ data: { id: ORG2, name: "Maple Home Goods Fixture", code: `emb2-${stamp}`, ownerId: OTHER } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: OWNER, role: "org_owner", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: TRADE, role: "org_member", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG2, userId: OTHER, role: "org_owner", status: "active" } });
  await db.tradeChannel.create({
    data: { orgId: ORG, channel: "whatsapp", name: "WA", config: { accessToken: `wa-token-${stamp}-secret-9911`, phoneNumberId: "100200300" } },
  });

  // 网站通道：走与渠道页 / 入驻向导相同的创建路径，再登记来源白名单
  await upsertWebsiteChannel({ orgId: ORG, name: "Example site" });
  await setWebsiteChannelAllowedOrigins(ORG, [SITE]);
  await upsertWebsiteChannel({ orgId: ORG2, name: "Maple site" });
  await setWebsiteChannelAllowedOrigins(ORG2, [SITE2]);
  const credOf = async (orgId: string) =>
    readWebsiteCredentials((await db.tradeChannel.findUniqueOrThrow({ where: { orgId_channel: { orgId, channel: "website" } } })).config);
  const cred1 = await credOf(ORG);
  const cred2 = await credOf(ORG2);

  // FDE 回调不执行（模拟 after()）：本测试只看请求路径
  const scheduled: Array<() => Promise<void>> = [];
  __setDefaultFdeSchedulerForTest((task) => {
    scheduled.push(task);
  });

  type EmbedBody = { ok?: boolean; receiptId?: string; error?: string; [k: string]: unknown };
  const embedPost = async (body: Record<string, unknown>, opts: { key?: string | null; origin?: string | null; ip?: string } = {}) => {
    const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": opts.ip ?? "203.0.113.10" };
    const key = opts.key === undefined ? cred1.publicKey! : opts.key;
    if (key) headers["x-qingyan-form-key"] = key;
    const origin = opts.origin === undefined ? SITE : opts.origin;
    if (origin) headers.origin = origin;
    const res = await embedRoute.POST(
      new NextRequest("http://localhost/api/trade/webhook/website/embed", { method: "POST", headers, body: JSON.stringify(body) }),
    );
    return { status: res.status, headers: res.headers, body: (await res.json()) as EmbedBody };
  };
  const form = (key: string, extra: Record<string, unknown> = {}) => ({
    eventId: randomUUID(),
    name: `${key} Buyer`,
    email: `${key}.${stamp}@maple-home.example`,
    company: `Maple Home Goods ${key} ${stamp}`,
    country: "Canada",
    product: "Waffle bathrobe",
    quantity: "1,500 pcs",
    message: `Hotel order ${key}: 380 gsm, embroidered logo. Please share MOQ and lead time.`,
    page: `${SITE}/contact`,
    referrer: "https://www.search.example/",
    landing: `${SITE}/bathrobes?utm_source=newsletter`,
    utm_source: "newsletter",
    _hp: "",
    ...extra,
  });
  const receiptsCount = (orgId = ORG) => db.websiteInquiryReceipt.count({ where: { orgId, source: EMBED_INQUIRY_SOURCE } });

  const session = async (id: string) => createSession({ sub: id, email: `${id}@fixture.test`, role: "trade" });
  const ownerCookie = `qy_session=${await session(OWNER)}`;
  const tradeCookie = `qy_session=${await session(TRADE)}`;
  const api = (url: string, init: { method?: string; body?: unknown; cookie: string }) =>
    new NextRequest(`http://localhost${url}`, {
      method: init.method ?? "GET",
      headers: { "content-type": "application/json", cookie: init.cookie, "x-forwarded-for": "10.30.0.1" },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  const ctx = (channel: string) => ({ params: Promise.resolve({ channel }) });

  try {
    console.log("\n[1] 鉴权：公开 key + 来源白名单（失败不回显 CORS）");
    const noKey = await embedPost(form("nokey"), { key: null });
    const badKey = await embedPost(form("badkey"), { key: `qyk_${"A".repeat(32)}` });
    const malformed = await embedPost(form("malformed"), { key: "not-a-key" });
    ok(
      noKey.status === 401 && badKey.status === 401 && malformed.status === 401 && badKey.body.error === "invalid_key" && !badKey.headers.get("access-control-allow-origin"),
      "缺 key / 错 key / 格式不对 → 401，且不带 Access-Control-Allow-Origin",
      { noKey: noKey.status, badKey: badKey.status, malformed: malformed.status, acao: badKey.headers.get("access-control-allow-origin") },
    );
    const badOrigin = await embedPost(form("badorigin"), { origin: "https://evil.example" });
    const noOrigin = await embedPost(form("noorigin"), { origin: null });
    const wwwVariant = await embedPost(form("variant"), { origin: "https://example-textiles.example" });
    const httpVariant = await embedPost(form("httpvariant"), { origin: "http://www.example-textiles.example" });
    const otherOrgsSite = await embedPost(form("crossorg"), { origin: SITE2 });
    ok(
      [badOrigin, noOrigin, wwwVariant, httpVariant, otherOrgsSite].every((r) => r.status === 403 && r.body.error === "origin_not_allowed" && !r.headers.get("access-control-allow-origin")),
      "来源不在本通道白名单（陌生站 / 缺 Origin / 不带 www / http / 他组织的站）→ 403，不回显 CORS",
      [badOrigin, noOrigin, wwwVariant, httpVariant, otherOrgsSite].map((r) => r.status),
    );
    ok((await receiptsCount()) === 0 && (await receiptsCount(ORG2)) === 0, "被拒的请求没有写任何收据");

    const pre = async (origin: string) =>
      embedRoute.OPTIONS(new NextRequest("http://localhost/api/trade/webhook/website/embed", { method: "OPTIONS", headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "content-type,x-qingyan-form-key" } }));
    const preOk = await pre(SITE);
    const preBad = await pre("https://evil.example");
    ok(
      preOk.status === 204 && preOk.headers.get("access-control-allow-origin") === SITE && /x-qingyan-form-key/.test(preOk.headers.get("access-control-allow-headers") ?? "") && !preBad.headers.get("access-control-allow-origin"),
      "预检：已登记来源回显 Origin 与 x-qingyan-form-key；未登记来源不回显",
      { ok: preOk.headers.get("access-control-allow-origin"), bad: preBad.headers.get("access-control-allow-origin") },
    );

    console.log("\n[2] 成功：只返回 { ok, receiptId }，异步入站（FDE 只排队）");
    const A = form("a");
    const r1 = await embedPost(A);
    ok(
      r1.status === 200 && r1.body.ok === true && typeof r1.body.receiptId === "string" && Object.keys(r1.body).sort().join(",") === "ok,receiptId",
      "HTTP 200，响应体只有 ok + receiptId（无线索 / 商机 / duplicate 等内部字段）",
      r1.body,
    );
    ok(r1.headers.get("access-control-allow-origin") === SITE && (r1.headers.get("vary") ?? "").includes("Origin"), "CORS 只回显本通道白名单里的来源（Vary: Origin）", r1.headers.get("access-control-allow-origin"));
    const receiptA = await db.websiteInquiryReceipt.findUnique({ where: { id: String(r1.body.receiptId) } });
    const payloadA = (receiptA?.payload ?? {}) as Record<string, unknown>;
    const ipHashA = hashClientIp("203.0.113.10", cred1.ipSalt!);
    ok(
      receiptA?.orgId === ORG && receiptA.source === "embed" && receiptA.eventId === `emb:${A.eventId}` && receiptA.status === "linked",
      "收据：本组织、source=embed、事件 id = emb:<浏览器 uuid>、请求返回前已释放（linked）",
      receiptA && { org: receiptA.orgId, source: receiptA.source, eventId: receiptA.eventId, status: receiptA.status },
    );
    ok(
      (payloadA.meta as Record<string, unknown> | undefined)?.ipHash === ipHashA && !JSON.stringify(payloadA).includes("203.0.113.10"),
      "收据载荷 meta.ipHash = 访客 IP 的 HMAC（不存原始 IP）",
      payloadA.meta,
    );
    ok(
      receiptA?.payloadHash === computePayloadHash(fromReceiptPayload(receiptA!.payload)) && payloadA.referrer === A.referrer && payloadA.landing === A.landing,
      "业务指纹不含 meta / referrer / 落地页；referrer 与落地页随载荷保存",
      { referrer: payloadA.referrer, landing: payloadA.landing },
    );
    const prospect = receiptA?.prospectId ? await db.tradeProspect.findUnique({ where: { id: receiptA.prospectId }, select: { orgId: true, source: true } }) : null;
    const message = receiptA?.tradeMessageId ? await db.tradeMessage.findUnique({ where: { id: receiptA.tradeMessageId }, select: { content: true, channel: true } }) : null;
    ok(
      prospect?.orgId === ORG && prospect.source === "website" && message?.channel === "website" && /^【网站询盘（嵌入表单）】/.test(message.content) && /Quantity: 1,500 pcs/.test(message.content) && /引荐页：https:\/\/www\.search\.example\//.test(message.content),
      "Trade 线索 / 消息：网站来源，正文标明嵌入表单、含数量与引荐页",
      { prospect, message: message?.content?.slice(0, 200) },
    );
    const interaction = receiptA?.interactionId ? await db.customerInteraction.findUnique({ where: { id: receiptA.interactionId }, select: { orgId: true, analysisResult: true } }) : null;
    const extra = (interaction?.analysisResult ?? {}) as Record<string, unknown>;
    ok(
      !!receiptA?.opportunityId && interaction?.orgId === ORG && extra.referrer === A.referrer && extra.landing === A.landing,
      "Revenue Spine：商机已建，互动记录 referrer / 落地页",
      { opp: receiptA?.opportunityId, referrer: extra.referrer, landing: extra.landing },
    );
    const actionA = receiptA?.salesActionId ? await db.salesAction.findUnique({ where: { id: receiptA.salesActionId }, select: { inputContext: true } }) : null;
    const runsA = await db.agentRun.count({ where: { orgId: ORG, runType: "fde_inbound_sales" } });
    ok(
      (actionA?.inputContext as Record<string, unknown> | null)?.fdeStatus === "queued" && runsA === 0 && scheduled.length === 1,
      "FDE 只排队（交给 after() 调度器），请求内没有 AgentRun",
      { fde: (actionA?.inputContext as Record<string, unknown> | null)?.fdeStatus, runs: runsA, scheduled: scheduled.length },
    );

    console.log("\n[3] 同一 uuid 重试幂等；蜜罐；字段错误");
    const r1b = await embedPost(A);
    const receiptA2 = await db.websiteInquiryReceipt.findUnique({ where: { id: String(r1.body.receiptId) } });
    ok(r1b.status === 200 && r1b.body.receiptId === r1.body.receiptId && (await receiptsCount()) === 1 && receiptA2?.attempts === 2, "同一 uuid 重发 → 同一 receiptId，不新建收据（attempts=2）", { body: r1b.body, attempts: receiptA2?.attempts });
    const before = await receiptsCount();
    const prospectsBefore = await db.tradeProspect.count({ where: { orgId: ORG } });
    const bot = await embedPost(form("bot", { _hp: "http://spam.example" }));
    ok(
      bot.status === 200 && bot.body.ok === true && typeof bot.body.receiptId === "string" && Object.keys(bot.body).sort().join(",") === "ok,receiptId" &&
        !(await db.websiteInquiryReceipt.findUnique({ where: { id: String(bot.body.receiptId) } })) && (await receiptsCount()) === before && (await db.tradeProspect.count({ where: { orgId: ORG } })) === prospectsBefore,
      "蜜罐：与成功同形的响应（假 receiptId），不落库",
      bot.body,
    );
    const noEmail = await embedPost(form("noemail", { email: "" }));
    const badEmail = await embedPost(form("bademail", { email: "not-an-email" }));
    ok(
      noEmail.status === 400 && noEmail.body.error === "email_required" && badEmail.status === 400 && badEmail.body.error === "invalid_email" && badEmail.headers.get("access-control-allow-origin") === SITE,
      "缺邮箱 / 邮箱格式错 → 400（带 CORS，脚本可提示访客）",
      { noEmail: noEmail.body, badEmail: badEmail.body },
    );

    console.log("\n[4] 限流（数据库计数）");
    const filler = async (orgId: string, n: number, ipHash: string | null) => {
      const now = Date.now();
      await db.websiteInquiryReceipt.createMany({
        data: Array.from({ length: n }, (_, i) => ({
          orgId,
          source: EMBED_INQUIRY_SOURCE,
          eventId: `emb:filler-${ipHash ?? "noip"}-${i}-${stamp}-${Math.random().toString(36).slice(2, 8)}`,
          payload: { email: `filler${i}@maple-home.example`, ...(ipHash ? { meta: { ipHash } } : {}) },
          payloadHash: `filler-${i}-${Math.random()}`,
          status: "complete",
          firstSeenAt: new Date(now - 60_000),
        })),
      });
    };
    // IP A 已有 1 张收据；补到上限
    await filler(ORG, EMBED_RATE_LIMITS.perIp - 1, ipHashA);
    const limited = await embedPost(form("limited"));
    ok(
      limited.status === 429 && limited.body.error === "rate_limited" && Number(limited.headers.get("retry-after")) === EMBED_RATE_LIMITS.perIpWindowMs / 1000 && limited.headers.get("access-control-allow-origin") === SITE,
      `同一访客 IP 10 分钟内第 ${EMBED_RATE_LIMITS.perIp + 1} 条新询盘 → 429 + Retry-After`,
      { status: limited.status, body: limited.body, retry: limited.headers.get("retry-after") },
    );
    const retryKnown = await embedPost(A);
    ok(retryKnown.status === 200 && retryKnown.body.receiptId === r1.body.receiptId, "已收到事件的重试不占额度（仍 200、同一 receiptId）", retryKnown.body);
    const otherIp = await embedPost(form("otherip"), { ip: "198.51.100.20" });
    ok(otherIp.status === 200 && otherIp.body.ok === true, "另一访客 IP 不受影响", otherIp.body);
    const org2Same = await embedPost(form("org2"), { key: cred2.publicKey!, origin: SITE2 });
    ok(org2Same.status === 200 && (await receiptsCount(ORG2)) === 1, "同一 IP 提交到另一组织：按组织计数，互不影响", org2Same.body);
    const countNow = await receiptsCount();
    await filler(ORG, Math.max(0, EMBED_RATE_LIMITS.perOrgHour - countNow), null);
    const orgLimited = await embedPost(form("orglimit"), { ip: "192.0.2.77" });
    ok(orgLimited.status === 429 && Number(orgLimited.headers.get("retry-after")) === 3600, `组织 1 小时内达到 ${EMBED_RATE_LIMITS.perOrgHour} 条 → 新 IP 也 429`, { status: orgLimited.status, retry: orgLimited.headers.get("retry-after") });

    console.log("\n[5] 服务端密钥轮换：宽限期内旧密钥仍可用，过期 401");
    const s0 = cred1.secret!;
    const webhook = async (secret: string, key: string) => {
      const res = await webhookRoute.POST(
        new NextRequest("http://localhost/api/trade/webhook/website", {
          method: "POST",
          headers: { "content-type": "application/json", "x-qingyan-webhook-secret": secret },
          body: JSON.stringify({ eventId: `evt_rot_${key}_${stamp}`, name: "Rotation Buyer", email: `rot.${key}.${stamp}@maple-home.example`, message: `rotation check ${key}` }),
        }),
      );
      return res.status;
    };
    const status = async (secret: string) =>
      (await statusRoute.GET(new NextRequest(`http://localhost/api/trade/webhook/website/status?eventId=evt_missing_${stamp}`, { headers: { "x-qingyan-webhook-secret": secret } }))).status;
    ok((await webhook(s0, "s0")) === 200, "轮换前：当前密钥 200");
    await rotateWebsiteChannelSecret(ORG, new Date());
    const s1 = (await credOf(ORG)).secret!;
    ok(s1 !== s0 && (await webhook(s1, "s1")) === 200 && (await webhook(s0, "s0b")) === 200, "轮换后：新密钥 200，旧密钥宽限期内仍 200");
    ok((await status(s0)) === 404 && (await status(s1)) === 404, "状态接口也接受宽限期内的旧密钥（鉴权通过 → 未知事件 404）");
    // 再轮换一次，且把轮换时刻放在 73 小时前：s1 成为旧密钥但宽限期已过；s0 不再被接受
    await rotateWebsiteChannelSecret(ORG, new Date(Date.now() - 73 * 60 * 60 * 1000));
    const s2 = (await credOf(ORG)).secret!;
    ok((await webhook(s2, "s2")) === 200 && (await webhook(s1, "s1b")) === 401 && (await webhook(s0, "s0c")) === 401 && (await status(s1)) === 401, "宽限期已过的旧密钥 401；更早的密钥 401；当前密钥 200");
    const c2 = await credOf(ORG);
    ok(c2.publicKey === cred1.publicKey && c2.allowedOrigins.join() === SITE, "密钥轮换不动公开 key 与来源白名单");

    console.log("\n[6] 渠道接口：成员只看掩码，管理只给企业负责人 / 管理员");
    const tradeList = await channelsRoute.GET(api(`/api/trade/channels?orgId=${ORG}`, { cookie: tradeCookie }));
    const tradeListText = JSON.stringify(await tradeList.json());
    ok(
      tradeList.status === 200 && tradeList.headers.get("x-qingyan-can-manage-channels") === "0" && !tradeListText.includes(`wa-token-${stamp}`) && tradeListText.includes("****9911") && !tradeListText.includes(s2) && !tradeListText.includes(cred1.publicKey!) && !tradeListText.includes(cred1.ipSalt!),
      "外贸成员看列表：WhatsApp token / 网站密钥 / 公开 key 只显示末 4 位，没有 IP 盐；响应头 can-manage=0",
    );
    const tradeWa = await channelRoute.GET(api(`/api/trade/channels/whatsapp?orgId=${ORG}`, { cookie: tradeCookie }), ctx("whatsapp"));
    const tradeWaText = JSON.stringify(await tradeWa.json());
    ok(tradeWa.status === 200 && !tradeWaText.includes(`wa-token-${stamp}`), "GET 单个通道（WhatsApp）不再原样返回凭证", tradeWaText.slice(0, 300));
    const tradeWeb = await channelRoute.GET(api(`/api/trade/channels/website?orgId=${ORG}`, { cookie: tradeCookie }), ctx("website"));
    const tradeWebBody = (await tradeWeb.json()) as Record<string, unknown>;
    ok(tradeWeb.status === 200 && tradeWebBody.canManage === false && !("website" in tradeWebBody) && !JSON.stringify(tradeWebBody).includes(s2), "外贸成员拿不到 website 密钥 / 公开 key（无 website 字段）", tradeWebBody);
    const tradePatch = await channelRoute.PATCH(api("/api/trade/channels/website", { method: "PATCH", body: { orgId: ORG, action: "rotate_secret" }, cookie: tradeCookie }), ctx("website"));
    const tradeDelete = await channelRoute.DELETE(api(`/api/trade/channels/whatsapp?orgId=${ORG}`, { method: "DELETE", cookie: tradeCookie }), ctx("whatsapp"));
    const tradeCreate = await channelsRoute.POST(api("/api/trade/channels", { method: "POST", body: { orgId: ORG, channel: "website", name: "x", config: {} }, cookie: tradeCookie }));
    ok(tradePatch.status === 403 && tradeDelete.status === 403 && tradeCreate.status === 403 && (await credOf(ORG)).secret === s2, "外贸成员轮换 / 删除 / 新建 → 403，凭证未变", { patch: tradePatch.status, del: tradeDelete.status, create: tradeCreate.status });

    const ownerWeb = await channelRoute.GET(api(`/api/trade/channels/website?orgId=${ORG}`, { cookie: ownerCookie }), ctx("website"));
    const ownerWebBody = (await ownerWeb.json()) as { canManage?: boolean; website?: { secret?: string; publicKey?: string; allowedOrigins?: string[]; secretPrevExpiresAt?: string | null }; config?: Record<string, unknown> };
    ok(
      ownerWeb.status === 200 && ownerWebBody.canManage === true && ownerWebBody.website?.secret === s2 && ownerWebBody.website.publicKey === cred1.publicKey && ownerWebBody.website.allowedOrigins?.join() === SITE && ownerWebBody.website.secretPrevExpiresAt === null && !JSON.stringify(ownerWebBody).includes(cred1.ipSalt!),
      "企业负责人：拿到当前密钥 / 公开 key / 白名单；宽限期已过不显示旧密钥到期；IP 盐永不返回",
      ownerWebBody.website,
    );
    const ownerList = await channelsRoute.GET(api(`/api/trade/channels?orgId=${ORG}`, { cookie: ownerCookie }));
    ok(ownerList.headers.get("x-qingyan-can-manage-channels") === "1", "企业负责人列表响应头 can-manage=1");
    const crossOrg = await channelRoute.GET(api(`/api/trade/channels/website?orgId=${ORG2}`, { cookie: ownerCookie }), ctx("website"));
    ok(crossOrg.status === 403, "指定别的组织 orgId → 403（组织由服务端解析，不信任请求里的 orgId）", crossOrg.status);

    const badOrigins = await channelRoute.PATCH(
      api("/api/trade/channels/website", { method: "PATCH", body: { orgId: ORG, action: "set_allowed_origins", allowedOrigins: ["https://ok.example", "https://bad.example/contact", "*"] }, cookie: ownerCookie }),
      ctx("website"),
    );
    ok(badOrigins.status === 400 && (await credOf(ORG)).allowedOrigins.join() === SITE, "白名单含路径 / 通配符 → 400，不保存", badOrigins.status);
    const setOrigins = await channelRoute.PATCH(
      api("/api/trade/channels/website", { method: "PATCH", body: { orgId: ORG, action: "set_allowed_origins", allowedOrigins: [SITE, "https://Example-Textiles.example/"] }, cookie: ownerCookie }),
      ctx("website"),
    );
    const setBody = (await setOrigins.json()) as { website?: { allowedOrigins?: string[] } };
    ok(setOrigins.status === 200 && setBody.website?.allowedOrigins?.join() === `${SITE},https://example-textiles.example`, "保存白名单：规范化（小写、去尾斜杠）", setBody.website);
    const nowVariant = await embedPost(form("variant2"), { origin: "https://example-textiles.example", ip: "192.0.2.99" });
    ok(nowVariant.status !== 403, "新登记的来源不再 403（此处因组织小时额度已满会 429）", nowVariant.status);

    const rotKey = await channelRoute.PATCH(api("/api/trade/channels/website", { method: "PATCH", body: { orgId: ORG, action: "rotate_public_key" }, cookie: ownerCookie }), ctx("website"));
    const rotKeyBody = (await rotKey.json()) as { website?: { publicKey?: string } };
    const oldKeyNow = await embedPost(form("oldkey"), { key: cred1.publicKey! });
    ok(rotKey.status === 200 && !!rotKeyBody.website?.publicKey && rotKeyBody.website.publicKey !== cred1.publicKey && oldKeyNow.status === 401, "轮换公开 key：立即生效，旧 key 401", { status: rotKey.status, old: oldKeyNow.status });

    const rotSecret = await channelRoute.PATCH(api("/api/trade/channels/website", { method: "PATCH", body: { orgId: ORG, action: "rotate_secret" }, cookie: ownerCookie }), ctx("website"));
    const rotSecretBody = (await rotSecret.json()) as { website?: { secret?: string; secretPrevExpiresAt?: string | null } };
    const exp = rotSecretBody.website?.secretPrevExpiresAt ? Date.parse(rotSecretBody.website.secretPrevExpiresAt) : NaN;
    ok(
      rotSecret.status === 200 && rotSecretBody.website?.secret !== s2 && Math.abs(exp - (Date.now() + 72 * 3600_000)) < 120_000 && (await webhook(s2, "s2b")) === 200,
      "接口轮换密钥：返回新密钥与 72 小时后的旧密钥到期时间，旧密钥仍可用",
      rotSecretBody.website,
    );
    const audits = await db.auditLog.findMany({ where: { orgId: ORG, action: { startsWith: "trade.channel.website." } } });
    const auditText = JSON.stringify(audits.map((a) => [a.beforeData, a.afterData]));
    ok(
      audits.length >= 3 && !auditText.includes(s2) && !auditText.includes(String(rotSecretBody.website?.secret)) && !auditText.includes(cred1.publicKey!) && !auditText.includes(String(rotKeyBody.website?.publicKey)),
      "审计：记录每个管理动作，只含凭证掩码",
      audits.map((a) => a.action),
    );

    const credBeforeResave = await credOf(ORG);
    const resave = await channelsRoute.POST(api("/api/trade/channels", { method: "POST", body: { orgId: ORG, channel: "website", name: "Example site renamed", config: { secret: "attacker-chosen", publicKey: `qyk_${"B".repeat(32)}`, allowedOrigins: ["https://evil.example"] } }, cookie: ownerCookie }));
    const credAfter = await credOf(ORG);
    ok(
      resave.status === 201 && credAfter.secret === credBeforeResave.secret && credAfter.publicKey === credBeforeResave.publicKey && credAfter.allowedOrigins.join() === credBeforeResave.allowedOrigins.join() && credAfter.ipSalt === credBeforeResave.ipSalt,
      "重复保存 website 通道：沿用凭证与白名单，请求里的 config 不能写凭证",
      { status: resave.status },
    );
    const waCreate = await channelsRoute.POST(api("/api/trade/channels", { method: "POST", body: { orgId: ORG, channel: "whatsapp", name: "WA2", config: { accessToken: `wa-new-${stamp}-token-7788`, phoneNumberId: "100200300" } }, cookie: ownerCookie }));
    const waText = JSON.stringify(await waCreate.json());
    ok(waCreate.status === 201 && !waText.includes(`wa-new-${stamp}`) && waText.includes("****7788"), "新建 / 更新其他通道：响应只回掩码", waText.slice(0, 200));
    const weird = await channelsRoute.POST(api("/api/trade/channels", { method: "POST", body: { orgId: ORG, channel: "telegram", name: "x", config: {} }, cookie: ownerCookie }));
    ok(weird.status === 400, "不支持的通道类型 → 400", weird.status);
  } finally {
    __setDefaultFdeSchedulerForTest(null);
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
      await db.auditLog.deleteMany({ where: { userId: { in: users } } });
      await db.notification.deleteMany({ where: { userId: { in: users } } });
      await db.user.deleteMany({ where: { id: { in: users } } });
    } catch (cleanupErr) {
      console.warn("[cleanup] 清理未完成（不覆盖原始错误）：", cleanupErr instanceof Error ? cleanupErr.message : cleanupErr);
    }
  }

  console.log(`\n嵌入表单 DB e2e 结果: ${pass} 通过, ${fail} 失败`);
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
