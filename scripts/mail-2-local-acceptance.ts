/**
 * MAIL-2 本地验收（change mail-watch；任务书「验收」MAIL-2 与「MAIL-2 公共地址」两组里能在本地确定性验证的部分）
 *
 * 跑的是真实的：定时任务路由（GET /api/cron/sales-actions，含前后其它步骤）、组织开关与成员勾选两个接口、
 *   客户详情接口与邮件绑定状态接口（时间线入口读的数据）、来信观察编排、Gmail 读接口函数、本地 Postgres。
 * 替换掉的外部依赖：
 *   - Gmail：googleapis 的 gmail 客户端换成内存里的假邮箱（按访问令牌区分是谁的邮箱）。不连 Google。
 *     假邮箱只支持元数据读取；取正文、附件、修改、发送任何一个被调用都会抛错。
 *   - 微信：测试环境不允许真实外发，经定时任务路由跑时推送一律记为「跳过」。
 *     推送文案另用同一个编排函数、注入一个只记录不发送的推送函数来核对（第 [11] 段，已注明）。
 * 所以这里验证不了：真实 Gmail 的 history 行为与配额；公共地址（sales@ / info@）来信在个人邮箱里的真实头
 *   （任务书「不确定处」）；真实微信送达；15 分钟的真实调度（Vercel cron）。
 *
 * 只允许对本机的隔离库运行（NODE_ENV=test、DATABASE_ENVIRONMENT=isolated、DATABASE_URL 指向 localhost）。
 * 用法：
 *   DATABASE_URL=postgresql://…@127.0.0.1:…/… DIRECT_URL=同上 NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *     npx tsx scripts/mail-2-local-acceptance.ts
 * 可选：MAIL2_FIXTURE_OUT=<文件> 把夹具的会话令牌与 id 写到该文件（本地截图用；不要提交）。
 */

import { writeFileSync } from "node:fs";

function refuse(reason: string): never {
  console.error(`拒绝运行：${reason}`);
  process.exit(2);
}
const dbUrl = process.env.DATABASE_URL?.trim() ?? "";
if (!dbUrl) refuse("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") refuse("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") refuse("需 DATABASE_ENVIRONMENT=isolated");
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(dbUrl)) refuse("DATABASE_URL 不是本机地址");

process.env.JWT_SECRET = process.env.JWT_SECRET || "mail-2-local-acceptance-secret-0123456789abcdef";
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.GOOGLE_CLIENT_ID = "local-acceptance.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "local-acceptance-secret";
process.env.GOOGLE_EMAIL_REDIRECT_URI = "http://localhost:3000/api/auth/google-email/callback";
process.env.CRON_SECRET = "mail-2-local-acceptance-cron-secret";
// 合并时的状态：两个开关都没配
delete process.env.MAIL_WATCH_ENABLED;
delete process.env.MAIL_READ_ENABLED;

