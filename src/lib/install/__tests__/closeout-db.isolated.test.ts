/**
 * INSTALL-2a：收口单元覆盖全部产品线——真实 DB（隔离库）+ 真实路由端到端
 *
 *   [1] 只有 Vinyl 的单：详情 3 个单元 → 逐个上传（审计 blinds_order_unit + 位置快照）→ 列表 / 详情计数一致
 *       → 不存在的单元 404 且无文件写入 → 他人 403 → 未拍完 409 WINDOWS_MISSING → 拍完 complete 200、工艺单 installed
 *   [2] 混合单：Blinds 2 行 + 窗帘 2 行 = 4 个单元；Blinds 行仍写 blinds_order_item；参数改位置后计为未收口（位置已变）；
 *       审计写入失败 → 500 RECORD_FAILED，单元仍未收口
 *   [3] 零单元单：详情 total 0；complete → 409 NO_UNITS，状态不变
 *   [3b] 他人任务详情 403；工艺单已 cancelled → complete 409 ORDER_STATUS，预约不变
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/install/__tests__/closeout-db.isolated.test.ts
 * 无隔离库时自动跳过。只用虚构数据；照片写入临时本地盘（PRODUCT_CONTENT_LOCAL_STORE=1）。
 */
import { mkdtempSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 INSTALL-2a 收口单元 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "INSTALL-2a closeout DB test" });

process.env.JWT_SECRET = process.env.JWT_SECRET || "install-2a-isolated-test-secret-0123456789abcdef";
const BLOB_DIR = mkdtempSync(path.join(tmpdir(), "install-2a-blobs-"));
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
type Win = { itemId: string; itemNumber: number; section: string; location: string; photoCount: number; locationChanged: { previousLocation: string } | null };

const FAIL_MARKER = "__install2a_force_audit_fail__";

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => path.join(d.parentPath ?? "", d.name));
}

