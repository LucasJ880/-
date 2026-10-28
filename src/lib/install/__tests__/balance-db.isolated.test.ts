/**
 * INSTALL-2b：装完待收尾款——真实 DB（隔离库）+ 真实路由端到端
 *
 *   [1] 收口 → 会计 / 老板（持 install.balance.confirm）收到 install_completed（落会计页签），销售收到（落工艺单）；重复收口不重复通知
 *   [2] 列表：销售 403；会计 200，pending 只含本企业已安装 / 已完成未确认的单，应收口径正确，手工单应收为空；不出敏感字段
 *   [3] 确认校验：销售 403、他企业 404、未安装 409、非法 400、差额无说明 400 NOTE_REQUIRED
 *   [4] 确认：200 → completed + 状态日志操作人为会计 + 审计一条；销售收到 install_balance_confirmed（无金额）；重复 → idempotent；并发 → 一条
 *   [5] 已 completed 未确认的单：确认后状态不变、不加状态日志
 *   [6] 列表移到 recentConfirmed；销售首页"待收尾款"剔除已确认
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/install/__tests__/balance-db.isolated.test.ts
 * 无隔离库时自动跳过。只用虚构数据。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 INSTALL-2b 尾款确认 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "INSTALL-2b balance DB test" });

process.env.JWT_SECRET = process.env.JWT_SECRET || "install-2b-isolated-test-secret-0123456789abcdef";
const BLOB_DIR = mkdtempSync(path.join(tmpdir(), "install-2b-blobs-"));
process.env.PRODUCT_CONTENT_LOCAL_STORE = "1";
process.env.PRODUCT_CONTENT_LOCAL_STORE_DIR = BLOB_DIR;

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

type Handler = (r: unknown, c: unknown) => Promise<Response>;
type Json = Record<string, unknown>;

async function main() {
  const { db } = await import("@/lib/db");
  const { NextRequest } = await import("next/server");
  const { createSession } = await import("@/lib/auth/session");
  const { seedOrgAuthorizationProfiles } = await import("@/lib/authorization/seed-org-profiles");
  const { emptySpec, AUDIT_ACTION_SPEC, AUDIT_ACTION_GENERATED, AUDIT_TARGET_ORDER, AUDIT_TARGET_QUOTE } = await import("@/lib/sunny-process/process-spec");
  const { todayInTimeZone } = await import("@/lib/install/balance");
  const { buildSalesHome } = await import("@/lib/sales/home/build-home");
  const listRoute = await import("@/app/api/accounting/balance/route");
  const confirmRoute = await import("@/app/api/accounting/balance/[orderId]/confirm/route");
  const photoRoute = await import("@/app/api/install/tasks/[id]/items/[itemId]/photo/route");
  const completeRoute = await import("@/app/api/install/tasks/[id]/complete/route");

  const stamp = Date.now().toString(36);
  const BOSS = `i2bboss_${stamp}`;
  const MIKI = `i2bmiki_${stamp}`;
  const ALEX = `i2balex_${stamp}`;
  const XW = `i2bxw_${stamp}`;
  const OTHER = `i2bother_${stamp}`;
  const ORG = `i2borg_${stamp}`;
  const ORG2 = `i2borg2_${stamp}`;
  const users = [BOSS, MIKI, ALEX, XW, OTHER];
  const roleOf: Record<string, string> = { [BOSS]: "user", [MIKI]: "user", [ALEX]: "sales", [XW]: "user", [OTHER]: "user" };
  for (const id of users) {
    await db.user.create({ data: { id, email: `${id}@fixture.test`, name: `Example ${id.split("_")[0]}`, role: roleOf[id] } });
  }
  for (const [org, owner, members] of [[ORG, BOSS, [BOSS, MIKI, ALEX, XW]], [ORG2, OTHER, [OTHER]]] as Array<[string, string, string[]]>) {
    await db.organization.create({ data: { id: org, name: `Example Balance Fixture ${org}`, code: `${org}-c`, ownerId: owner, industryPackId: "window_covering_services_v1" } });
    for (const id of members) await db.organizationMember.create({ data: { orgId: org, userId: id, role: "org_member", status: "active" } });
    await seedOrgAuthorizationProfiles(org);
  }
  const bind = async (org: string, userId: string, key: string) => {
    const profile = await db.roleProfile.findUnique({ where: { orgId_key: { orgId: org, key } } });
    if (!profile) throw new Error(`缺岗位模板 ${key}`);
    await db.principalRoleBinding.create({ data: { orgId: org, principalType: "HUMAN", principalId: userId, roleProfileId: profile.id, status: "active" } });
  };
  await bind(ORG, BOSS, "owner");
  await bind(ORG, MIKI, "accounting");
  await bind(ORG, ALEX, "sales_rep");
  await bind(ORG, XW, "installer");
  await bind(ORG2, OTHER, "accounting");

  const cust = await db.salesCustomer.create({ data: { orgId: ORG, name: "Example Homeowner", phone: "416-555-0103", email: "homeowner@fixture.test", address: "4 Example Ln", createdById: ALEX } });
  const cust2 = await db.salesCustomer.create({ data: { orgId: ORG2, name: "Other Org Homeowner", phone: "416-555-0104", email: "other@fixture.test", address: "5 Example Ln", createdById: OTHER } });
  const now = new Date();
  const quote = async (grandTotal: number, agreedBalanceAmount: number | null, depositAmount: number | null, tag: string) =>
    db.salesQuote.create({
      data: {
        orgId: ORG, customerId: cust.id, status: "signed", signedAt: now, grandTotal, preTaxTotal: grandTotal / 1.13, createdById: ALEX,
        agreedBalanceAmount, depositAmount, shareToken: `tok_${tag}_${stamp}`, notes: "internal note fixture",
      },
    });
  const q1 = await quote(3000, 1000, 2000, "q1");
  const q2 = await quote(3000, 1000, 2000, "q2");

  const createdOrders: string[] = [];
  const createdAppts: string[] = [];
  const start = new Date(Date.now() - 3600_000);
  const makeOrder = async (code: string, status: string, opts: { customerId?: string; withTask?: boolean; quoteId?: string; creatorId?: string } = {}) => {
    let appointmentId: string | null = null;
    if (opts.withTask) {
      const appt = await db.appointment.create({
        data: { customerId: opts.customerId ?? cust.id, type: "install", title: `安装 — Example (${code})`, startAt: start, endAt: new Date(start.getTime() + 7200_000), status: "in_progress", assignedToId: XW, createdById: BOSS },
      });
      appointmentId = appt.id;
      createdAppts.push(appt.id);
    }
    const order = await db.blindsOrder.create({
      data: {
        code, status, customerName: "Example Homeowner", creatorId: opts.creatorId ?? ALEX, customerId: opts.customerId ?? cust.id, appointmentId,
        installedAt: status === "installed" || status === "completed" ? new Date() : null,
      },
    });
    createdOrders.push(order.id);
    if (opts.quoteId) {
      await db.auditLog.create({
        data: { userId: ALEX, orgId: ORG, action: AUDIT_ACTION_GENERATED, targetType: AUDIT_TARGET_QUOTE, targetId: opts.quoteId, afterData: JSON.stringify({ orderId: order.id, code }) },
      });
    }
    return order;
  };

  const session = async (uid: string) => `qy_session=${await createSession({ sub: uid, email: `${uid}@fixture.test`, role: roleOf[uid] })}`;
  const parse = async (res: Response) => {
    const text = await res.text();
    let body: Json | null = null;
    try { body = JSON.parse(text) as Json; } catch { body = null; }
    return { status: res.status, body, text };
  };
  const listAs = async (uid: string, org = ORG) => {
    const r = new NextRequest(`http://localhost/api/accounting/balance?orgId=${org}`, { headers: { cookie: await session(uid), "x-forwarded-for": "10.33.0.7" } });
    return parse(await (listRoute.GET as unknown as Handler)(r, { params: Promise.resolve({}) }));
  };
  const confirmAs = async (uid: string, orderId: string, body: Json, org = ORG) => {
    const r = new NextRequest(`http://localhost/api/accounting/balance/${orderId}/confirm`, {
      method: "POST", body: JSON.stringify({ ...body, orgId: org }), headers: { cookie: await session(uid), "content-type": "application/json", "x-forwarded-for": "10.33.0.7" },
    });
    return parse(await (confirmRoute.POST as unknown as Handler)(r, { params: Promise.resolve({ orderId }) }));
  };
  const postAs = async (handler: Handler, uid: string, url: string, params: Record<string, string>, body?: FormData) => {
    const r = new NextRequest(`http://localhost${url}`, { method: "POST", body, headers: { cookie: await session(uid), "x-forwarded-for": "10.33.0.7" } });
    return parse(await handler(r, { params: Promise.resolve(params) }));
  };
  const notes = (uid: string, type: string) => db.notification.findMany({ where: { userId: uid, type }, orderBy: { createdAt: "asc" } });
  const today = todayInTimeZone("America/Toronto");

  try {
    console.log("\n[1] 收口 → 完工通知");
    const o1 = await makeOrder(`I2B-1-${stamp}`, "scheduled", { withTask: true, quoteId: q1.id });
    await db.auditLog.create({
      data: { userId: BOSS, orgId: ORG, action: AUDIT_ACTION_SPEC, targetType: AUDIT_TARGET_ORDER, targetId: o1.id, afterData: JSON.stringify({ ...emptySpec(), vinyl: [{ location: "Living", width: 30, height: 60, panels: 2, openCode: "LR", posts: "", rail1In: null, rail1Ratio: null, rod: "", split: "", frame: "L", frameCount: 4, inOut: "内装", structure: "有框", rail2In: null, quoteFrame: "L", quoteOpenDirection: "", quoteMidRail: "" }] }) },
    });
    const fd = new FormData();
    fd.append("file", new File([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2])], "w.jpg", { type: "image/jpeg" }));
    const up = await postAs(photoRoute.POST as unknown as Handler, XW, `/api/install/tasks/${o1.appointmentId}/items/spec-vinyl-0/photo`, { id: o1.appointmentId!, itemId: "spec-vinyl-0" }, fd);
    ok(up.status === 200, "安装工上传 Vinyl 窗照片", up.body);
    const c1 = await postAs(completeRoute.POST as unknown as Handler, XW, `/api/install/tasks/${o1.appointmentId}/complete`, { id: o1.appointmentId! });
    ok(c1.status === 200 && !c1.body?.idempotent, "完成收口 200", c1.body);
    const nMiki = await notes(MIKI, "install_completed");
    const nBoss = await notes(BOSS, "install_completed");
    const nAlex = await notes(ALEX, "install_completed");
    ok(nMiki.length === 1 && nMiki[0].entityType === "install_balance" && nMiki[0].entityId === o1.id, "会计收到 install_completed（实体 install_balance → 会计页签）", nMiki);
    ok(nBoss.length === 1 && nBoss[0].entityType === "install_balance", "老板（持 install.balance.confirm）也收到", nBoss.length);
    ok(nAlex.length === 1 && nAlex[0].entityType === "blinds_order" && nAlex[0].entityId === o1.id, "销售收到 install_completed（实体 blinds_order → 工艺单详情）", nAlex);
    ok((await notes(XW, "install_completed")).length === 0, "安装工不收到");
    ok([...nMiki, ...nAlex].every((n) => !/\$|\d{3,}\.\d|1000|3000/.test(`${n.title}${n.summary ?? ""}`)), "通知标题与摘要不含金额", [nMiki[0]?.title, nAlex[0]?.summary]);
    const c1b = await postAs(completeRoute.POST as unknown as Handler, XW, `/api/install/tasks/${o1.appointmentId}/complete`, { id: o1.appointmentId! });
    ok(c1b.status === 200 && c1b.body?.idempotent === true && (await notes(MIKI, "install_completed")).length === 1 && (await notes(ALEX, "install_completed")).length === 1, "重复收口幂等，不重复通知");

    console.log("\n[2] 列表");
    const oPending = await makeOrder(`I2B-2-${stamp}`, "scheduled");
    const oManual = await makeOrder(`I2B-3-${stamp}`, "installed", { creatorId: BOSS });
    const oDone = await makeOrder(`I2B-4-${stamp}`, "completed");
    const oOther = await makeOrder(`I2B-5-${stamp}`, "installed", { customerId: cust2.id, creatorId: OTHER });
    const l403 = await listAs(ALEX);
    ok(l403.status === 403, "销售请求列表 → 403", l403.status);
    const l = await listAs(MIKI);
    const pending = (l.body?.pending ?? []) as Array<Record<string, unknown>>;
    const ids = pending.map((p) => p.orderId);
    const row1 = pending.find((p) => p.orderId === o1.id) as { expectedBalance: number; quoteId: string; closeout: { total: number; completed: number }; salesName: string } | undefined;
    ok(l.status === 200 && ids.includes(o1.id) && ids.includes(oManual.id) && ids.includes(oDone.id), "会计 200：已安装 / 已完成未确认的单都在 pending", ids);
    ok(!ids.includes(oPending.id) && !ids.includes(oOther.id), "排期中的单与他企业的单不在 pending");
    ok(row1?.expectedBalance === 1000 && row1.quoteId === q1.id && row1.closeout.total === 1 && row1.closeout.completed === 1 && row1.salesName === `Example i2balex`, "应收 = 约定尾款 1000，关联报价，收口 1/1，销售姓名", row1);
    ok((pending.find((p) => p.orderId === oManual.id) as { expectedBalance: unknown })?.expectedBalance === null, "手工单应收为空");
    ok(!/costPrice|margin|commission|"phone"|"email"|formDataJson|internal note fixture/.test(l.text), "列表不含成本 / 毛利 / 提成 / 联系方式 / 报价备注");
    const lOther = await listAs(OTHER, ORG2);
    ok(lOther.status === 200 && ((lOther.body?.pending ?? []) as Array<{ orderId: string }>).every((p) => p.orderId !== o1.id), "他企业会计看不到本企业的单");

    console.log("\n[3] 确认校验");
    const base = { amount: 1000, method: "visa", receivedAt: today, note: "" };
    ok((await confirmAs(ALEX, o1.id, base)).status === 403, "销售确认 → 403");
    ok((await confirmAs(MIKI, oOther.id, base)).status === 404, "他企业的单 → 404");
    const r409 = await confirmAs(MIKI, oPending.id, base);
    ok(r409.status === 409 && r409.body?.code === "NOT_INSTALLED", "排期中的单 → 409 NOT_INSTALLED", r409.body);
    for (const [bad, name] of [[{ ...base, amount: 0 }, "金额 0"], [{ ...base, method: "mastercard" }, "方式 mastercard"], [{ ...base, receivedAt: "2099-01-01" }, "收款日期在明天之后"]] as Array<[Json, string]>) {
      const r = await confirmAs(MIKI, o1.id, bad);
      ok(r.status === 400, `${name} → 400`, r.body);
    }
    const rNote = await confirmAs(MIKI, o1.id, { ...base, amount: 900 });
    ok(rNote.status === 400 && rNote.body?.code === "NOTE_REQUIRED", "少收 100 无说明 → 400 NOTE_REQUIRED", rNote.body);
    ok((await db.blindsOrder.findUnique({ where: { id: o1.id } }))?.status === "installed" && (await db.auditLog.count({ where: { action: "install.balance.confirmed", targetId: o1.id } })) === 0, "以上都不改状态、不写审计");

    console.log("\n[4] 确认");
    const ok1 = await confirmAs(MIKI, o1.id, base);
    const order1 = await db.blindsOrder.findUnique({ where: { id: o1.id } });
    const log1 = await db.orderStatusLog.findMany({ where: { orderId: o1.id, toStatus: "completed" } });
    ok(ok1.status === 200 && ok1.body?.idempotent === false && order1?.status === "completed" && !!order1.completedAt, "会计确认 → 200，工艺单 completed", ok1.body);
    ok(log1.length === 1 && log1[0].operatorId === MIKI && log1[0].note === "尾款确认", "状态日志：操作人为会计（无品类键），备注\"尾款确认\"", log1);
    const audits = await db.auditLog.findMany({ where: { action: "install.balance.confirmed", targetId: o1.id } });
    const ad = JSON.parse(audits[0]?.afterData ?? "{}") as Json;
    ok(audits.length === 1 && ad.quoteId === q1.id && ad.expected === 1000 && ad.received === 1000 && ad.method === "visa" && audits[0].orgId === ORG, "审计一条：关联报价、应收、实收、方式", ad);
    const nConf = await notes(ALEX, "install_balance_confirmed");
    ok(nConf.length === 1 && nConf[0].entityType === "blinds_order" && !/\d{3,}/.test(`${nConf[0].title}${nConf[0].summary ?? ""}`.replace(/I2B-\d-\w+/g, "")), "销售收到 install_balance_confirmed，无金额", nConf);
    const again = await confirmAs(MIKI, o1.id, { ...base, amount: 1 });
    ok(again.status === 200 && again.body?.idempotent === true && (again.body?.record as Json)?.received === 1000, "重复确认 → idempotent，返回首次记录");
    ok((await db.auditLog.count({ where: { action: "install.balance.confirmed", targetId: o1.id } })) === 1 && (await db.orderStatusLog.count({ where: { orderId: o1.id, toStatus: "completed" } })) === 1 && (await notes(ALEX, "install_balance_confirmed")).length === 1, "仍只有一条审计 / 一条状态日志 / 一条通知");
    const [pa, pb] = await Promise.all([
      confirmAs(MIKI, oManual.id, { ...base, amount: 1800, method: "check" }),
      confirmAs(BOSS, oManual.id, { ...base, amount: 1800, method: "check" }),
    ]);
    ok(pa.status === 200 && pb.status === 200 && [pa.body?.idempotent, pb.body?.idempotent].filter((x) => x === true).length === 1, "并发两次确认：一次写入、一次幂等", [pa.body, pb.body]);
    ok((await db.auditLog.count({ where: { action: "install.balance.confirmed", targetId: oManual.id } })) === 1, "并发只产生一条记录");

    console.log("\n[5] 已 completed 未确认的单");
    const logsBefore = await db.orderStatusLog.count({ where: { orderId: oDone.id } });
    const okDone = await confirmAs(MIKI, oDone.id, { ...base, amount: 500, note: "手工单无报价" });
    ok(okDone.status === 200 && okDone.body?.orderStatus === "completed" && (await db.orderStatusLog.count({ where: { orderId: oDone.id } })) === logsBefore, "确认 200，状态仍 completed，不加状态日志");

    console.log("\n[6] 列表与销售首页");
    const l2 = await listAs(MIKI);
    const pending2 = ((l2.body?.pending ?? []) as Array<{ orderId: string }>).map((p) => p.orderId);
    const recent = (l2.body?.recentConfirmed ?? []) as Array<{ orderId: string; confirmedByName: string; received: number }>;
    ok(!pending2.includes(o1.id) && !pending2.includes(oManual.id) && !pending2.includes(oDone.id), "已确认的单离开 pending", pending2);
    ok(recent.some((r) => r.orderId === o1.id && r.confirmedByName === "Example i2bmiki" && r.received === 1000), "recentConfirmed 含确认人与实收", recent);
    const home = await buildSalesHome({ userId: ALEX, userName: "Alex", orgId: ORG, ownOnly: true, targetAmount: null });
    ok(home.paymentSummary.pendingBalanceAmount === 1000, "销售首页待收尾款：两张各 1000、一张已确认 → 1000", home.paymentSummary.pendingBalanceAmount);
  } finally {
    await db.notification.deleteMany({ where: { userId: { in: users } } });
    await db.orderStatusLog.deleteMany({ where: { orderId: { in: createdOrders } } });
    await db.blindsOrder.deleteMany({ where: { id: { in: createdOrders } } });
    await db.appointment.deleteMany({ where: { id: { in: createdAppts } } });
    await db.salesQuote.deleteMany({ where: { orgId: { in: [ORG, ORG2] } } });
    await db.salesCustomer.deleteMany({ where: { orgId: { in: [ORG, ORG2] } } });
    await db.auditLog.deleteMany({ where: { OR: [{ userId: { in: users } }, { orgId: { in: [ORG, ORG2] } }] } });
    await db.principalRoleBinding.deleteMany({ where: { orgId: { in: [ORG, ORG2] } } });
    await db.roleProfile.deleteMany({ where: { orgId: { in: [ORG, ORG2] } } }).catch(() => undefined);
    await db.organizationMember.deleteMany({ where: { orgId: { in: [ORG, ORG2] } } });
    await db.organization.deleteMany({ where: { id: { in: [ORG, ORG2] } } }).catch((e) => console.warn("org cleanup:", e instanceof Error ? e.message : e));
    await db.user.deleteMany({ where: { id: { in: users } } }).catch((e) => console.warn("user cleanup:", e instanceof Error ? e.message : e));
    rmSync(BLOB_DIR, { recursive: true, force: true });
    await db.$disconnect();
  }

  console.log(`\n结果: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