let pass = 0;
let fail = 0;
const failed: string[] = [];
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    failed.push(name);
    console.error(`  ✗ ${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail).slice(0, 1500)}`}`);
  }
}

type Handler = (r: unknown, c: unknown) => Promise<Response>;
type Json = Record<string, unknown>;

/** 邮件正文里的一句话：整个验收结束后在库里搜它，一处都不该有 */
const BODY_MARK = "正文标记-周五上午十点上门-BODY-7f3a";

async function main() {
  const { assertSafeTestDatabase } = await import("../src/lib/testing/assert-safe-test-database");
  assertSafeTestDatabase({ scriptName: "MAIL-2 local acceptance" });

  const { FakeMailbox, COMPOSE_ONLY_SCOPES, READ_SCOPES } = await import("../src/lib/mail-watch/__tests__/fake-mailbox");
  type Box = InstanceType<typeof FakeMailbox>;
  const boxByToken: Record<string, Box> = {};
  const { google } = await import("googleapis");
  (google as unknown as { gmail: (o: { auth: { credentials: { access_token?: string } } }) => unknown }).gmail = (o) => {
    const box = boxByToken[String(o.auth.credentials.access_token)];
    if (!box) throw new Error("验收夹具里没有这个令牌对应的邮箱");
    return box.api();
  };

  const { db } = await import("../src/lib/db");
  const { NextRequest } = await import("next/server");
  const { createSession } = await import("../src/lib/auth/session");
  const { encryptField } = await import("../src/lib/crypto");
  const { seedOrgAuthorizationProfiles } = await import("../src/lib/authorization/seed-org-profiles");
  const { DEFAULT_SUNNY_MODULES } = await import("../src/lib/tenancy/modules");
  const { readMailWatch, withCursor, withMailWatch } = await import("../src/lib/mail-watch/pure");
  const { mailWatchPanelState, mailWatchReceivedAt, readMailHref, showReadMailEntry } = await import("../src/lib/mail-watch/ui-pure");
  const { mutateOrgSettings } = await import("../src/lib/organizations/settings-write");
  const { runMailWatch } = await import("../src/lib/mail-watch/run");
  const cronRoute = await import("../src/app/api/cron/sales-actions/route");
  const orgRoute = await import("../src/app/api/organizations/[orgId]/mail-watch-settings/route");
  const optInRoute = await import("../src/app/api/sales/mail-watch/opt-in/route");
  const customerRoute = await import("../src/app/api/sales/customers/[id]/route");
  const statusRoute = await import("../src/app/api/sales/email-status/route");

  const stamp = Date.now().toString(36);
  const LYNN = `m2lynn_${stamp}`; // 销售
  const SAM = `m2sam_${stamp}`; // 另一位销售（Lynn、Marty 都看不到他的客户）
  const LUCAS = `m2lucas_${stamp}`; // 老板岗；他的邮箱同时收 sales@
  const MARTY = `m2marty_${stamp}`; // 销售岗；他的邮箱同时收 info@
  const OLD = `m2old_${stamp}`; // 销售，只有撰写权限的旧授权
  const ORG = `m2org_${stamp}`;
  const users = [LYNN, SAM, LUCAS, MARTY, OLD];

  for (const id of users) await db.user.create({ data: { id, email: `${id}@fixture.test`, name: `Example ${id.split("_")[0].slice(2)}`, role: "user" } });
  // 启用模块与窗饰企业一致（客户详情页按 sales 模块放行）
  await db.organization.create({
    data: { id: ORG, name: "Example Blinds Fixture", code: `m2-${stamp}`, ownerId: LUCAS, industryPackId: "window_covering_services_v1", modulesJson: { enabled: [...DEFAULT_SUNNY_MODULES] } },
  });
  for (const userId of users) await db.organizationMember.create({ data: { orgId: ORG, userId, role: userId === LUCAS ? "org_admin" : "org_member", status: "active" } });
  await seedOrgAuthorizationProfiles(ORG);
  const bind = async (userId: string, key: string) => {
    const profile = await db.roleProfile.findUnique({ where: { orgId_key: { orgId: ORG, key } } });
    await db.principalRoleBinding.create({ data: { orgId: ORG, principalType: "HUMAN", principalId: userId, roleProfileId: profile!.id, status: "active" } });
  };
  for (const u of [LYNN, SAM, MARTY, OLD]) await bind(u, "sales_rep");
  await bind(LUCAS, "owner");

  const C_WANG = `m2cwang_${stamp}`; // Lynn 的客户
  const C_LI = `m2cli_${stamp}`; // Sam 的客户
  const C_ZHAO = `m2czhao_${stamp}`; // Marty 的客户
  await db.salesCustomer.create({ data: { id: C_WANG, orgId: ORG, name: "王总", createdById: LYNN, email: "wang@client.example" } });
  await db.salesCustomer.create({ data: { id: C_LI, orgId: ORG, name: "李总", createdById: SAM, email: "li@client.example" } });
  await db.salesCustomer.create({ data: { id: C_ZHAO, orgId: ORG, name: "赵总", createdById: MARTY, email: "zhao@client.example" } });

  const boxes: Record<string, Box> = { [LYNN]: new FakeMailbox("1a"), [LUCAS]: new FakeMailbox("2b"), [MARTY]: new FakeMailbox("3c"), [OLD]: new FakeMailbox("4d") };
  for (const [uid, box] of Object.entries(boxes)) {
    boxByToken[`tok-${uid}`] = box;
    await db.emailProvider.create({
      data: { userId: uid, type: "gmail", accessToken: encryptField(`tok-${uid}`), refreshToken: null, accountEmail: `${uid}@fixture.test`, grantedScopes: uid === OLD ? COMPOSE_ONLY_SCOPES : READ_SCOPES },
    });
  }

  const tokens: Record<string, string> = {};
  for (const u of users) tokens[u] = await createSession({ sub: u, email: `${u}@fixture.test`, role: "user" });
  const call = async (handler: unknown, uid: string, url: string, method = "GET", body?: unknown, params: Record<string, string> = {}) => {
    const r = new NextRequest(`http://localhost${url}`, {
      method,
      headers: { "content-type": "application/json", cookie: `qy_session=${tokens[uid]}`, "x-forwarded-for": "10.32.0.7" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const res = await (handler as Handler)(r, { params: Promise.resolve(params) });
    const ct = res.headers.get("content-type") || "";
    return { status: res.status, body: (ct.includes("json") ? await res.json() : null) as Json | null };
  };
  /** 触发一次定时任务（真实路由：前面是销售行动同步、Muse 提醒、日历观察，后面是未读升级邮件） */
  const cron = async () => {
    const r = new NextRequest("http://localhost/api/cron/sales-actions", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
    const res = await (cronRoute.GET as unknown as Handler)(r, {});
    const body = (await res.json()) as Json;
    return { status: res.status, body, mail: (body.mailWatch ?? {}) as Json };
  };
  const ORG_URL = `/api/organizations/${ORG}/mail-watch-settings`;
  const OPT_URL = `/api/sales/mail-watch/opt-in?orgId=${ORG}`;
  const orgSwitch = (uid: string, enabled: boolean) => call(orgRoute.PUT, uid, ORG_URL, "PUT", { enabled }, { orgId: ORG });
  const optIn = (uid: string, on: boolean) => call(optInRoute.PUT, uid, OPT_URL, "PUT", { optedIn: on });
  const config = async () => readMailWatch((await db.organization.findUnique({ where: { id: ORG }, select: { settingsJson: true } }))?.settingsJson);
  const notes = (userId?: string) =>
    db.notification.findMany({ where: { orgId: ORG, type: "mail_inbound", ...(userId ? { userId } : {}) }, orderBy: { createdAt: "asc" }, select: { userId: true, title: true, summary: true, entityType: true, entityId: true } });
  const inbound = (customerId: string) => db.customerInteraction.findMany({ where: { orgId: ORG, customerId, direction: "inbound" }, orderBy: { createdAt: "asc" } });
  const audits = (action: string, userId?: string) =>
    db.auditLog.findMany({ where: { orgId: ORG, action, ...(userId ? { userId } : {}) }, orderBy: { createdAt: "asc" }, select: { userId: true, targetId: true, afterData: true } });
  const lastRunCounts = async (uid: string) => JSON.parse((await audits("mail.watch.run", uid)).at(-1)?.afterData ?? "{}") as Record<string, number>;
  const automationRun = async () => db.automationRun.findFirst({ where: { automationKey: "mail-watch" }, orderBy: { startedAt: "desc" }, select: { status: true, metadataJson: true } });
  const gmailCalls = () => Object.values(boxes).reduce((n, b) => n + b.calls.length, 0);
  const otherSteps = (body: Json) => ["organizations", "museReminders", "calendarWatch", "notifyEmailEscalation", "syncedAt"].every((k) => k in body);

  // 首次勾选之前收件箱里已经有的旧信（勾选后的第一轮不该补发）
  boxes[LYNN].deliver({ from: "王总 <wang@client.example>", subject: "勾选之前的旧信", body: BODY_MARK });

  try {
    // ════════════════════════════════════════════════════════
    console.log("\n[0] 合并时的状态（MAIL_WATCH_ENABLED 没配）：线上零变化");
    {
      const r = await cron();
      ok(r.status === 200 && otherSteps(r.body), "定时任务 200；其它步骤的结果都在响应里", Object.keys(r.body));
      ok(r.mail.skipped === "platform_disabled" && r.mail.mailboxes === 0, "mail-watch 步骤：跳过，原因是平台开关未开", r.mail);
      const run = await automationRun();
      ok(run?.status === "skipped" && (run.metadataJson as Json | null)?.skipped === "platform_disabled", "运行记录：skipped，写明原因", run);
      const a = await call(orgRoute.GET, LUCAS, ORG_URL, "GET", undefined, { orgId: ORG });
      const b = await call(optInRoute.GET, LYNN, OPT_URL);
      const c = await optIn(LYNN, true);
      ok(a.status === 404 && b.status === 404 && c.status === 404, "组织开关接口与成员勾选接口都是 404", [a.status, b.status, c.status]);
      ok(mailWatchPanelState(null).visible === false, "勾选接口不可用 → 邮箱绑定页不渲染「客户来信提醒」");
      ok(gmailCalls() === 0 && (await notes()).length === 0 && Object.keys((await config()).mailboxes).length === 0, "没有访问 Gmail，没有通知，设置没有被写入");
    }

    process.env.MAIL_WATCH_ENABLED = "true";

    // ════════════════════════════════════════════════════════
    console.log("\n[1] 平台开、组织关：步骤跳过；成员的勾选项可见但不可勾");
    {
      const st = await call(optInRoute.GET, LYNN, OPT_URL);
      const panel = mailWatchPanelState(st.body?.status as never);
      ok(st.status === 200 && panel.visible && panel.checkbox === "disabled_org_off" && !panel.showOrgSwitch, "Lynn：勾选项可见、不可勾，看不到组织开关", st.body);
      const boss = await call(optInRoute.GET, LUCAS, OPT_URL);
      ok(mailWatchPanelState(boss.body?.status as never).showOrgSwitch === true, "老板：看得到组织开关");
      ok((await orgSwitch(LYNN, true)).status === 403, "销售改组织开关 → 403");
      const r = await cron();
      ok(r.mail.skipped === "no_mailboxes" && otherSteps(r.body) && gmailCalls() === 0, "组织开关关：步骤跳过（没有满足条件的邮箱），其它步骤不受影响", r.mail);
    }

    // ════════════════════════════════════════════════════════
    console.log("\n[2] 三道开关全开，Lynn 首次勾选：收件箱里的旧信不补发");
    {
      ok((await orgSwitch(LUCAS, true)).status === 200, "老板打开组织开关");
      const p = await optIn(LYNN, true);
      ok(p.status === 200 && mailWatchPanelState(p.body?.status as never).checked === true, "Lynn 勾选「客户来信提醒」；再读仍为已勾选");
      const r = await cron();
      ok(r.status === 200 && r.mail.skipped === null && r.mail.mailboxes === 1 && r.mail.notified === 0, "第一轮：读了 1 个邮箱，0 条通知", r.mail);
      ok((await notes()).length === 0 && (await inbound(C_WANG)).length === 0, "旧信没有通知、没有互动");
      ok(boxes[LYNN].callsOf("messages.get").length === 0 && (await config()).mailboxes[LYNN].historyId === boxes[LYNN].head, "没有读任何一封旧信，只记了起点");
    }

    // ════════════════════════════════════════════════════════
    console.log("\n[3] 已建档客户给 Lynn 发信");
    let firstMailId = "";
    {
      const mail = boxes[LYNN].deliver({ from: "王总 <Wang@Client.example>", subject: "Re: 客厅百叶窗报价", body: BODY_MARK });
      firstMailId = mail.id;
      const r = await cron();
      const n = await notes();
      ok(r.mail.notified === 1 && n.length === 1 && n[0].userId === LYNN && n[0].title === "客户来信：王总" && n[0].summary === "Re: 客厅百叶窗报价", "Lynn 收到站内通知「客户来信：王总」，正文是主题", n);
      ok(n[0].entityType === "sales_customer" && n[0].entityId === C_WANG, "通知点开到这位客户的详情页");
      ok((await notes()).every((x) => x.userId === LYNN), "其他成员没有通知");
      const it = await inbound(C_WANG);
      ok(it.length === 1 && it[0].type === "email" && it[0].channel === "email" && it[0].summary === "客户来信（邮件）" && it[0].content === "主题：Re: 客厅百叶窗报价" && it[0].createdById === LYNN, "客户时间线多一条入站邮件互动（标题固定，主题在内容里）", it[0]);
      const led = await audits("mail.watch.observed", LYNN);
      const entry = JSON.parse(led[0]?.afterData ?? "{}") as Json;
      ok(led.length === 1 && led[0].targetId === mail.id && entry.sender === "wang@client.example" && entry.customerId === C_WANG && entry.rule === "customer_mail", "账本一条：发件地址、主题、客户、命中规则 1", entry);
      ok(Number(r.mail.wechatSkipped) === 1 && r.mail.wechatSent === 0, "测试环境不外发微信：推送记为跳过（文案见 [11]）", r.mail);

      // 时间线入口读的两份数据：客户详情接口 + 邮件绑定状态接口
      const detail = await call(customerRoute.GET, LYNN, `/api/sales/customers/${C_WANG}?orgId=${ORG}`, "GET", undefined, { id: C_WANG });
      const row = ((detail.body?.interactions ?? (detail.body?.customer as Json | undefined)?.interactions) as Array<Json> | undefined)?.find((x) => x.direction === "inbound");
      ok(detail.status === 200 && !!row, "客户详情接口返回这条互动", detail.status);
      const off = await call(statusRoute.GET, LYNN, "/api/sales/email-status");
      ok(!showReadMailEntry({ assistantOpen: true, mailReadEnabled: (off.body?.mailRead as Json | undefined)?.enabled as boolean | undefined, interaction: row as never }), "读信开关关：时间线不显示「让助手读这封信」");
      process.env.MAIL_READ_ENABLED = "true";
      const on = await call(statusRoute.GET, LYNN, "/api/sales/email-status");
      ok(showReadMailEntry({ assistantOpen: true, mailReadEnabled: (on.body?.mailRead as Json | undefined)?.enabled as boolean | undefined, interaction: row as never }), "读信开关开（且助手页对本人放行）：这条显示「让助手读这封信」");
      const href = decodeURIComponent(readMailHref({ customerName: "王总", receivedAt: mailWatchReceivedAt(row as never) }));
      ok(href === "/assistant?prompt=帮我读一下王总在 11 月 12 日发来的邮件" && !href.includes("百叶窗"), "入口预填：客户名 + 收信日期，没有主题", href);
      delete process.env.MAIL_READ_ENABLED;
    }

    // ════════════════════════════════════════════════════════
    console.log("\n[4] 客户用另一个邮箱地址回复青砚发出的报价邮件（规则 2）");
    {
      const sent = boxes[LYNN].seed({ id: "1afeed0001", from: `${LYNN}@fixture.test`, subject: "客厅百叶窗报价" });
      await db.customerInteraction.create({ data: { orgId: ORG, customerId: C_WANG, type: "email", direction: "outbound", channel: "email", summary: "发送报价邮件", emailMessageId: sent.id, createdById: LYNN, analysisStatus: "completed" } });
      const mail = boxes[LYNN].deliver({ threadId: sent.threadId, from: "王太太 <mrs.wang@personal.example>", subject: "Re: 客厅百叶窗报价（换个邮箱回）", body: BODY_MARK });
      await cron();
      const led = (await audits("mail.watch.observed", LYNN)).find((a) => a.targetId === mail.id);
      ok(!!led && (JSON.parse(led.afterData ?? "{}") as Json).rule === "customer_reply" && (await notes(LYNN)).length === 2 && (await inbound(C_WANG)).length === 2, "按规则 2 命中：第二条通知与互动", led?.afterData);
    }

    // ════════════════════════════════════════════════════════
    console.log("\n[5] 供应商、促销、Lynn 自己发出的信");
    {
      boxes[LYNN].deliver({ from: "sales@fabric-supplier.example", subject: "面料到货通知", body: BODY_MARK });
      boxes[LYNN].deliver({ from: "王总 <wang@client.example>", subject: "年终大促", labels: ["INBOX", "CATEGORY_PROMOTIONS"], body: BODY_MARK });
      boxes[LYNN].deliver({ from: `${LYNN}@fixture.test`, subject: "抄送给自己的报价", labels: ["INBOX", "SENT"], body: BODY_MARK });
      const before = { n: (await notes()).length, i: (await inbound(C_WANG)).length, l: (await audits("mail.watch.observed")).length };
      await cron();
      ok((await notes()).length === before.n && (await inbound(C_WANG)).length === before.i && (await audits("mail.watch.observed")).length === before.l, "无通知、无互动、账本无逐封记录");
      const c = await lastRunCounts(LYNN);
      ok(c.scanned === 3 && c.unmatched === 1 && c.skipped === 2 && c.customerMail === 0, "只在本轮汇总里计数：未匹配 1、跳过 2", c);
    }

    // ════════════════════════════════════════════════════════
    console.log("\n[6] 下一轮 / 同一段重跑：不产生第二条通知或互动");
    {
      const before = { n: (await notes()).length, i: (await inbound(C_WANG)).length, l: (await audits("mail.watch.observed")).length };
      const r1 = await cron();
      ok(r1.mail.scanned === 0 && (await notes()).length === before.n, "下一轮没有新信：0 封、通知不变", r1.mail);
      // 把游标拨回到 [3] 之前，模拟「处理完但游标没写回」之后的重跑
      await mutateOrgSettings(ORG, (fresh) => ({ next: withMailWatch(fresh, withCursor(readMailWatch(fresh), LYNN, "1001", new Date())!), result: null }));
      await cron();
      const c = await lastRunCounts(LYNN);
      ok((await notes()).length === before.n && (await inbound(C_WANG)).length === before.i && (await audits("mail.watch.observed")).length === before.l && c.duplicate === 2, "同一段重跑：通知、互动、账本都不变，汇总记重复 2", c);
    }

    // ════════════════════════════════════════════════════════
    console.log("\n[7] 在途询价的供应商回信：没有 mail_inbound");
    {
      const project = await db.project.create({ data: { name: "Example Tender", orgId: ORG, ownerId: LUCAS }, select: { id: true } });
      const supplier = await db.supplier.create({ data: { orgId: ORG, name: "Example Supplier", createdById: LUCAS } as never, select: { id: true } });
      const inquiry = await db.projectInquiry.create({ data: { projectId: project.id, createdById: LUCAS } as never, select: { id: true } });
      await db.inquiryItem.create({ data: { inquiryId: inquiry.id, supplierId: supplier.id, status: "sent", sentAt: new Date(), contactNotes: "Gmail messageId=1abeef0001 threadId=1abeef0001 · 2026-11-10T15:00:00.000Z", createdById: LUCAS } as never });
      boxes[LYNN].seed({ id: "1abeef0001", from: `${LYNN}@fixture.test`, subject: "询价" });
      const before = (await notes()).length;
      // 发件地址恰好也是一位客户的邮箱：仍然交给既有的询价回信流程
      boxes[LYNN].deliver({ threadId: "1abeef0001", from: "wang@client.example", subject: "Re: 询价", body: BODY_MARK });
      await cron();
      ok((await notes()).length === before && (await lastRunCounts(LYNN)).skipped === 1, "没有 mail_inbound 通知，汇总记为跳过");
    }

    // ════════════════════════════════════════════════════════
    console.log("\n[8] Lynn 取消勾选");
    {
      const off = await optIn(LYNN, false);
      ok(off.status === 200 && !(LYNN in (await config()).mailboxes), "取消勾选：她的游标已删");
      boxes[LYNN].deliver({ from: "wang@client.example", subject: "取消勾选之后的来信", body: BODY_MARK });
      const callsBefore = boxes[LYNN].calls.length;
      const n = (await notes()).length;
      const r = await cron();
      ok(boxes[LYNN].calls.length === callsBefore && (await notes()).length === n && r.mail.skipped === "no_mailboxes", "下一轮不再读她的邮箱（Gmail 调用 0 次），没有通知", r.mail);
    }

    // ════════════════════════════════════════════════════════
    console.log("\n[9] 公共地址：Lucas（收 sales@）、Marty（收 info@）勾选");
    {
      ok((await optIn(LUCAS, true)).status === 200 && (await optIn(MARTY, true)).status === 200, "Lucas、Marty 各自勾选");
      await cron(); // 首轮只记起点
      const n0 = (await notes()).length;
      // 发到 sales@ 的信进 Lucas 的邮箱（收件地址不参与归类）
      const toSales = boxes[LUCAS].deliver({ from: "王总 <wang@client.example>", to: "sales@fixture.test", subject: "想加订两扇窗", body: BODY_MARK });
      // 发到 info@ 的三封进 Marty 的邮箱
      boxes[MARTY].deliver({ from: "赵总 <zhao@client.example>", to: "info@fixture.test", subject: "安装时间确认", body: BODY_MARK });
      boxes[MARTY].deliver({ from: "李总 <li@client.example>", to: "info@fixture.test", subject: "李总的来信", body: BODY_MARK });
      boxes[MARTY].deliver({ from: "新客户 <newlead@unknown.example>", to: "info@fixture.test", subject: "想咨询窗帘", body: BODY_MARK });
      await cron();
      const lucasNotes = await notes(LUCAS);
      ok(lucasNotes.length === 1 && lucasNotes[0].title === "客户来信：王总" && lucasNotes[0].summary === "想加订两扇窗", "sales@：Lucas 收到「客户来信：王总」", lucasNotes);
      ok((await notes(LYNN)).length === 2, "判断点 8 为 A：这位客户的负责销售 Lynn 不收通知（仍是之前的 2 条）");
      const detail = await call(customerRoute.GET, LYNN, `/api/sales/customers/${C_WANG}?orgId=${ORG}`, "GET", undefined, { id: C_WANG });
      const rows = ((detail.body?.interactions ?? (detail.body?.customer as Json | undefined)?.interactions) as Array<Json> | undefined) ?? [];
      ok(rows.some((x) => x.emailMessageId === toSales.id && x.createdById === LUCAS), "但 Lynn 在客户时间线上看得到这条（记录人为 Lucas）");
      const martyNotes = await notes(MARTY);
      ok(martyNotes.length === 1 && martyNotes[0].title === "客户来信：赵总", "info@：Marty 看得到的客户（赵总）→ 收到提醒", martyNotes);
      ok((await inbound(C_LI)).length === 0 && !martyNotes.some((x) => x.title.includes("李总")), "info@：Marty 看不到的客户（李总，Sam 的）→ 不提醒、不写客户");
      const c = await lastRunCounts(MARTY);
      ok(c.customerMail === 1 && c.unmatched === 2, "Marty 这一轮：客户来信 1、未匹配 2（看不到的客户 + 没建档的新客户）", c);
      ok((await notes()).length === n0 + 2, "这一轮总共只多 2 条通知");
    }

    // ════════════════════════════════════════════════════════
    console.log("\n[10] 同一封信同时发给 sales@ 和 Lynn 本人");
    {
      ok((await optIn(LYNN, true)).status === 200, "Lynn 重新勾选");
      await cron(); // Lynn 的首轮只记起点（[8] 里那封取消勾选后的来信不补发）
      const before = { lynn: (await notes(LYNN)).length, lucas: (await notes(LUCAS)).length, i: (await inbound(C_WANG)).length };
      const rfc = "<same-mail-0001@client.example>";
      const a = boxes[LYNN].deliver({ from: "wang@client.example", to: `${LYNN}@fixture.test, sales@fixture.test`, subject: "两边都收到的一封", rfcMessageId: rfc, body: BODY_MARK });
      const b = boxes[LUCAS].deliver({ from: "wang@client.example", to: `${LYNN}@fixture.test, sales@fixture.test`, subject: "两边都收到的一封", rfcMessageId: rfc, body: BODY_MARK });
      await cron();
      ok(a.id !== b.id && (await notes(LYNN)).length === before.lynn + 1 && (await notes(LUCAS)).length === before.lucas + 1, "两个邮箱各有一封（Gmail 邮件 id 不同）：两位邮箱主人各收一条通知");
      ok((await inbound(C_WANG)).length === before.i + 1, "客户时间线只多一条互动（按 Message-ID 合并）");
      ok((await audits("mail.watch.observed")).filter((x) => x.targetId === a.id || x.targetId === b.id).length === 2, "账本两条（每个邮箱各一条）");
      ok((await notes(LYNN)).length === before.lynn + 1 && !(await notes(LYNN)).some((x) => x.summary === "取消勾选之后的来信"), "取消勾选期间的来信没有补发");
    }

    // ════════════════════════════════════════════════════════
    console.log("\n[11] 微信推送的文案（同一个编排函数，注入只记录不发送的推送函数；不经定时任务路由）");
    {
      const pushes: Array<{ userId: string; title: string; content: string }> = [];
      boxes[LYNN].deliver({ from: "王总 <wang@client.example>", subject: "请回电 13800001111 或发 wang@client.example，尾款 5000", body: BODY_MARK });
      const r = await runMailWatch({ orgIds: [ORG], pushWechat: async (userId, title, content) => (pushes.push({ userId, title, content }), { sent: 1, failed: 0 }) });
      ok(r.wechatSent === 1 && pushes.length === 1 && pushes[0].userId === LYNN && pushes[0].title === "客户来信：王总", "推给邮箱主人一条，标题「客户来信：王总」", pushes);
      ok(pushes[0].content.includes("请回电") && !pushes[0].content.includes("wang@client.example") && !pushes[0].content.includes(BODY_MARK), "内容只有主题（其中的邮箱地址打了码），没有正文", pushes[0]?.content);
    }

    // ════════════════════════════════════════════════════════
    console.log("\n[12] 已勾选但授权缺读信权限");
    {
      ok((await optIn(OLD, true)).status === 200, "旧授权成员勾选");
      await cron();
      await cron();
      const reminders = await db.notification.findMany({ where: { orgId: ORG, userId: OLD }, select: { type: true, title: true, summary: true } });
      ok(reminders.length === 1 && reminders[0].type === "system" && JSON.stringify(reminders[0]).includes("重新授权"), "跑两轮：只有一条站内提醒，写明去重新授权", reminders);
      ok(boxes[OLD].calls.length === 0, "没有读这个邮箱");
    }

    // ════════════════════════════════════════════════════════
    console.log("\n[13] 关掉组织开关：全部停下，成员的勾选保留");
    {
      ok((await orgSwitch(LUCAS, false)).status === 200, "老板关掉组织开关");
      const callsBefore = gmailCalls();
      const r = await cron();
      ok(r.mail.skipped === "no_mailboxes" && gmailCalls() === callsBefore && otherSteps(r.body), "步骤跳过并写明原因；没有读任何邮箱；其它步骤照常", r.mail);
      ok(Object.keys((await config()).mailboxes).sort().join() === [LYNN, LUCAS, MARTY, OLD].sort().join(), "成员的勾选都还在");
      ok((await orgSwitch(LUCAS, true)).status === 200, "（恢复为开，留给本地截图）");
    }

    // ════════════════════════════════════════════════════════
    console.log("\n[14] 全程核对");
    {
      const used = new Set(Object.values(boxes).flatMap((b) => b.calls.map((c) => c.api)));
      ok([...used].every((a) => ["getProfile", "history.list", "messages.get", "threads.get"].includes(a)), "Gmail 只用了：取起点、历史增量、邮件元数据、线程成员", [...used]);
      ok(Object.values(boxes).every((b) => b.callsOf("messages.get").every((c) => c.args.format === "metadata") && b.callsOf("threads.get").every((c) => c.args.format === "minimal")), "读邮件只用 metadata，读线程只用 minimal（都不含正文）");
      const dump = JSON.stringify([
        await db.notification.findMany({ where: { orgId: ORG } }),
        await db.customerInteraction.findMany({ where: { orgId: ORG } }),
        await db.auditLog.findMany({ where: { orgId: ORG } }),
        await db.automationRun.findMany({ where: { automationKey: "mail-watch" } }),
        await db.organization.findUnique({ where: { id: ORG } }),
      ]);
      ok(!dump.includes(BODY_MARK), "通知、互动、审计、运行记录、组织设置里都搜不到邮件正文");
      ok((await db.pendingAction.count({ where: { orgId: ORG } })) === 0, "没有建任何待审批动作（不出站）");
      ok((await db.notification.count({ where: { orgId: ORG, type: "mail_inbound", userId: SAM } })) === 0, "没有勾选的成员（Sam）一条都没收到");
      const actions = new Set((await db.auditLog.findMany({ where: { orgId: ORG, action: { startsWith: "mail." } }, select: { action: true } })).map((a) => a.action));
      ok([...actions].every((a) => ["mail.watch.observed", "mail.watch.run", "mail.watch.settings"].includes(a)), "审计动作只有：账本、每轮汇总、组织开关", [...actions]);
    }

    if (process.env.MAIL2_FIXTURE_OUT) {
      writeFileSync(process.env.MAIL2_FIXTURE_OUT, JSON.stringify({ orgId: ORG, customerId: C_WANG, firstMailId, users: { lynn: LYNN, lucas: LUCAS, marty: MARTY, old: OLD, sam: SAM }, tokens }, null, 2));
      console.log(`\n夹具信息已写到 ${process.env.MAIL2_FIXTURE_OUT}`);
    }
  } finally {
    await db.$disconnect();
  }

  console.log(`\n结果: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log(`失败项：\n- ${failed.join("\n- ")}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