async function main() {
  const { db } = await import("@/lib/db");
  const { NextRequest } = await import("next/server");
  const { createSession } = await import("@/lib/auth/session");
  const { seedOrgAuthorizationProfiles } = await import("@/lib/authorization/seed-org-profiles");
  const { emptySpec, AUDIT_ACTION_SPEC, AUDIT_TARGET_ORDER } = await import("@/lib/sunny-process/process-spec");
  const listRoute = await import("@/app/api/install/tasks/route");
  const detailRoute = await import("@/app/api/install/tasks/[id]/route");
  const photoRoute = await import("@/app/api/install/tasks/[id]/items/[itemId]/photo/route");
  const completeRoute = await import("@/app/api/install/tasks/[id]/complete/route");

  const stamp = Date.now().toString(36);
  const BOSS = `i2boss_${stamp}`;
  const XW = `i2xw_${stamp}`;
  const XL = `i2xl_${stamp}`;
  const ORG = `i2org_${stamp}`;
  const users = [BOSS, XW, XL];
  for (const id of users) {
    await db.user.create({ data: { id, email: `${id}@fixture.test`, name: `Example ${id.split("_")[0]}`, role: "user" } });
  }
  await db.organization.create({ data: { id: ORG, name: "Example Install Fixture", code: `i2o-${stamp}`, ownerId: BOSS, industryPackId: "window_covering_services_v1" } });
  for (const id of users) {
    await db.organizationMember.create({ data: { orgId: ORG, userId: id, role: "org_member", status: "active" } });
  }
  await seedOrgAuthorizationProfiles(ORG);
  const bind = async (userId: string, key: string) => {
    const profile = await db.roleProfile.findUnique({ where: { orgId_key: { orgId: ORG, key } } });
    if (!profile) throw new Error(`缺岗位模板 ${key}`);
    await db.principalRoleBinding.create({ data: { orgId: ORG, principalType: "HUMAN", principalId: userId, roleProfileId: profile.id, status: "active" } });
  };
  await bind(BOSS, "owner");
  await bind(XW, "installer");
  await bind(XL, "installer");

  const cust = await db.salesCustomer.create({
    data: { orgId: ORG, name: "Example Homeowner", phone: "416-555-0101", email: "homeowner@fixture.test", address: "2 Example Ave", createdById: BOSS },
  });

  const start = new Date(Date.now() + 3600_000);
  const makeTask = async (code: string) => {
    const appt = await db.appointment.create({
      data: {
        customerId: cust.id, type: "install", title: `安装 — Example (${code})`, startAt: start, endAt: new Date(start.getTime() + 7200_000),
        status: "scheduled", assignedToId: XW, createdById: BOSS,
      },
    });
    const order = await db.blindsOrder.create({
      data: { code, status: "scheduled", customerName: "Example Homeowner", creatorId: BOSS, customerId: cust.id, appointmentId: appt.id },
    });
    return { appt, order };
  };
  const saveSpec = async (orderId: string, part: Record<string, unknown>) => {
    await db.auditLog.create({
      data: { userId: BOSS, orgId: ORG, action: AUDIT_ACTION_SPEC, targetType: AUDIT_TARGET_ORDER, targetId: orderId, afterData: JSON.stringify({ ...emptySpec(), ...part }) },
    });
    // 同一毫秒内连续保存时保证"最新"可区分
    await new Promise((r) => setTimeout(r, 15));
  };
  const vinyl = (location: string) => ({
    location, width: 30, height: 60, panels: 2, openCode: "LR", posts: "", rail1In: null, rail1Ratio: null, rod: "", split: "",
    frame: "L", frameCount: 4, inOut: "内装", structure: "有框", rail2In: null, quoteFrame: "L", quoteOpenDirection: "", quoteMidRail: "",
  });
  const drape = (location: string, part: "drape" | "sheer") => ({
    location, part, widthIn: 80, heightIn: 90, sku: "D-01", qty: 1, craft: "韩褶P", layer: part === "sheer" ? "纱" : "布",
    liner: "否", fullness: 2.3, mount: "顶装C", rod: "", rodColor: "",
  });

  const session = async (uid: string) => `qy_session=${await createSession({ sub: uid, email: `${uid}@fixture.test`, role: "user" })}`;
  const parse = async (res: Response) => {
    const text = await res.text();
    let body: Json | null = null;
    try { body = JSON.parse(text) as Json; } catch { body = null; }
    return { status: res.status, body };
  };
  const get = async (handler: Handler, uid: string, url: string, params: Record<string, string> = {}) => {
    const sep = url.includes("?") ? "&" : "?";
    const r = new NextRequest(`http://localhost${url}${sep}orgId=${ORG}`, { headers: { cookie: await session(uid), "x-forwarded-for": "10.32.0.7" } });
    return parse(await handler(r, { params: Promise.resolve(params) }));
  };
  const post = async (handler: Handler, uid: string, url: string, params: Record<string, string>, body?: FormData) => {
    const r = new NextRequest(`http://localhost${url}`, { method: "POST", body, headers: { cookie: await session(uid), "x-forwarded-for": "10.32.0.7" } });
    return parse(await handler(r, { params: Promise.resolve(params) }));
  };
  const jpeg = (note = "") => {
    const fd = new FormData();
    fd.append("file", new File([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])], "w.jpg", { type: "image/jpeg" }));
    if (note) fd.append("note", note);
    return fd;
  };
  const upload = (uid: string, apptId: string, unitId: string, note = "") =>
    post(photoRoute.POST as unknown as Handler, uid, `/api/install/tasks/${apptId}/items/${unitId}/photo`, { id: apptId, itemId: unitId }, jpeg(note));
  const detail = async (uid: string, apptId: string) => {
    const r = await get(detailRoute.GET as unknown as Handler, uid, `/api/install/tasks/${apptId}`, { id: apptId });
    const task = (r.body?.task ?? {}) as { windows?: Win[]; closeout?: { total: number; completed: number; allCompleted: boolean } };
    return { status: r.status, windows: task.windows ?? [], closeout: task.closeout, body: r.body };
  };
  const complete = (uid: string, apptId: string) =>
    post(completeRoute.POST as unknown as Handler, uid, `/api/install/tasks/${apptId}/complete`, { id: apptId });

  const createdOrders: string[] = [];
  const createdAppts: string[] = [];
  try {
    console.log("\n[1] 只有 Vinyl 的单");
    const t1 = await makeTask(`I2A-V-${stamp}`);
    createdOrders.push(t1.order.id);
    createdAppts.push(t1.appt.id);
    await saveSpec(t1.order.id, { vinyl: [vinyl("Living"), vinyl("Kitchen"), vinyl("Bed")] });

    const d0 = await detail(XW, t1.appt.id);
    ok(d0.status === 200 && d0.windows.length === 3, "详情返回 3 个收口单元", d0.body);
    ok(d0.windows.map((w) => w.itemId).join() === "spec-vinyl-0,spec-vinyl-1,spec-vinyl-2" && d0.windows.every((w) => w.section === "vinyl"), "单元 id spec-vinyl-0…2，段 vinyl", d0.windows);
    ok(d0.windows.map((w) => w.location).join() === "Living,Kitchen,Bed", "位置与工艺参数一致");
    ok(d0.closeout?.total === 3 && d0.closeout.completed === 0 && !d0.closeout.allCompleted, "0 / 3");

    const u0 = await upload(XW, t1.appt.id, "spec-vinyl-0");
    ok(u0.status === 200 && (u0.body?.photoCount as number) === 1 && String((u0.body?.latest as Json)?.proxyUrl).startsWith("/api/files/install-photos/"), "上传 spec-vinyl-0 → 200，代理地址", u0.body);
    const a0 = await db.auditLog.findFirst({ where: { action: "install.window.completed", targetType: "blinds_order_unit", targetId: `${t1.order.id}:vinyl:0` } });
    const a0d = JSON.parse(a0?.afterData ?? "{}") as Json;
    ok(!!a0 && a0d.location === "Living" && a0d.unitId === "spec-vinyl-0" && a0d.appointmentId === t1.appt.id, "审计 blinds_order_unit / <orderId>:vinyl:0，含位置快照", a0d);
    const u1 = await upload(XW, t1.appt.id, "spec-vinyl-1");
    ok(u1.status === 200, "上传 spec-vinyl-1 → 200");

    const list = await get(listRoute.GET as unknown as Handler, XW, `/api/install/tasks`);
    const lt = ((list.body?.tasks ?? []) as Array<{ id: string; order: { windowCount: number; completedCount: number } | null }>).find((t) => t.id === t1.appt.id);
    const d1 = await detail(XW, t1.appt.id);
    ok(list.status === 200 && lt?.order?.windowCount === 3 && lt.order.completedCount === 2, "列表 2 / 3", lt);
    ok(d1.closeout?.total === 3 && d1.closeout.completed === 2, "详情 2 / 3（与列表一致）", d1.closeout);

    const filesBefore = filesUnder(BLOB_DIR).length;
    const u404 = await upload(XW, t1.appt.id, "spec-vinyl-5");
    ok(u404.status === 404 && filesUnder(BLOB_DIR).length === filesBefore, "spec-vinyl-5 → 404，无文件写入", { status: u404.status, before: filesBefore, after: filesUnder(BLOB_DIR).length });
    const u403 = await upload(XL, t1.appt.id, "spec-vinyl-2");
    ok(u403.status === 403 && filesUnder(BLOB_DIR).length === filesBefore, "他人任务上传 → 403，无文件写入", u403.status);

    const c409 = await complete(XW, t1.appt.id);
    const missing = (c409.body?.missing ?? []) as Array<{ itemNumber: number; location: string }>;
    ok(c409.status === 409 && c409.body?.code === "WINDOWS_MISSING" && missing.length === 1 && missing[0].itemNumber === 3 && missing[0].location === "Bed", "未拍完 → 409 WINDOWS_MISSING，列出 #3 Bed", c409.body);

    await upload(XW, t1.appt.id, "spec-vinyl-2");
    const c200 = await complete(XW, t1.appt.id);
    const appt1 = await db.appointment.findUnique({ where: { id: t1.appt.id } });
    const order1 = await db.blindsOrder.findUnique({ where: { id: t1.order.id } });
    ok(c200.status === 200 && appt1?.status === "completed" && order1?.status === "installed" && !!order1.installedAt, "拍完 → complete 200，预约 completed，工艺单 installed", { body: c200.body, appt: appt1?.status, order: order1?.status });

    console.log("\n[2] 混合单（Blinds 2 行 + 窗帘 2 行）");
    const t2 = await makeTask(`I2A-M-${stamp}`);
    createdOrders.push(t2.order.id);
    createdAppts.push(t2.appt.id);
    const itemBase = { width: 40, height: 50, fabricSku: "Z-01", productType: "斑马帘", measureType: "Tight", controlType: "拉绳", controlSide: "R", headrailType: "", mountType: "内装" };
    const b1 = await db.blindsOrderItem.create({ data: { ...itemBase, orderId: t2.order.id, itemNumber: 1, location: "Hall" } });
    await db.blindsOrderItem.create({ data: { ...itemBase, orderId: t2.order.id, itemNumber: 2, location: "Den" } });
    await saveSpec(t2.order.id, { drapes: [drape("Living Room", "drape"), drape("主卧", "drape")] });

    const list2 = await get(listRoute.GET as unknown as Handler, XW, `/api/install/tasks`);
    const lt2 = ((list2.body?.tasks ?? []) as Array<{ id: string; order: { windowCount: number } | null }>).find((t) => t.id === t2.appt.id);
    ok(lt2?.order?.windowCount === 4, "列表收口单元数 4", lt2);
    const d2 = await detail(XW, t2.appt.id);
    ok(d2.windows.map((w) => `${w.itemNumber}:${w.section}`).join() === "1:blinds,2:blinds,3:drapes,4:drapes", "序号 1–4：Blinds → 窗帘", d2.windows);

    const ub = await upload(XW, t2.appt.id, b1.id);
    const ab = await db.auditLog.findFirst({ where: { action: "install.window.completed", targetId: b1.id } });
    ok(ub.status === 200 && ab?.targetType === "blinds_order_item", "Blinds 行仍写 blinds_order_item（INSTALL-1 兼容）", ab?.targetType);

    const ud = await upload(XW, t2.appt.id, "spec-drapes-1");
    ok(ud.status === 200, "上传 spec-drapes-1（主卧）→ 200");
    await saveSpec(t2.order.id, { drapes: [drape("Living Room", "drape"), drape("次卧", "drape")] });
    const d3 = await detail(XW, t2.appt.id);
    const w4 = d3.windows.find((w) => w.itemId === "spec-drapes-1");
    ok(w4?.photoCount === 0 && w4.locationChanged?.previousLocation === "主卧" && w4.location === "次卧", "出单改位置后 → 未收口，位置已变（原：主卧）", w4);

    await db.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION install2a_force_fail() RETURNS trigger AS $$
      BEGIN
        IF NEW."afterData" LIKE '%${FAIL_MARKER}%' THEN RAISE EXCEPTION 'install2a forced audit failure'; END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql;`);
    await db.$executeRawUnsafe(`CREATE TRIGGER install2a_force_fail BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION install2a_force_fail();`);
    try {
      const uf = await upload(XW, t2.appt.id, "spec-drapes-0", FAIL_MARKER);
      ok(uf.status === 500 && uf.body?.code === "RECORD_FAILED" && String(uf.body?.error).includes("请重拍") && !uf.body?.latest, "审计写入失败 → 500 RECORD_FAILED，提示重拍，不返回记录", uf.body);
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS install2a_force_fail ON "AuditLog";`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS install2a_force_fail();`);
    }
    const d4 = await detail(XW, t2.appt.id);
    ok(d4.windows.find((w) => w.itemId === "spec-drapes-0")?.photoCount === 0, "失败那次不计入：spec-drapes-0 仍未收口");

    console.log("\n[3] 零单元单");
    const t3 = await makeTask(`I2A-Z-${stamp}`);
    createdOrders.push(t3.order.id);
    createdAppts.push(t3.appt.id);
    const d5 = await detail(XW, t3.appt.id);
    ok(d5.status === 200 && d5.closeout?.total === 0 && d5.windows.length === 0, "详情 total 0", d5.closeout);
    const cz = await complete(XW, t3.appt.id);
    const appt3 = await db.appointment.findUnique({ where: { id: t3.appt.id } });
    const order3 = await db.blindsOrder.findUnique({ where: { id: t3.order.id } });
    ok(cz.status === 409 && cz.body?.code === "NO_UNITS" && String(cz.body?.error).includes("没有可收口的行"), "complete → 409 NO_UNITS", cz.body);
    ok(appt3?.status === "scheduled" && order3?.status === "scheduled", "状态不变");

    console.log("\n[3b] 他人任务详情 / 工艺单不在可推进状态");
    const dOther = await detail(XL, t2.appt.id);
    ok(dOther.status === 403, "小李打开分配给小王的任务详情 → 403", dOther.status);
    const t4 = await makeTask(`I2A-C-${stamp}`);
    createdOrders.push(t4.order.id);
    createdAppts.push(t4.appt.id);
    await saveSpec(t4.order.id, { vinyl: [vinyl("Porch")] });
    await upload(XW, t4.appt.id, "spec-vinyl-0");
    await db.blindsOrder.update({ where: { id: t4.order.id }, data: { status: "cancelled" } });
    const cc = await complete(XW, t4.appt.id);
    const appt4 = await db.appointment.findUnique({ where: { id: t4.appt.id } });
    ok(cc.status === 409 && cc.body?.code === "ORDER_STATUS" && appt4?.status === "scheduled", "工艺单已 cancelled → 409 ORDER_STATUS，预约不变", { body: cc.body, appt: appt4?.status });

    console.log("\n[4] 不出金额");
    const raw = JSON.stringify([d0.body, d2, d4]);
    ok(!/grandTotal|"price"|msrp|costPrice/.test(raw), "详情响应无金额字段");
  } finally {
    await db.orderStatusLog.deleteMany({ where: { orderId: { in: createdOrders } } });
    await db.blindsOrder.deleteMany({ where: { id: { in: createdOrders } } });
    await db.appointment.deleteMany({ where: { id: { in: createdAppts } } });
    await db.salesCustomer.deleteMany({ where: { orgId: ORG } });
    await db.auditLog.deleteMany({ where: { OR: [{ userId: { in: users } }, { orgId: ORG }] } });
    await db.principalRoleBinding.deleteMany({ where: { orgId: ORG } });
    await db.roleProfile.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.organizationMember.deleteMany({ where: { orgId: ORG } });
    await db.organization.deleteMany({ where: { id: ORG } }).catch((e) => console.warn("org cleanup:", e instanceof Error ? e.message : e));
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
