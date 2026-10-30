/**
 * INSTALL-2d：维修单——真实 DB（隔离库）+ 真实路由端到端
 *
 *   [1] 标记问题：缺照片 / 缺描述 / 未知类型 400 且不写记录；他人任务 403；成功 → 有问题；详情带问题内容与有问题数；写记录失败 500
 *   [2] 提交条件：还有未处理 409 UNITS_UNHANDLED；全部收口 409 NO_ISSUES；期望日早于今天 / 客户名为空 400，状态不变
 *   [3] 提交效果：单号 R-<单号>-1、目标日 +7、行由服务端生成；预约 completed、工艺单仍 scheduled、无状态日志；
 *       install.task.completed outcome needs_repair；重复 / 并发只一张；完成后再标问题 409；已收口完成的任务提交 409
 *   [4] 通知：只发涉及品类的出单岗 + 运营 / 会计 / 老板（维修单详情），销售（工艺单）；提交人不收；客户原因不发出单；
 *       品类推不出 → 三个出单岗；每个收件人对落点可读
 *   [5] 列表 / 详情：安装工 403；出单岗 200（阶段、品类、照片代理地址、打印抬头）；他企业 404；不出金额
 *   [6] 状态卡：创建人销售 200（返修中，目标日；不出照片 / 描述 / 电话 / 备注）；他企业 404、读权与工艺单详情一致；返修待排期；已排期
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/install/__tests__/repair-db.isolated.test.ts
 * 无隔离库时自动跳过。只用虚构数据；照片写入临时本地盘（PRODUCT_CONTENT_LOCAL_STORE=1）。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 INSTALL-2d 维修单 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "INSTALL-2d repair DB test" });

process.env.JWT_SECRET = process.env.JWT_SECRET || "install-2d-isolated-test-secret-0123456789abcdef";
const BLOB_DIR = mkdtempSync(path.join(tmpdir(), "install-2d-blobs-"));
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
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : "");
  }
}

type Handler = (r: unknown, c: unknown) => Promise<Response>;
type Json = Record<string, unknown>;
const FAIL_MARKER = "__install2d_force_fail__";

async function main() {
  const { db } = await import("@/lib/db");
  const { NextRequest } = await import("next/server");
  const { createSession } = await import("@/lib/auth/session");
  const { seedOrgAuthorizationProfiles } = await import("@/lib/authorization/seed-org-profiles");
  const { emptySpec, AUDIT_ACTION_SPEC, AUDIT_TARGET_ORDER } = await import("@/lib/sunny-process/process-spec");
  const { todayInTimeZone } = await import("@/lib/install/balance");
  const { addDays } = await import("@/lib/install/repair");
  const photoRoute = await import("@/app/api/install/tasks/[id]/items/[itemId]/photo/route");
  const issueRoute = await import("@/app/api/install/tasks/[id]/items/[itemId]/issue/route");
  const repairRoute = await import("@/app/api/install/tasks/[id]/repair/route");
  const completeRoute = await import("@/app/api/install/tasks/[id]/complete/route");
  const detailRoute = await import("@/app/api/install/tasks/[id]/route");
  const listRoute = await import("@/app/api/install/repairs/route");
  const repairDetailRoute = await import("@/app/api/install/repairs/[id]/route");
  const statusRoute = await import("@/app/api/blinds-orders/[id]/install-status/route");
  const orderRoute = await import("@/app/api/blinds-orders/[id]/route");

  const stamp = Date.now().toString(36);
  const ORG = `i2dorg_${stamp}`;
  const ORG2 = `i2dorg2_${stamp}`;
  const u = (k: string) => `i2d${k}_${stamp}`;
  const [BOSS, MIKI, ALEX, ALEX2, XW, XL, OPS, FV, FD, FS, OPS2] = ["boss", "miki", "alex", "alex2", "xw", "xl", "ops", "fv", "fd", "fs", "ops2"].map(u);
  const users = [BOSS, MIKI, ALEX, ALEX2, XW, XL, OPS, FV, FD, FS, OPS2];
  const roleOf = (id: string) => (id === ALEX || id === ALEX2 ? "sales" : "user");
  for (const id of users) {
    await db.user.create({ data: { id, email: `${id}@fixture.test`, name: `Example ${id.split("_")[0]}`, role: roleOf(id) } });
  }
  await db.organization.create({
    data: { id: ORG, name: "Example Repair Fixture", code: `${ORG}-c`, ownerId: BOSS, industryPackId: "window_covering_services_v1", settingsJson: { timezone: "America/Toronto" } },
  });
  await db.organization.create({
    data: { id: ORG2, name: "Example Other Fixture", code: `${ORG2}-c`, ownerId: OPS2, industryPackId: "window_covering_services_v1", settingsJson: { timezone: "America/Toronto" } },
  });
  for (const id of users.filter((x) => x !== OPS2)) await db.organizationMember.create({ data: { orgId: ORG, userId: id, role: "org_member", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG2, userId: OPS2, role: "org_member", status: "active" } });
  await seedOrgAuthorizationProfiles(ORG);
  await seedOrgAuthorizationProfiles(ORG2);
  const bind = async (orgId: string, userId: string, key: string) => {
    const profile = await db.roleProfile.findUnique({ where: { orgId_key: { orgId, key } } });
    if (!profile) throw new Error(`缺岗位模板 ${key}`);
    await db.principalRoleBinding.create({ data: { orgId, principalType: "HUMAN", principalId: userId, roleProfileId: profile.id, status: "active" } });
  };
  for (const [id, key] of [[BOSS, "owner"], [MIKI, "accounting"], [ALEX, "sales_rep"], [ALEX2, "sales_rep"], [XW, "installer"], [XL, "installer"], [OPS, "ops_lead"], [FV, "fulfillment_vinyl"], [FD, "fulfillment_drapery"], [FS, "fulfillment_shades"]] as const) {
    await bind(ORG, id, key);
  }
  await bind(ORG2, OPS2, "ops_lead");

  const cust = await db.salesCustomer.create({ data: { orgId: ORG, name: "Example Homeowner", phone: "416-555-0110", email: "homeowner@fixture.test", address: "1 Example Way", createdById: ALEX } });
  const createdOrders: string[] = [];
  const createdAppts: string[] = [];
  const start = new Date(Date.now() + 3600_000);
  const vinyl = (location: string) => ({ location, width: 30, height: 60, panels: 2, openCode: "LR", posts: "", rail1In: null, rail1Ratio: null, rod: "", split: "", frame: "L", frameCount: 4, inOut: "内装", structure: "有框", rail2In: null, quoteFrame: "L", quoteOpenDirection: "", quoteMidRail: "" });
  const itemBase = { width: 40, height: 50, fabricSku: "Z-01", productType: "斑马帘", measureType: "Tight", controlType: "拉绳", controlSide: "R", headrailType: "", mountType: "内装" };
  /** 已排期的安装任务（分配给小王），可带 Blinds 行与 Vinyl 窗 */
  const makeTask = async (code: string, opts: { blinds?: Array<{ location: string; productType?: string }>; vinyl?: string[] }) => {
    const appt = await db.appointment.create({
      data: { customerId: cust.id, type: "install", title: `安装 — Example (${code})`, startAt: start, endAt: new Date(start.getTime() + 7200_000), status: "scheduled", assignedToId: XW, createdById: BOSS },
    });
    createdAppts.push(appt.id);
    const order = await db.blindsOrder.create({
      data: { code, status: "scheduled", customerName: "Example Homeowner", creatorId: ALEX, customerId: cust.id, appointmentId: appt.id },
    });
    createdOrders.push(order.id);
    let n = 0;
    for (const b of opts.blinds ?? []) {
      n++;
      await db.blindsOrderItem.create({ data: { ...itemBase, productType: b.productType ?? itemBase.productType, orderId: order.id, itemNumber: n, location: b.location } });
    }
    if (opts.vinyl?.length) {
      await db.auditLog.create({
        data: { userId: BOSS, orgId: ORG, action: AUDIT_ACTION_SPEC, targetType: AUDIT_TARGET_ORDER, targetId: order.id, afterData: JSON.stringify({ ...emptySpec(), vinyl: opts.vinyl.map(vinyl) }) },
      });
    }
    return { appt, order };
  };

  const session = async (uid: string) => `qy_session=${await createSession({ sub: uid, email: `${uid}@fixture.test`, role: roleOf(uid) })}`;
  const parse = async (res: Response) => {
    const text = await res.text();
    let body: Json | null = null;
    try { body = JSON.parse(text) as Json; } catch { body = null; }
    return { status: res.status, body, text };
  };
  const get = async (handler: Handler, uid: string, url: string, params: Record<string, string> = {}, orgId = ORG) => {
    const sep = url.includes("?") ? "&" : "?";
    const r = new NextRequest(`http://localhost${url}${sep}orgId=${orgId}`, { headers: { cookie: await session(uid), "x-forwarded-for": "10.36.0.7" } });
    return parse(await handler(r, { params: Promise.resolve(params) }));
  };
  const post = async (handler: Handler, uid: string, url: string, params: Record<string, string>, body?: FormData | Json) => {
    const isForm = body instanceof FormData;
    const r = new NextRequest(`http://localhost${url}`, {
      method: "POST",
      body: isForm ? body : body ? JSON.stringify(body) : undefined,
      headers: { cookie: await session(uid), "x-forwarded-for": "10.36.0.7", ...(isForm ? {} : { "content-type": "application/json" }) },
    });
    return parse(await handler(r, { params: Promise.resolve(params) }));
  };
  const jpegFile = () => new File([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])], "w.jpg", { type: "image/jpeg" });
  const upload = (uid: string, apptId: string, unitId: string) => {
    const fd = new FormData();
    fd.append("file", jpegFile());
    return post(photoRoute.POST as unknown as Handler, uid, `/api/install/tasks/${apptId}/items/${unitId}/photo`, { id: apptId, itemId: unitId }, fd);
  };
  const issue = (uid: string, apptId: string, unitId: string, f: { issueType?: string; description?: string; needsFactory?: string; withPhoto?: boolean }) => {
    const fd = new FormData();
    if (f.withPhoto !== false) fd.append("file", jpegFile());
    if (f.issueType !== undefined) fd.append("issueType", f.issueType);
    if (f.description !== undefined) fd.append("description", f.description);
    if (f.needsFactory !== undefined) fd.append("needsFactory", f.needsFactory);
    return post(issueRoute.POST as unknown as Handler, uid, `/api/install/tasks/${apptId}/items/${unitId}/issue`, { id: apptId, itemId: unitId }, fd);
  };
  const submit = (uid: string, apptId: string, body: Json) => post(repairRoute.POST as unknown as Handler, uid, `/api/install/tasks/${apptId}/repair`, { id: apptId }, body);
  const detail = async (uid: string, apptId: string) => {
    const r = await get(detailRoute.GET as unknown as Handler, uid, `/api/install/tasks/${apptId}`, { id: apptId });
    return { status: r.status, task: (r.body?.task ?? {}) as Json & { windows: Array<Json & { itemId: string; state: string; issue: Json | null }>; closeout: Json; repair: Json | null } };
  };
  const notes = (userId: string, entityId?: string) =>
    db.notification.findMany({ where: { userId, type: "install_repair_submitted", ...(entityId ? { entityId } : {}) }, select: { entityType: true, entityId: true, title: true, summary: true } });
  const today = todayInTimeZone("America/Toronto");
  const header = { customerName: "Example Homeowner", phone: "416-555-0110", notes: "客户周末在家", customerConfirmed: false };

  try {
    console.log("\n[1] 标记问题");
    const t1 = await makeTask(`I2D-1-${stamp}`, { blinds: [{ location: "Kitchen" }], vinyl: ["Living Room", "Den"] });
    const b1 = (await db.blindsOrderItem.findFirst({ where: { orderId: t1.order.id } }))!.id;
    ok((await upload(XW, t1.appt.id, b1)).status === 200, "Blinds 行拍完工照 200");
    const noPhoto = await issue(XW, t1.appt.id, "spec-vinyl-1", { issueType: "wrong_size", description: "高度短 2cm", withPhoto: false });
    const noDesc = await issue(XW, t1.appt.id, "spec-vinyl-1", { issueType: "wrong_size", description: "  " });
    const badType = await issue(XW, t1.appt.id, "spec-vinyl-1", { issueType: "broken", description: "x" });
    const issueCount0 = await db.auditLog.count({ where: { action: "install.window.issue", targetId: `${t1.order.id}:vinyl:1` } });
    ok(noPhoto.status === 400 && noDesc.status === 400 && badType.status === 400 && issueCount0 === 0, "缺照片 / 缺描述 / 未知类型 → 400，不写记录", [noPhoto.body, noDesc.body, badType.body]);
    const other = await issue(XL, t1.appt.id, "spec-vinyl-1", { issueType: "wrong_size", description: "x" });
    ok(other.status === 403, "他人任务 → 403", other.status);
    const notMine = await issue(XW, t1.appt.id, "spec-vinyl-9", { issueType: "wrong_size", description: "x" });
    ok(notMine.status === 404, "单元不属于该工艺单 → 404", notMine.status);
    const i1 = await issue(XW, t1.appt.id, "spec-vinyl-1", { issueType: "wrong_size", description: "高度短 2cm" });
    const issueRow = await db.auditLog.findFirst({ where: { action: "install.window.issue", targetId: `${t1.order.id}:vinyl:1` } });
    const issueData = JSON.parse(issueRow?.afterData ?? "{}") as Json;
    ok(i1.status === 200 && i1.body?.state === "issue" && issueRow?.targetType === "blinds_order_unit" && issueData.needsFactory === true && issueData.location === "Den", "标记成功：有问题，审计目标 <工艺单>:vinyl:1，需工厂，位置快照 Den", { body: i1.body, issueData });
    const d1 = await detail(XW, t1.appt.id);
    const w = d1.task.windows.find((x) => x.itemId === "spec-vinyl-1");
    const wi = (w?.issue ?? {}) as Json & { photos?: Array<{ proxyUrl: string }> };
    ok(w?.state === "issue" && wi.issueTypeLabel === "尺寸不符需重做" && wi.description === "高度短 2cm" && wi.photos?.length === 1 && wi.photos[0].proxyUrl.startsWith("/api/files/"), "详情：问题类型名 / 描述 / 1 张问题照（代理地址）", w);
    ok(d1.task.closeout.issueCount === 1 && d1.task.closeout.completed === 1 && d1.task.closeout.total === 3, "汇总：已收口 1 / 3，有问题 1", d1.task.closeout);

    await db.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION install2d_force_fail() RETURNS trigger AS $$
      BEGIN
        IF NEW."afterData" LIKE '%${FAIL_MARKER}%' THEN RAISE EXCEPTION 'install2d forced audit failure'; END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql;`);
    await db.$executeRawUnsafe(`CREATE TRIGGER install2d_force_fail BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION install2d_force_fail();`);
    try {
      const f = await issue(XW, t1.appt.id, "spec-vinyl-0", { issueType: "damaged", description: FAIL_MARKER });
      ok(f.status === 500 && f.body?.code === "RECORD_FAILED" && String(f.body?.error).includes("请重拍"), "问题记录写入失败 → 500，提示重拍", f.body);
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS install2d_force_fail ON "AuditLog";`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS install2d_force_fail();`);
    }
    ok((await detail(XW, t1.appt.id)).task.windows.find((x) => x.itemId === "spec-vinyl-0")?.state === "pending", "失败那次不计入：spec-vinyl-0 仍未处理");

    console.log("\n[2] 提交条件");
    const s0 = await submit(XW, t1.appt.id, header);
    const missing = (s0.body?.missing ?? []) as Array<{ itemNumber: number; location: string }>;
    ok(s0.status === 409 && s0.body?.code === "UNITS_UNHANDLED" && missing.length === 1 && missing[0].itemNumber === 2 && missing[0].location === "Living Room", "还有未处理 → 409 UNITS_UNHANDLED，列出 2 号 Living Room", s0.body);
    const tAll = await makeTask(`I2D-A-${stamp}`, { vinyl: ["Hall"] });
    await upload(XW, tAll.appt.id, "spec-vinyl-0");
    const sNo = await submit(XW, tAll.appt.id, header);
    ok(sNo.status === 409 && sNo.body?.code === "NO_ISSUES", "全部已收口 → 409 NO_ISSUES", sNo.body);
    ok((await upload(XW, t1.appt.id, "spec-vinyl-0")).status === 200, "spec-vinyl-0 补拍完工照");
    const sPast = await submit(XW, t1.appt.id, { ...header, customerPreferredDate: addDays(today, -1) });
    const sNoName = await submit(XW, t1.appt.id, { ...header, customerName: " " });
    const appt1a = await db.appointment.findUnique({ where: { id: t1.appt.id } });
    ok(sPast.status === 400 && sNoName.status === 400 && appt1a?.status === "scheduled" && (await db.auditLog.count({ where: { action: "install.repair.submitted", targetId: t1.order.id } })) === 0, "期望日早于今天 / 客户名为空 → 400，预约不变、无维修单", [sPast.body, sNoName.body]);
    ok((await submit(XL, t1.appt.id, header)).status === 403, "他人任务提交 → 403");

    console.log("\n[3] 提交效果");
    const logsBefore = await db.orderStatusLog.count({ where: { orderId: t1.order.id } });
    const s1 = await submit(XW, t1.appt.id, header);
    const rep1 = (s1.body?.repair ?? {}) as { id: string; repairNo: string; targetDate: string; rowCount: number };
    ok(s1.status === 200 && s1.body?.idempotent === false && rep1.repairNo === `R-I2D-1-${stamp}-1` && rep1.targetDate === addDays(today, 7) && rep1.rowCount === 1, "提交 200：单号 R-<单号>-1、目标日 = 今天 + 7、1 行", s1.body);
    const appt1 = await db.appointment.findUnique({ where: { id: t1.appt.id } });
    const order1 = await db.blindsOrder.findUnique({ where: { id: t1.order.id } });
    ok(appt1?.status === "completed" && !!appt1.completedAt && order1?.status === "scheduled" && (await db.orderStatusLog.count({ where: { orderId: t1.order.id } })) === logsBefore, "预约 completed、工艺单仍 scheduled、无新状态日志");
    const done = await db.auditLog.findFirst({ where: { action: "install.task.completed", targetType: "appointment", targetId: t1.appt.id } });
    const doneData = JSON.parse(done?.afterData ?? "{}") as Json;
    ok(doneData.outcome === "needs_repair" && doneData.repairNo === rep1.repairNo && doneData.orderStatus === "scheduled", "install.task.completed：结果 needs_repair、带单号", doneData);
    const repRow = await db.auditLog.findUnique({ where: { id: rep1.id } });
    const repData = JSON.parse(repRow?.afterData ?? "{}") as { rows: Array<Json & { photos: Array<{ proxyUrl: string }> }>; header: Json; fillDate: string };
    const row0 = repData.rows?.[0];
    ok(repRow?.action === "install.repair.submitted" && repRow.targetType === "blinds_order" && repRow.targetId === t1.order.id && repData.rows.length === 1 && row0.location === "Den" && row0.issueType === "wrong_size" && row0.needsFactory === true && row0.category === "vinyl" && row0.photos[0].proxyUrl.startsWith("/api/files/"), "维修单审计：目标工艺单，行 = 有问题单元（Den / 尺寸不符 / 需工厂 / Vinyl / 问题照）", repData);
    ok(repData.header.takenById === XW && repData.header.phone === "416-555-0110" && repData.fillDate === today, "表头：Taken by = 提交人、电话、填写日 = 企业当天");
    const sAgain = await submit(XW, t1.appt.id, header);
    ok(sAgain.status === 200 && sAgain.body?.idempotent === true && (sAgain.body?.repair as Json)?.repairNo === rep1.repairNo && (await db.auditLog.count({ where: { action: "install.repair.submitted", targetId: t1.order.id } })) === 1, "重复提交 → 200 idempotent，同一单号，仍一张", sAgain.body);
    const d2 = await detail(XW, t1.appt.id);
    ok(d2.task.status === "completed" && d2.task.repair?.repairNo === rep1.repairNo && d2.task.repair?.rowCount === 1 && d2.task.repair?.targetDate === rep1.targetDate, "提交后任务详情带维修单单号 / 目标日 / 行数", d2.task.repair);
    const late = await issue(XW, t1.appt.id, "spec-vinyl-0", { issueType: "damaged", description: "x" });
    ok(late.status === 409, "任务完成后再标记问题 → 409", late.status);
    ok((await post(completeRoute.POST as unknown as Handler, XW, `/api/install/tasks/${tAll.appt.id}/complete`, { id: tAll.appt.id })).status === 200, "全部收口的任务完成收口 200");
    const sClosed = await submit(XW, tAll.appt.id, header);
    ok(sClosed.status === 409 && sClosed.body?.code === "ALREADY_CLOSED", "已收口完成的任务提交维修单 → 409", sClosed.body);

    // 并发：同一任务两个请求同时提交 → 只一张
    const tC = await makeTask(`I2D-C-${stamp}`, { vinyl: ["Hall"] });
    await issue(XW, tC.appt.id, "spec-vinyl-0", { issueType: "missing_parts", description: "漏发支架" });
    const [ca, cb] = await Promise.all([submit(XW, tC.appt.id, header), submit(XW, tC.appt.id, header)]);
    const repCount = await db.auditLog.count({ where: { action: "install.repair.submitted", targetId: tC.order.id } });
    ok(ca.status === 200 && cb.status === 200 && [ca.body?.idempotent, cb.body?.idempotent].filter((x) => x === true).length === 1 && repCount === 1, "并发两次提交：一张维修单，一次幂等", [ca.body, cb.body]);
    const repC = (ca.body?.repair as { id: string }).id;
    ok((await notes(OPS, repC)).length === 1, "并发不重复通知（运营主管一条）");

    console.log("\n[4] 通知");
    const fv = await notes(FV, rep1.id);
    ok(fv.length === 1 && fv[0].entityType === "install_repair", "出单·Vinyl 收到一条（实体 install_repair → 维修单详情）", fv);
    ok((await notes(FD, rep1.id)).length === 0 && (await notes(FS, rep1.id)).length === 0, "出单·布帘 / Roller 不收（行只有 Vinyl）");
    for (const [name, uid] of [["运营主管", OPS], ["会计", MIKI], ["老板", BOSS]] as const) {
      const n = await notes(uid, rep1.id);
      ok(n.length === 1 && n[0].entityType === "install_repair", `${name}收到一条（维修单详情）`, n);
    }
    const sales = await notes(ALEX, t1.order.id);
    ok(sales.length === 1 && sales[0].entityType === "blinds_order", "销售（创建人）收到一条（实体 blinds_order → 工艺单状态卡）", sales);
    ok((await db.notification.count({ where: { userId: XW, type: "install_repair_submitted" } })) === 0, "提交人（安装工）不收");
    const allNotes = await db.notification.findMany({ where: { type: "install_repair_submitted", userId: { in: users } }, select: { title: true, summary: true } });
    ok(allNotes.length > 0 && allNotes.every((n) => !/\$|2600|grandTotal|尾款金额/.test(`${n.title}${n.summary ?? ""}`)), "通知标题 / 摘要不含金额");
    for (const [name, uid] of [["出单·Vinyl", FV], ["运营主管", OPS], ["会计", MIKI], ["老板", BOSS]] as const) {
      const r = await get(repairDetailRoute.GET as unknown as Handler, uid, `/api/install/repairs/${rep1.id}`, { id: rep1.id });
      ok(r.status === 200, `落点可读：${name}打开维修单详情 200`, r.status);
    }
    const orderAsSales = await get(orderRoute.GET as unknown as Handler, ALEX, `/api/blinds-orders/${t1.order.id}`, { id: t1.order.id });
    const statusAsSales = await get(statusRoute.GET as unknown as Handler, ALEX, `/api/blinds-orders/${t1.order.id}/install-status`, { id: t1.order.id });
    ok(orderAsSales.status === 200 && statusAsSales.status === 200, "落点可读：销售打开工艺单详情与状态卡 200", [orderAsSales.status, statusAsSales.status]);

    const t3 = await makeTask(`I2D-3-${stamp}`, { vinyl: ["Porch"] });
    await issue(XW, t3.appt.id, "spec-vinyl-0", { issueType: "customer", description: "客户要求改期" });
    const s3 = await submit(XW, t3.appt.id, { ...header, customerPreferredDate: addDays(today, 10), customerConfirmed: true });
    const rep3 = (s3.body?.repair ?? {}) as { id: string; targetDate: string };
    ok(s3.status === 200 && rep3.targetDate === addDays(today, 10), "客户期望日 → 目标日 = 期望日", s3.body);
    ok((await notes(FV, rep3.id)).length + (await notes(FD, rep3.id)).length + (await notes(FS, rep3.id)).length === 0, "只有客户原因 → 三个出单岗都不收");
    ok((await notes(OPS, rep3.id)).length === 1 && (await notes(MIKI, rep3.id)).length === 1 && (await notes(BOSS, rep3.id)).length === 1, "运营主管 / 会计 / 老板照常收到");

    const t4 = await makeTask(`I2D-4-${stamp}`, { blinds: [{ location: "Attic", productType: "百叶窗X" }] });
    const b4 = (await db.blindsOrderItem.findFirst({ where: { orderId: t4.order.id } }))!.id;
    await issue(XW, t4.appt.id, b4, { issueType: "damaged", description: "面板裂" });
    const s4 = await submit(XW, t4.appt.id, header);
    const rep4 = (s4.body?.repair ?? {}) as { id: string };
    ok((await notes(FV, rep4.id)).length === 1 && (await notes(FD, rep4.id)).length === 1 && (await notes(FS, rep4.id)).length === 1, "需工厂但品类推不出 → 三个出单岗都收到");

    console.log("\n[5] 列表 / 详情");
    ok((await get(listRoute.GET as unknown as Handler, XW, `/api/install/repairs`)).status === 403, "安装工请求列表 → 403");
    ok((await get(repairDetailRoute.GET as unknown as Handler, XW, `/api/install/repairs/${rep1.id}`, { id: rep1.id })).status === 403, "安装工请求详情 → 403");
    ok((await get(listRoute.GET as unknown as Handler, ALEX, `/api/install/repairs`)).status === 403, "销售请求列表 → 403");
    const list = await get(listRoute.GET as unknown as Handler, FV, `/api/install/repairs`);
    const items = (list.body?.repairs ?? []) as Array<Json & { id: string; targetDate: string; factory: { categories: Array<{ key: string }> } }>;
    const li1 = items.find((x) => x.id === rep1.id);
    ok(list.status === 200 && items.length === 4 && li1?.stage === "repair_open" && li1.stageLabel === "返修待出单" && li1.rowCount === 1 && li1.factory.categories.map((c) => c.key).join() === "vinyl" && li1.customerConfirmed === false && li1.overdue === false && li1.orderCode === `I2D-1-${stamp}`, "出单岗列表 200：阶段返修待出单、品类 Vinyl、行数、未确认、未逾期", li1);
    ok(items.every((x, i) => i === 0 || items[i - 1].targetDate <= x.targetDate), "按目标日升序", items.map((x) => x.targetDate));
    ok(items.find((x) => x.id === rep3.id)?.stage === "repair_ready_to_schedule", "只有客户原因的单：返修待排期");
    const det = await get(repairDetailRoute.GET as unknown as Handler, FV, `/api/install/repairs/${rep1.id}`, { id: rep1.id });
    const dr = (det.body?.repair ?? {}) as Json & { rows: Array<Json & { photos: Array<{ proxyUrl: string }> }>; company: { name: string; address: string } };
    ok(det.status === 200 && dr.rows.length === 1 && dr.rows[0].issueTypeLabel === "尺寸不符需重做" && dr.rows[0].photos[0].proxyUrl.startsWith("/api/files/") && dr.phone === "416-555-0110" && dr.notes === "客户周末在家", "详情：行 / 问题类型名 / 问题照代理地址 / 表头", dr);
    ok(dr.company?.name === "Sunny Shutter Inc" && dr.company.address === "2-680 Progress Avenue, Scarborough, ON M1H 3A5", "打印抬头取质保设置（未保存 = 种子）", dr.company);
    ok(!/grandTotal|"price|deposit|"balance|costPrice|\$/.test(det.text) && !/"pathname"/.test(det.text), "详情不含金额字段，不出原始存储路径");
    const cross = await get(repairDetailRoute.GET as unknown as Handler, OPS2, `/api/install/repairs/${rep1.id}`, { id: rep1.id }, ORG2);
    ok(cross.status === 404, "他企业运营主管 → 404", cross.status);
    const notRepair = await get(repairDetailRoute.GET as unknown as Handler, FV, `/api/install/repairs/${done!.id}`, { id: done!.id });
    ok(notRepair.status === 404, "id 指向别的审计行 → 404", notRepair.status);

    console.log("\n[6] 状态卡");
    const st = statusAsSales.body as Json & { repair: Json & { rows: Array<Json> } };
    ok(st.stage === "repair_open" && st.salesText === `返修中，目标 ${rep1.targetDate}` && st.repair?.repairNo === rep1.repairNo && st.repair.rows[0].location === "Den" && st.repair.rows[0].issueTypeLabel === "尺寸不符需重做", "销售：返修中，目标日、单号、行位置与问题类型名", st);
    ok(!/photos|proxyUrl|description|"phone"|"notes"|grandTotal|\$/.test(statusAsSales.text), "状态卡不出照片 / 描述 / 电话 / 备注 / 金额", statusAsSales.text);
    const st404 = await get(statusRoute.GET as unknown as Handler, OPS2, `/api/blinds-orders/${t1.order.id}/install-status`, { id: t1.order.id }, ORG2);
    ok(st404.status === 404, "他企业成员 → 404（与工艺单详情同一读范围）", st404.status);
    const stPeer = await get(statusRoute.GET as unknown as Handler, ALEX2, `/api/blinds-orders/${t1.order.id}/install-status`, { id: t1.order.id });
    const orderPeer = await get(orderRoute.GET as unknown as Handler, ALEX2, `/api/blinds-orders/${t1.order.id}`, { id: t1.order.id });
    ok(stPeer.status === orderPeer.status, "同企业另一位销售：状态卡与工艺单详情读权一致", [stPeer.status, orderPeer.status]);
    const st3 = await get(statusRoute.GET as unknown as Handler, ALEX, `/api/blinds-orders/${t3.order.id}/install-status`, { id: t3.order.id });
    ok(st3.body?.stage === "repair_ready_to_schedule" && (st3.body?.repair as Json)?.customerConfirmed === true, "客户原因单：返修待排期，已和客户确认", st3.body);
    const t5 = await makeTask(`I2D-5-${stamp}`, { vinyl: ["Hall"] });
    const st5 = await get(statusRoute.GET as unknown as Handler, ALEX, `/api/blinds-orders/${t5.order.id}/install-status`, { id: t5.order.id });
    ok(st5.body?.stage === "scheduled" && String(st5.body?.salesText).startsWith("已排 ") && st5.body?.repair === null, "未返修的单：已排 <日期> 安装", st5.body);
    const stAll = await get(statusRoute.GET as unknown as Handler, ALEX, `/api/blinds-orders/${tAll.order.id}/install-status`, { id: tAll.order.id });
    ok(stAll.body?.stage === "awaiting_balance" && stAll.body?.salesText === "已装完，收尾款", "正常收口完成的单：待收尾款", stAll.body);
  } finally {
    await db.notification.deleteMany({ where: { userId: { in: users } } });
    await db.orderStatusLog.deleteMany({ where: { orderId: { in: createdOrders } } });
    await db.blindsOrderItem.deleteMany({ where: { orderId: { in: createdOrders } } });
    await db.blindsOrder.deleteMany({ where: { id: { in: createdOrders } } });
    await db.appointment.deleteMany({ where: { id: { in: createdAppts } } });
    await db.salesCustomer.deleteMany({ where: { orgId: { in: [ORG, ORG2] } } });
    await db.auditLog.deleteMany({ where: { OR: [{ userId: { in: users } }, { orgId: { in: [ORG, ORG2] } }] } });
    await db.principalRoleBinding.deleteMany({ where: { orgId: { in: [ORG, ORG2] } } });
    await db.roleProfile.deleteMany({ where: { orgId: { in: [ORG, ORG2] } } }).catch(() => undefined);
    await db.organizationMember.deleteMany({ where: { orgId: { in: [ORG, ORG2] } } });
    await db.organization.deleteMany({ where: { id: { in: [ORG, ORG2] } } }).catch((e) => console.warn("org cleanup:", e instanceof Error ? e.message : e));
    await db.user.deleteMany({ where: { id: { in: users } } }).catch((e) => console.warn("user cleanup:", e instanceof Error ? e.message : e));
    await db.$disconnect();
    rmSync(BLOB_DIR, { recursive: true, force: true });
  }

  console.log(`\n结果: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  rmSync(BLOB_DIR, { recursive: true, force: true });
  process.exit(1);
});
