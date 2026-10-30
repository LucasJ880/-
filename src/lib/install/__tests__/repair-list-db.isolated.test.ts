/**
 * INSTALL-2i：维修单列表分栏（进行中 / 已归档）、分页、搜索——真实 DB（隔离库）+ 真实路由
 *
 *   [1] 安装工请求列表 → 403
 *   [2] 关闭后自动归档：真实首装提交维修单 → 进行中栏有它 → 运营主管作废 → 进行中栏没有、总数减 1；已归档栏第一条是它
 *   [3] 已归档结束情况：按单号搜索已归档栏 → 已作废、原因说明、关闭人、关闭时间，不标已过目标日
 *   [4] 分页：205 张进行中（无 200 上限）→ 每页 50 第 5 页 5 条、第 6 页空、总数 205；跨页按目标日升序
 *   [5] 搜索：客户名一部分（大小写不同）/ 单号 / 工艺单号 → 只返回匹配的；两栏总数按搜索结果
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/install/__tests__/repair-list-db.isolated.test.ts
 * 无隔离库时自动跳过。只用虚构数据；照片写入临时本地盘（PRODUCT_CONTENT_LOCAL_STORE=1）。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 INSTALL-2i 维修单列表 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "INSTALL-2i repair list DB test" });

process.env.JWT_SECRET = process.env.JWT_SECRET || "install-2i-isolated-test-secret-0123456789abcdef";
const BLOB_DIR = mkdtempSync(path.join(tmpdir(), "install-2i-blobs-"));
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
type ListItem = Json & {
  id: string;
  repairNo: string;
  orderCode: string;
  customerName: string;
  targetDate: string;
  overdue: boolean;
  closed: (Json & { reason: string; label: string; note: string; at: string; by: { id: string; name: string | null } }) | null;
};
type ListBody = { repairs: ListItem[]; total: number; page: number; pageSize: number; tab: string; counts: { open: number; archived: number } };

async function main() {
  const { db } = await import("@/lib/db");
  const { NextRequest } = await import("next/server");
  const { createSession } = await import("@/lib/auth/session");
  const { seedOrgAuthorizationProfiles } = await import("@/lib/authorization/seed-org-profiles");
  const { emptySpec, AUDIT_ACTION_SPEC, AUDIT_TARGET_ORDER } = await import("@/lib/sunny-process/process-spec");
  const { INSTALL_REPAIR_SUBMITTED, REPAIR_TARGET_TYPE } = await import("@/lib/install/repair");
  const photoRoute = await import("@/app/api/install/tasks/[id]/items/[itemId]/photo/route");
  const issueRoute = await import("@/app/api/install/tasks/[id]/items/[itemId]/issue/route");
  const repairRoute = await import("@/app/api/install/tasks/[id]/repair/route");
  const repairsRoute = await import("@/app/api/install/repairs/route");
  const voidRoute = await import("@/app/api/install/repairs/[id]/void/route");

  const stamp = Date.now().toString(36);
  const ORG = `i2iorg_${stamp}`;
  const u = (k: string) => `i2i${k}_${stamp}`;
  const [BOSS, ALEX, XW, OPS] = ["boss", "alex", "xw", "ops"].map(u);
  const users = [BOSS, ALEX, XW, OPS];
  const roleOf = (id: string) => (id === ALEX ? "sales" : "user");
  for (const id of users) {
    await db.user.create({ data: { id, email: `${id}@fixture.test`, name: `Example ${id.split("_")[0]}`, role: roleOf(id) } });
  }
  await db.organization.create({
    data: { id: ORG, name: "Example List Fixture", code: `${ORG}-c`, ownerId: BOSS, industryPackId: "window_covering_services_v1", settingsJson: { timezone: "America/Toronto" } },
  });
  for (const id of users) await db.organizationMember.create({ data: { orgId: ORG, userId: id, role: "org_member", status: "active" } });
  await seedOrgAuthorizationProfiles(ORG);
  for (const [id, key] of [[BOSS, "owner"], [ALEX, "sales_rep"], [XW, "installer"], [OPS, "ops_lead"]] as const) {
    const profile = await db.roleProfile.findUnique({ where: { orgId_key: { orgId: ORG, key } } });
    if (!profile) throw new Error(`缺岗位模板 ${key}`);
    await db.principalRoleBinding.create({ data: { orgId: ORG, principalType: "HUMAN", principalId: id, roleProfileId: profile.id, status: "active" } });
  }

  const cust = await db.salesCustomer.create({ data: { orgId: ORG, name: "Example Homeowner", phone: "416-555-0110", email: "homeowner@fixture.test", address: "1 Example Way", createdById: ALEX } });
  const createdOrders: string[] = [];
  const start = new Date(Date.now() + 3600_000);
  const vinyl = (location: string) => ({ location, width: 30, height: 60, panels: 2, openCode: "LR", posts: "", rail1In: null, rail1Ratio: null, rod: "", split: "", frame: "L", frameCount: 4, inOut: "内装", structure: "有框", rail2In: null, quoteFrame: "L", quoteOpenDirection: "", quoteMidRail: "" });
  const makeOrder = async (code: string, locations: string[]) => {
    const appt = await db.appointment.create({
      data: { customerId: cust.id, type: "install", title: `安装 — Example (${code})`, startAt: start, endAt: new Date(start.getTime() + 7200_000), status: "scheduled", assignedToId: XW, createdById: BOSS },
    });
    const order = await db.blindsOrder.create({ data: { code, status: "scheduled", customerName: "Example Homeowner", creatorId: ALEX, customerId: cust.id, appointmentId: appt.id } });
    createdOrders.push(order.id);
    await db.auditLog.create({ data: { userId: BOSS, orgId: ORG, action: AUDIT_ACTION_SPEC, targetType: AUDIT_TARGET_ORDER, targetId: order.id, afterData: JSON.stringify({ ...emptySpec(), vinyl: locations.map(vinyl) }) } });
    return { appt, order };
  };

  const session = async (uid: string) => `qy_session=${await createSession({ sub: uid, email: `${uid}@fixture.test`, role: roleOf(uid) })}`;
  const parse = async (res: Response) => {
    const text = await res.text();
    let body: Json | null = null;
    try { body = JSON.parse(text) as Json; } catch { body = null; }
    return { status: res.status, body };
  };
  const post = async (handler: Handler, uid: string, url: string, params: Record<string, string>, body?: FormData | Json) => {
    const isForm = body instanceof FormData;
    const r = new NextRequest(`http://localhost${url}`, {
      method: "POST",
      body: isForm ? body : JSON.stringify({ ...(body ?? {}), orgId: ORG }),
      headers: { cookie: await session(uid), "x-forwarded-for": "10.38.0.7", ...(isForm ? {} : { "content-type": "application/json" }) },
    });
    return parse(await handler(r, { params: Promise.resolve(params) }));
  };
  const list = async (uid: string, qs: Record<string, string> = {}) => {
    const params = new URLSearchParams({ ...qs, orgId: ORG });
    const r = new NextRequest(`http://localhost/api/install/repairs?${params}`, { headers: { cookie: await session(uid), "x-forwarded-for": "10.38.0.7" } });
    const res = await parse(await (repairsRoute.GET as unknown as Handler)(r, { params: Promise.resolve({}) }));
    return { status: res.status, body: (res.body ?? {}) as unknown as ListBody };
  };
  const jpeg = () => new File([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])], "w.jpg", { type: "image/jpeg" });
  const firstVisit = async (code: string, customerName: string) => {
    const t = await makeOrder(code, ["Living Room", "Den"]);
    const up = new FormData();
    up.append("file", jpeg());
    await post(photoRoute.POST as unknown as Handler, XW, `/api/install/tasks/${t.appt.id}/items/spec-vinyl-0/photo`, { id: t.appt.id, itemId: "spec-vinyl-0" }, up);
    const is = new FormData();
    is.append("file", jpeg());
    is.append("issueType", "wrong_size");
    is.append("description", "Den 尺寸不对");
    await post(issueRoute.POST as unknown as Handler, XW, `/api/install/tasks/${t.appt.id}/items/spec-vinyl-1/issue`, { id: t.appt.id, itemId: "spec-vinyl-1" }, is);
    const s = await post(repairRoute.POST as unknown as Handler, XW, `/api/install/tasks/${t.appt.id}/repair`, { id: t.appt.id }, { customerName, phone: "416-555-0110", notes: "", customerConfirmed: true });
    return { ...t, repair: (s.body?.repair ?? {}) as { id: string; repairNo: string }, submitStatus: s.status };
  };

  try {
    console.log("\n[1] 权限");
    ok((await list(XW)).status === 403, "安装工请求列表 → 403");

    console.log("\n[2] 关闭后自动归档");
    const V = await firstVisit(`I2I-V-${stamp}`, "Jane Pemberton");
    const W = await firstVisit(`I2I-W-${stamp}`, "Example Homeowner");
    ok(V.submitStatus === 200 && W.submitStatus === 200, "两张维修单提交成功", [V.repair, W.repair]);
    const before = await list(OPS);
    ok(before.status === 200 && before.body.tab === "open" && before.body.page === 1 && before.body.pageSize === 20, "默认：进行中、第 1 页、每页 20", before.body);
    ok(before.body.repairs.some((r) => r.id === V.repair.id) && before.body.counts.open === 2 && before.body.counts.archived === 0 && before.body.total === 2, "作废前：进行中 2、已归档 0", before.body.counts);
    const v = await post(voidRoute.POST as unknown as Handler, OPS, `/api/install/repairs/${V.repair.id}/void`, { id: V.repair.id }, { reason: "Den 标错了，实际没问题" });
    ok(v.status === 200, "运营主管作废 → 200", v.body);
    const after = await list(OPS);
    ok(!after.body.repairs.some((r) => r.id === V.repair.id) && after.body.total === 1 && after.body.counts.open === 1 && after.body.counts.archived === 1, "进行中栏不再有它、总数减 1；已归档 1", after.body.counts);
    const arc = await list(OPS, { tab: "archived" });
    ok(arc.body.tab === "archived" && arc.body.repairs[0]?.id === V.repair.id && arc.body.total === 1, "已归档栏第一条是它", arc.body.repairs.map((r) => r.repairNo));

    console.log("\n[3] 已归档维修单的结束情况");
    const found = await list(OPS, { tab: "archived", q: V.repair.repairNo });
    const item = found.body.repairs[0];
    ok(
      found.body.repairs.length === 1 &&
        item?.closed?.reason === "voided" &&
        item.closed.label === "已作废" &&
        item.closed.note === "Den 标错了，实际没问题" &&
        item.closed.by?.id === OPS &&
        item.closed.by.name === `Example ${OPS.split("_")[0]}` &&
        !!item.closed.at &&
        item.overdue === false,
      "按单号搜已归档：已作废、原因说明、关闭人、关闭时间，不标已过目标日",
      item,
    );
    ok(!JSON.stringify(found.body).match(/\$|grandTotal|proxyUrl/), "列表不出金额、不出照片地址");

    console.log("\n[4] 分页（无 200 上限）");
    const bulk = await makeOrder(`I2I-BULK-${stamp}`, ["Bulk"]);
    const base = new Date("2026-12-01T00:00:00Z").getTime();
    await db.auditLog.createMany({
      data: Array.from({ length: 205 }, (_, i) => ({
        userId: XW,
        orgId: ORG,
        action: INSTALL_REPAIR_SUBMITTED,
        targetType: REPAIR_TARGET_TYPE,
        targetId: bulk.order.id,
        afterData: JSON.stringify({
          repairNo: `R-I2I-BULK-${stamp}-${i + 1}`,
          seq: i + 1,
          orderId: bulk.order.id,
          orderCode: bulk.order.code,
          appointmentId: `fake-appt-${i}`,
          header: { customerName: "Bulkfixture Customer", phone: "416-555-0199", notes: "", takenById: XW },
          rows: [{ n: 1, unitId: "spec-vinyl-0", itemNumber: 1, section: "vinyl", location: "Bulk", description: "fixture", issueType: "wrong_size", needsFactory: true, category: "vinyl", photos: [] }],
          fillDate: "2026-10-29",
          customerPreferredDate: null,
          targetDate: new Date(base + (i % 60) * 86_400_000).toISOString().slice(0, 10),
          customerConfirmed: false,
        }),
      })),
    });
    const p5 = await list(OPS, { q: "bulkfixture", pageSize: "50", page: "5" });
    ok(p5.status === 200 && p5.body.repairs.length === 5 && p5.body.total === 205 && p5.body.counts.open === 205 && p5.body.counts.archived === 0, "205 张进行中：每页 50 第 5 页 5 条、总数 205", { n: p5.body.repairs.length, total: p5.body.total, counts: p5.body.counts });
    const p6 = await list(OPS, { q: "bulkfixture", pageSize: "50", page: "6" });
    ok(p6.body.repairs.length === 0 && p6.body.total === 205, "第 6 页空列表、总数仍 205");
    const p1 = await list(OPS, { q: "bulkfixture", pageSize: "50", page: "1" });
    const p2 = await list(OPS, { q: "bulkfixture", pageSize: "50", page: "2" });
    const seq = [...p1.body.repairs, ...p2.body.repairs].map((r) => r.targetDate);
    ok(seq.length === 100 && seq.every((d, i) => i === 0 || seq[i - 1] <= d), "跨页按目标日升序");
    const all = await list(OPS, { pageSize: "500" });
    ok(all.body.pageSize === 50 && all.body.repairs.length === 50 && all.body.counts.open === 206, "pageSize=500 → 每页 50；进行中总数 206（无 200 上限）", all.body.counts);

    console.log("\n[5] 搜索");
    const byName = await list(OPS, { q: "JANE pem" });
    ok(byName.body.repairs.length === 0 && byName.body.counts.open === 0 && byName.body.counts.archived === 1, "客户名一部分（大小写不同）：进行中 0、已归档 1", byName.body.counts);
    const byNameArc = await list(OPS, { q: "JANE pem", tab: "archived" });
    ok(byNameArc.body.repairs.map((r) => r.id).join() === V.repair.id, "已归档栏只返回该客户的单");
    const byNo = await list(OPS, { q: W.repair.repairNo.toLowerCase() });
    ok(byNo.body.repairs.map((r) => r.id).join() === W.repair.id && byNo.body.counts.archived === 0, "单号（小写）→ 只返回那一张", byNo.body.counts);
    const byOrder = await list(OPS, { q: `i2i-w-${stamp}` });
    ok(byOrder.body.repairs.map((r) => r.id).join() === W.repair.id && byOrder.body.repairs[0].orderCode === `I2I-W-${stamp}`, "工艺单号 → 只返回该工艺单的维修单");
    const none = await list(OPS, { q: "no-such-repair" });
    ok(none.body.repairs.length === 0 && none.body.counts.open === 0 && none.body.counts.archived === 0, "无匹配 → 两栏都是 0");
  } finally {
    await db.notification.deleteMany({ where: { userId: { in: users } } });
    await db.orderStatusLog.deleteMany({ where: { orderId: { in: createdOrders } } });
    await db.blindsOrder.deleteMany({ where: { id: { in: createdOrders } } });
    await db.appointment.deleteMany({ where: { customerId: cust.id } });
    await db.salesCustomer.deleteMany({ where: { orgId: ORG } });
    await db.auditLog.deleteMany({ where: { OR: [{ userId: { in: users } }, { orgId: ORG }] } });
    await db.principalRoleBinding.deleteMany({ where: { orgId: ORG } });
    await db.roleProfile.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.organizationMember.deleteMany({ where: { orgId: ORG } });
    await db.organization.deleteMany({ where: { id: ORG } }).catch(() => undefined);
    await db.user.deleteMany({ where: { id: { in: users } } }).catch(() => undefined);
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
