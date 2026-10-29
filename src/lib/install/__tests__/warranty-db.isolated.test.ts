/**
 * INSTALL-2c：完工 + 质保邮件——真实 DB（隔离库）+ 真实路由 + 测试发件通道（不触达真实邮件）
 *
 *   [1] 质保设置：会计读 200 / canEdit false / 种子；会计写 403；非法 400；老板写 200、其他设置键保留、审计
 *   [2] 缺报修电话时确认尾款：确认 200，warranty blocked，无审批，发送 0
 *   [3] 补齐后重新生成：pending_approval + 预览（收件人 = 客户邮箱、无金额）；再点返回同一审批；发送 0
 *   [4] 未配置组织发件身份时批准：失败 NO_ORG_SENDER、发送 0、批准人收到失败通知、列表 failed 可重新生成
 *   [5] 配置发件身份后重新生成并批准：发送 1、审计 install.warranty.sent、审批 executed、销售收到通知、列表 sent；再生成 409 ALREADY_SENT
 *   [6] 第二张单：确认时直接 pending_approval；同一单两条审批先后批准 → 只发一封（第二条 ALREADY_SENT）
 *   [7] 生成后客户邮箱被改 → RECIPIENT_MISMATCH；客户无邮箱 → blocked「客户没有邮箱」
 *   INSTALL-2g：[1] 种子 = Shutters 1 / 15 / 25、报修电话 / 邮箱、抄送 miki@；非法抄送 400；[3] 抄送合并重复、预览与审批带抄送且去掉收件人、
 *   请求体里的 cc / to 被忽略；[5] 发送带抄送、审计记抄送；[6] 确认尾款接口预览带抄送；[8] 抄送为空 → 不带抄送；[9] 审批内容抄送不合法 → INVALID_PAYLOAD
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/install/__tests__/warranty-db.isolated.test.ts
 * 无隔离库时自动跳过。只用虚构数据。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 INSTALL-2c 质保邮件 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "INSTALL-2c warranty DB test" });

process.env.JWT_SECRET = process.env.JWT_SECRET || "install-2c-isolated-test-secret-0123456789abcdef";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : "");
  }
}

type Handler = (r: unknown, c: unknown) => Promise<Response>;
type Json = Record<string, unknown>;

async function main() {
  const { db } = await import("@/lib/db");
  const { NextRequest } = await import("next/server");
  const { createSession } = await import("@/lib/auth/session");
  const { seedOrgAuthorizationProfiles } = await import("@/lib/authorization/seed-org-profiles");
  const { emptySpec, AUDIT_ACTION_SPEC, AUDIT_ACTION_GENERATED, AUDIT_TARGET_ORDER, AUDIT_TARGET_QUOTE } = await import("@/lib/sunny-process/process-spec");
  const { todayInTimeZone } = await import("@/lib/install/balance");
  const { saveOrgEmailSender } = await import("@/lib/trade/email-sender");
  const { requestApproval } = await import("@/lib/approval/request");
  const { __setWarrantySenderForTest } = await import("@/lib/pending-actions/exec-install-warranty-email");
  const settingsRoute = await import("@/app/api/install/warranty-settings/route");
  const listRoute = await import("@/app/api/accounting/balance/route");
  const confirmRoute = await import("@/app/api/accounting/balance/[orderId]/confirm/route");
  const warrantyRoute = await import("@/app/api/accounting/balance/[orderId]/warranty/route");
  const approveRoute = await import("@/app/api/ai/pending-actions/[id]/route");

  const sends: Array<{ to: string; cc: string[]; subject: string; body: string; html: string; fromName: string }> = [];
  let failNext = false;
  __setWarrantySenderForTest(async (input) => {
    if (failNext) {
      failNext = false;
      throw new Error("provider down");
    }
    sends.push({ to: input.to, cc: input.cc, subject: input.subject, body: input.body, html: input.html, fromName: input.sender.fromName });
    return { messageId: `test-msg-${sends.length}`, from: "warranty@fixture.test" };
  });

  const stamp = Date.now().toString(36);
  const BOSS = `i2cboss_${stamp}`;
  const MIKI = `i2cmiki_${stamp}`;
  const ALEX = `i2calex_${stamp}`;
  const ORG = `i2corg_${stamp}`;
  const users = [BOSS, MIKI, ALEX];
  const roleOf: Record<string, string> = { [BOSS]: "user", [MIKI]: "user", [ALEX]: "sales" };
  for (const id of users) {
    await db.user.create({ data: { id, email: `${id}@fixture.test`, name: `Example ${id.split("_")[0]}`, role: roleOf[id] } });
  }
  await db.organization.create({
    data: { id: ORG, name: "Example Warranty Fixture", code: `${ORG}-c`, ownerId: BOSS, industryPackId: "window_covering_services_v1", settingsJson: { timezone: "America/Toronto" } },
  });
  for (const id of users) await db.organizationMember.create({ data: { orgId: ORG, userId: id, role: "org_member", status: "active" } });
  await seedOrgAuthorizationProfiles(ORG);
  const bind = async (userId: string, key: string) => {
    const profile = await db.roleProfile.findUnique({ where: { orgId_key: { orgId: ORG, key } } });
    if (!profile) throw new Error(`缺岗位模板 ${key}`);
    await db.principalRoleBinding.create({ data: { orgId: ORG, principalType: "HUMAN", principalId: userId, roleProfileId: profile.id, status: "active" } });
  };
  await bind(BOSS, "owner");
  await bind(MIKI, "accounting");
  await bind(ALEX, "sales_rep");

  const mkCustomer = (email: string | null, tag: string) =>
    db.salesCustomer.create({ data: { orgId: ORG, name: `Example Homeowner ${tag}`, phone: "416-555-0110", email, address: `${tag} Example Way`, createdById: ALEX } });
  const createdOrders: string[] = [];
  const vinyl = (location: string) => ({ location, width: 30, height: 60, panels: 2, openCode: "LR", posts: "", rail1In: null, rail1Ratio: null, rod: "", split: "", frame: "L", frameCount: 4, inOut: "内装", structure: "有框", rail2In: null, quoteFrame: "L", quoteOpenDirection: "", quoteMidRail: "" });
  const mkOrder = async (code: string, customerId: string) => {
    const order = await db.blindsOrder.create({
      data: { code, status: "installed", installedAt: new Date("2026-10-28T18:00:00Z"), customerName: "Example Homeowner", creatorId: ALEX, customerId },
    });
    createdOrders.push(order.id);
    await db.auditLog.create({ data: { userId: BOSS, orgId: ORG, action: AUDIT_ACTION_SPEC, targetType: AUDIT_TARGET_ORDER, targetId: order.id, afterData: JSON.stringify({ ...emptySpec(), vinyl: [vinyl("Living Room"), vinyl("Kitchen")] }) } });
    const q = await db.salesQuote.create({ data: { orgId: ORG, customerId, status: "signed", signedAt: new Date(), grandTotal: 5200, preTaxTotal: 4600, createdById: ALEX, agreedBalanceAmount: 2600, depositAmount: 2600, shareToken: `tok_${code}` } });
    await db.auditLog.create({ data: { userId: ALEX, orgId: ORG, action: AUDIT_ACTION_GENERATED, targetType: AUDIT_TARGET_QUOTE, targetId: q.id, afterData: JSON.stringify({ orderId: order.id, code }) } });
    return order;
  };

  const session = async (uid: string) => `qy_session=${await createSession({ sub: uid, email: `${uid}@fixture.test`, role: roleOf[uid] })}`;
  const parse = async (res: Response) => {
    const text = await res.text();
    let body: Json | null = null;
    try { body = JSON.parse(text) as Json; } catch { body = null; }
    return { status: res.status, body, text };
  };
  const req = async (handler: Handler, uid: string, url: string, method: string, params: Record<string, string>, body?: Json) => {
    const r = new NextRequest(`http://localhost${url}`, {
      method,
      body: body ? JSON.stringify({ ...body, orgId: ORG }) : undefined,
      headers: { cookie: await session(uid), "content-type": "application/json", "x-forwarded-for": "10.34.0.7" },
    });
    return parse(await handler(r, { params: Promise.resolve(params) }));
  };
  const getSettings = (uid: string) => req(settingsRoute.GET as unknown as Handler, uid, `/api/install/warranty-settings?orgId=${ORG}`, "GET", {});
  const putSettings = (uid: string, settings: unknown) => req(settingsRoute.PUT as unknown as Handler, uid, `/api/install/warranty-settings`, "PUT", {}, { settings });
  const confirm = (orderId: string) => req(confirmRoute.POST as unknown as Handler, MIKI, `/api/accounting/balance/${orderId}/confirm`, "POST", { orderId }, { amount: 2600, method: "visa", receivedAt: todayInTimeZone("America/Toronto") });
  const regen = (orderId: string, extra: Json = {}) => req(warrantyRoute.POST as unknown as Handler, MIKI, `/api/accounting/balance/${orderId}/warranty`, "POST", { orderId }, extra);
  const approve = (uid: string, id: string) => req(approveRoute.POST as unknown as Handler, uid, `/api/ai/pending-actions/${id}`, "POST", { id }, { decision: "approve" });
  const listAs = () => req(listRoute.GET as unknown as Handler, MIKI, `/api/accounting/balance?orgId=${ORG}`, "GET", {});
  const statusOf = async (orderId: string) => {
    const l = await listAs();
    return ((l.body?.recentConfirmed ?? []) as Array<{ orderId: string; warranty: Json | null }>).find((r) => r.orderId === orderId)?.warranty ?? null;
  };
  const warranty = (b: Json | null) => (b?.warranty ?? {}) as { status?: string; approvalId?: string; blockers?: string[]; preview?: { to: string; cc: string[]; subject: string; html: string }; reason?: string; canRegenerate?: boolean };

  try {
    console.log("\n[1] 质保设置");
    const s0 = await getSettings(MIKI);
    const seedSettings = (s0.body?.settings ?? {}) as { terms: Record<string, Array<{ part: string; years: number }>>; contact: Record<string, string>; cc: string[] };
    ok(s0.status === 200 && s0.body?.canEdit === false && s0.body?.saved === false, "会计读取 200、canEdit false、未保存（种子）", s0.body);
    ok(
      seedSettings.terms?.vinyl?.map((t) => `${t.part}:${t.years}`).join() === "labour:1,components:15,frame:25" &&
        seedSettings.contact?.phone === "647-857-8669" &&
        seedSettings.contact?.email === "service@sunnyshutter.ca" &&
        seedSettings.cc?.join() === "miki@sunnyshutter.ca",
      "种子（INSTALL-2g）：Shutters 1 / 15 / 25、电话 647-857-8669、邮箱 service@sunnyshutter.ca、抄送 miki@sunnyshutter.ca",
      seedSettings,
    );
    ok((await putSettings(MIKI, seedSettings)).status === 403, "会计保存 → 403");
    const bad = await putSettings(BOSS, { ...seedSettings, terms: { ...seedSettings.terms, vinyl: [{ part: "components", years: 99 }] } });
    ok(bad.status === 400, "Shutters 部件 99 年 → 400", bad.body);
    const badCc1 = await putSettings(BOSS, { ...seedSettings, cc: "not-an-email" });
    const badCc2 = await putSettings(BOSS, { ...seedSettings, cc: ["a@fixture.test", "b@fixture.test", "c@fixture.test", "d@fixture.test", "e@fixture.test", "f@fixture.test"] });
    ok(badCc1.status === 400 && badCc2.status === 400 && (await getSettings(MIKI)).body?.saved === false, "非法抄送 / 6 个抄送 → 400，设置不变", [badCc1.body, badCc2.body]);

    console.log("\n[2] 缺报修电话时确认尾款");
    // 种子已带电话 / 邮箱（INSTALL-2g），这里由老板清空来复现"缺联系方式"
    ok((await putSettings(BOSS, { ...seedSettings, contact: { ...seedSettings.contact, phone: "", email: "" } })).status === 200, "老板清空报修电话 / 邮箱");
    const cust1 = await mkCustomer("homeowner1@fixture.test", "1");
    const o1 = await mkOrder(`I2C-1-${stamp}`, cust1.id);
    const c1 = await confirm(o1.id);
    const w1 = warranty(c1.body);
    ok(c1.status === 200 && (c1.body?.record as Json)?.received === 2600, "尾款确认 200", c1.body);
    ok(w1.status === "blocked" && (w1.blockers ?? []).includes("缺报修电话") && (w1.blockers ?? []).includes("缺报修邮箱"), "warranty blocked：缺报修电话 / 缺报修邮箱", w1);
    ok((await db.pendingAction.count({ where: { orgId: ORG, type: "install.send_warranty_email" } })) === 0 && sends.length === 0, "无审批、发送 0");

    console.log("\n[3] 补齐后重新生成");
    const okPut = await putSettings(BOSS, { ...seedSettings, contact: { ...seedSettings.contact, phone: "647-555-0100", email: "service@fixture.test" } });
    const orgRow = await db.organization.findUnique({ where: { id: ORG }, select: { settingsJson: true } });
    ok(okPut.status === 200 && (orgRow?.settingsJson as Json)?.timezone === "America/Toronto", "老板保存 200，其他设置键保留", okPut.body);
    ok((await db.auditLog.count({ where: { orgId: ORG, action: "install.warranty.settings" } })) === 2, "设置保存审计：清空一次 + 补齐一次 = 2 条");
    const ccPut = await putSettings(BOSS, { ...seedSettings, contact: { ...seedSettings.contact, phone: "647-555-0100", email: "service@fixture.test" }, cc: "Miki@Fixture.test, miki@fixture.test, office@fixture.test" });
    const ccRead = (await getSettings(MIKI)).body?.settings as { cc?: string[] } | undefined;
    ok(ccPut.status === 200 && ccRead?.cc?.join() === "miki@fixture.test,office@fixture.test", "老板设置抄送：大小写 / 重复合并为 miki@、office@ 两个", ccRead?.cc);
    ok((await putSettings(BOSS, { ...seedSettings, contact: { ...seedSettings.contact, phone: "647-555-0100", email: "service@fixture.test" }, cc: ["miki@fixture.test", "homeowner1@fixture.test"] })).status === 200, "抄送设为 miki@ + 客户本人邮箱");
    const r1 = await regen(o1.id, { cc: ["someone@example.com"], to: "someone@example.com" });
    const w1b = warranty(r1.body);
    ok(r1.status === 200 && w1b.status === "pending_approval" && !!w1b.approvalId, "重新生成 → pending_approval + 审批 id", r1.body);
    ok(w1b.preview?.to === "homeowner1@fixture.test" && w1b.preview.subject === `Your Sunny Shutter installation is complete — Warranty W-I2C-1-${stamp} (Order I2C-1-${stamp})`, "预览：收件人 = 客户邮箱、主题格式", w1b.preview?.subject);
    ok(w1b.preview?.cc?.join() === "miki@fixture.test", "预览抄送只有 miki@（去掉与收件人相同的客户邮箱）", w1b.preview?.cc);
    ok(
      !/2600|5200|\$|CAD/.test(`${w1b.preview?.subject}${w1b.preview?.html}`) &&
        /Components 15 yr \(until 2041-10-28\)/.test(w1b.preview?.html ?? "") &&
        /Frame &amp; Panels 25 yr \(until 2051-10-28\)/.test(w1b.preview?.html ?? ""),
      "预览无金额、含 Shutters 部件到 2041-10-28、框架与叶片到 2051-10-28",
    );
    const action1 = await db.pendingAction.findUnique({ where: { id: w1b.approvalId! }, select: { approverUserId: true, status: true, type: true, payload: true, preview: true } });
    ok(action1?.approverUserId === MIKI && action1.status === "pending" && action1.type === "install.send_warranty_email", "审批人 = 确认尾款的会计，状态 pending");
    const p1 = (action1?.payload ?? {}) as { to?: string; cc?: string[] };
    ok(
      p1.to === "homeowner1@fixture.test" && p1.cc?.join() === "miki@fixture.test" && !JSON.stringify(action1?.payload ?? {}).includes("someone@example.com"),
      "审批内容：收件人 = 客户档案邮箱、抄送 = 设置里的 miki@；请求体里的 cc / to 被忽略",
      p1,
    );
    ok(String(action1?.preview ?? "").includes("抄送 miki@fixture.test"), "审批预览文字带抄送", action1?.preview);
    const r1b = await regen(o1.id);
    ok(warranty(r1b.body).approvalId === w1b.approvalId && sends.length === 0, "再点生成 → 同一审批；发送仍为 0");

    console.log("\n[4] 未配置组织发件身份时批准");
    const a1 = await approve(MIKI, w1b.approvalId!);
    const act1 = await db.pendingAction.findUnique({ where: { id: w1b.approvalId! }, select: { status: true, failureReason: true } });
    ok(a1.status === 400 && act1?.status === "failed" && /NO_ORG_SENDER/.test(act1.failureReason ?? "") && sends.length === 0, "失败 NO_ORG_SENDER，发送 0", { body: a1.body, act1 });
    const failNote = await db.notification.findFirst({ where: { userId: MIKI, type: "install_warranty_failed" } });
    ok(!!failNote && failNote.entityType === "install_balance" && failNote.entityId === o1.id, "批准人收到失败通知（落会计页签）", failNote);
    const st1 = await statusOf(o1.id);
    ok(st1?.status === "failed" && st1.canRegenerate === true, "列表：failed、可重新生成", st1);

    console.log("\n[5] 配置发件身份后发送");
    await saveOrgEmailSender(ORG, { fromName: "Sunny Shutter Inc", fromEmail: null, replyTo: "service@fixture.test", bcc: [] }, BOSS);
    const r2 = await regen(o1.id);
    const w2 = warranty(r2.body);
    ok(r2.status === 200 && w2.status === "pending_approval" && w2.approvalId !== w1b.approvalId, "重新生成新审批（第 2 次尝试）", r2.body);
    const a2 = await approve(MIKI, w2.approvalId!);
    const act2 = await db.pendingAction.findUnique({ where: { id: w2.approvalId! }, select: { status: true } });
    ok(a2.status === 200 && act2?.status === "executed" && sends.length === 1, "批准 → 已执行、发送 1 次", { body: a2.body, act2 });
    ok(sends[0]?.to === "homeowner1@fixture.test" && sends[0].fromName === "Sunny Shutter Inc" && sends[0].body.includes("W-I2C-1-"), "以组织发件身份发给客户邮箱");
    ok(sends[0]?.cc?.join() === "miki@fixture.test", "发送带抄送 miki@", sends[0]?.cc);
    const sentAudit = await db.auditLog.findMany({ where: { action: "install.warranty.sent", targetId: o1.id } });
    const sentAfter = JSON.parse(sentAudit[0]?.afterData ?? "{}") as { messageId?: string; cc?: string[] };
    ok(sentAudit.length === 1 && sentAfter.messageId === "test-msg-1" && sentAfter.cc?.join() === "miki@fixture.test", "审计 install.warranty.sent 一条（含消息 id、抄送）", sentAfter);
    const sentNote = await db.notification.findFirst({ where: { userId: ALEX, type: "install_warranty_sent" } });
    ok(!!sentNote && sentNote.entityType === "blinds_order" && !/\d{3,}\.\d|2600|\$/.test(`${sentNote.title}${sentNote.summary}`), "销售收到「质保邮件已发出」（无金额）", sentNote);
    const st2 = await statusOf(o1.id);
    ok(st2?.status === "sent" && !!st2.sentAt && st2.canRegenerate === false, "列表：sent、不可再生成", st2);
    const r3 = await regen(o1.id);
    ok(r3.status === 409 && r3.body?.code === "ALREADY_SENT", "已发送后生成 → 409 ALREADY_SENT", r3.body);

    console.log("\n[6] 第二张单：确认即待批准；两条审批只发一封");
    const cust2 = await mkCustomer("homeowner2@fixture.test", "2");
    const o2 = await mkOrder(`I2C-2-${stamp}`, cust2.id);
    const c2 = await confirm(o2.id);
    const w3 = warranty(c2.body);
    ok(c2.status === 200 && w3.status === "pending_approval" && !!w3.approvalId && w3.preview?.to === "homeowner2@fixture.test", "确认尾款 → 直接 pending_approval + 预览", c2.body);
    ok(w3.preview?.cc?.join() === "miki@fixture.test,homeowner1@fixture.test", "确认尾款接口的预览同样带设置里的抄送（INSTALL-2g）", w3.preview?.cc);
    const firstPayload = await db.pendingAction.findUnique({ where: { id: w3.approvalId! }, select: { payload: true } });
    const dup = await requestApproval({
      orgId: ORG,
      principal: { userId: MIKI, actorType: "user" },
      actionType: "install.send_warranty_email",
      title: "dup",
      preview: "dup",
      payload: firstPayload!.payload as Record<string, unknown>,
      risk: { vocabulary: "agent-core.tool-risk", value: "l3_strong", requiresApproval: true },
      source: { module: "install.warranty.test", toolName: "install_send_warranty_email" },
      approver: { approverUserId: MIKI },
      idempotencyKey: `install-warranty:${o2.id}:9`,
    });
    ok(dup.ok, "构造同一单的第二条审批");
    const before = sends.length;
    const a3 = await approve(MIKI, w3.approvalId!);
    const a4 = await approve(MIKI, dup.ok ? dup.actionIds[0] : "");
    const dupRow = await db.pendingAction.findUnique({ where: { id: dup.ok ? dup.actionIds[0] : "" }, select: { status: true, failureReason: true } });
    ok(a3.status === 200 && a4.status === 400 && sends.length === before + 1 && /ALREADY_SENT/.test(dupRow?.failureReason ?? ""), "先后批准：只发一封，第二条 ALREADY_SENT", { a4: a4.body, dupRow });

    console.log("\n[7] 收件人变化 / 客户无邮箱");
    const cust3 = await mkCustomer("homeowner3@fixture.test", "3");
    const o3 = await mkOrder(`I2C-3-${stamp}`, cust3.id);
    const w5 = warranty((await confirm(o3.id)).body);
    await db.salesCustomer.update({ where: { id: cust3.id }, data: { email: "changed@fixture.test" } });
    const before3 = sends.length;
    const a5 = await approve(MIKI, w5.approvalId!);
    const act5 = await db.pendingAction.findUnique({ where: { id: w5.approvalId! }, select: { failureReason: true } });
    ok(a5.status === 400 && /RECIPIENT_MISMATCH/.test(act5?.failureReason ?? "") && sends.length === before3, "客户邮箱已改 → RECIPIENT_MISMATCH，不发送", act5);
    failNext = true;
    const w5b = warranty((await regen(o3.id)).body);
    const a5b = await approve(MIKI, w5b.approvalId!);
    const act5b = await db.pendingAction.findUnique({ where: { id: w5b.approvalId! }, select: { failureReason: true } });
    const failNotes3 = await db.notification.count({ where: { userId: MIKI, type: "install_warranty_failed", entityId: o3.id } });
    ok(
      a5b.status === 400 && /SEND_FAILED/.test(act5b?.failureReason ?? "") && failNotes3 === 2 && sends.length === before3,
      "同一单第二次失败（SEND_FAILED）→ 批准人再收到一条失败通知（共 2 条）、不发送",
      { act5b, failNotes3 },
    );
    const cust4 = await mkCustomer(null, "4");
    const o4 = await mkOrder(`I2C-4-${stamp}`, cust4.id);
    const w6 = warranty((await confirm(o4.id)).body);
    ok(w6.status === "blocked" && (w6.blockers ?? []).includes("客户没有邮箱"), "客户无邮箱 → blocked「客户没有邮箱」", w6);
    ok(sends.every((m) => !/2600|5200|\$|CAD/.test(`${m.subject}${m.body}${m.html}`)), "所有已发邮件无金额");

    console.log("\n[8] 抄送为空 → 不带抄送（INSTALL-2g）");
    ok((await putSettings(BOSS, { ...seedSettings, contact: { ...seedSettings.contact, phone: "647-555-0100", email: "service@fixture.test" }, cc: "" })).status === 200, "老板清空抄送");
    const cust5 = await mkCustomer("homeowner5@fixture.test", "5");
    const o5 = await mkOrder(`I2C-5-${stamp}`, cust5.id);
    const w8 = warranty((await confirm(o5.id)).body);
    const before8 = sends.length;
    const a8 = await approve(MIKI, w8.approvalId!);
    ok(w8.preview?.cc?.length === 0 && a8.status === 200 && sends.length === before8 + 1 && sends[sends.length - 1].cc.length === 0, "预览无抄送、发送一次、不带抄送", { preview: w8.preview?.cc, a8: a8.body });

    console.log("\n[9] 审批内容里的抄送不合法 → INVALID_PAYLOAD，不发送（INSTALL-2g）");
    const cust6 = await mkCustomer("homeowner6@fixture.test", "6");
    const o6 = await mkOrder(`I2C-6-${stamp}`, cust6.id);
    const w9 = warranty((await confirm(o6.id)).body);
    const p9 = await db.pendingAction.findUnique({ where: { id: w9.approvalId! }, select: { payload: true } });
    const bad9 = await requestApproval({
      orgId: ORG,
      principal: { userId: MIKI, actorType: "user" },
      actionType: "install.send_warranty_email",
      title: "bad cc",
      preview: "bad cc",
      payload: { ...(p9!.payload as Record<string, unknown>), cc: ["not-an-email"] },
      risk: { vocabulary: "agent-core.tool-risk", value: "l3_strong", requiresApproval: true },
      source: { module: "install.warranty.test", toolName: "install_send_warranty_email" },
      approver: { approverUserId: MIKI },
      idempotencyKey: `install-warranty:${o6.id}:9`,
    });
    const before9 = sends.length;
    const a9 = await approve(MIKI, bad9.ok ? bad9.actionIds[0] : "");
    const row9 = await db.pendingAction.findUnique({ where: { id: bad9.ok ? bad9.actionIds[0] : "" }, select: { status: true, failureReason: true } });
    ok(bad9.ok && a9.status === 400 && row9?.status === "failed" && /INVALID_PAYLOAD/.test(row9.failureReason ?? "") && sends.length === before9, "抄送格式不对 → 失败 INVALID_PAYLOAD、发送 0", row9);
  } finally {
    __setWarrantySenderForTest(null);
    await db.notification.deleteMany({ where: { userId: { in: users } } });
    await db.pendingAction.deleteMany({ where: { orgId: ORG } }).catch((e) => console.warn("pendingAction cleanup:", e instanceof Error ? e.message : e));
    await db.orgBusinessRule.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.orderStatusLog.deleteMany({ where: { orderId: { in: createdOrders } } });
    await db.blindsOrder.deleteMany({ where: { id: { in: createdOrders } } });
    await db.salesQuote.deleteMany({ where: { orgId: ORG } });
    await db.salesCustomer.deleteMany({ where: { orgId: ORG } });
    await db.auditLog.deleteMany({ where: { OR: [{ userId: { in: users } }, { orgId: ORG }] } });
    await db.principalRoleBinding.deleteMany({ where: { orgId: ORG } });
    await db.roleProfile.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.organizationMember.deleteMany({ where: { orgId: ORG } });
    await db.organization.deleteMany({ where: { id: ORG } }).catch((e) => console.warn("org cleanup:", e instanceof Error ? e.message : e));
    await db.user.deleteMany({ where: { id: { in: users } } }).catch((e) => console.warn("user cleanup:", e instanceof Error ? e.message : e));
    await db.$disconnect();
  }

  console.log(`\n结果: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
