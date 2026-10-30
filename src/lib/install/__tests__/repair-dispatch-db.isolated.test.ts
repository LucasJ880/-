/**
 * INSTALL-2e：返修调度——真实 DB（隔离库）+ 真实路由，路径 ② 全链路
 *
 *   [A] 主链路：首装 2 ✅ 1 ⚠ → 维修单 → 出单·Vinyl 登记 → 运营排返修（小王）→ 改期（小李）→ 返修任务只列 Den、范围外 404
 *       → 小李拍照完成收口 → 维修单关闭、工艺单 installed、会计 install_completed + 待收尾款 → 会计确认尾款 → 质保邮件待批准
 *       ；首装任务详情仍可打开；照片代理：小王 / 小李可读，小张 403
 *   [B] 多品类出单：Vinyl 登记后仍 repair_open、待登记布帘；出单·Roller 403；重复 409；布帘登记后 repair_ready_to_schedule；排期提示
 *   [C] 只有客户原因：出单 409 NOT_NEEDED；排返修无提示
 *   [D] 返修中再发现问题：返修任务提交 → R-…-2，原单关闭"转入"；新单待登记出单
 *   [E] 可执行操作 ⇔ 接口：出单·Vinyl / 布帘 / Roller、运营主管、会计 × 登记出单 / 安排返修，列出 ⇔ 2xx；选错人 400；无权 403
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/install/__tests__/repair-dispatch-db.isolated.test.ts
 * 无隔离库时自动跳过。只用虚构数据；照片写入临时本地盘（PRODUCT_CONTENT_LOCAL_STORE=1）。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 INSTALL-2e 返修调度 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "INSTALL-2e repair dispatch DB test" });

process.env.JWT_SECRET = process.env.JWT_SECRET || "install-2e-isolated-test-secret-0123456789abcdef";
const BLOB_DIR = mkdtempSync(path.join(tmpdir(), "install-2e-blobs-"));
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

async function main() {
  const { db } = await import("@/lib/db");
  const { NextRequest } = await import("next/server");
  const { createSession } = await import("@/lib/auth/session");
  const { seedOrgAuthorizationProfiles } = await import("@/lib/authorization/seed-org-profiles");
  const { emptySpec, AUDIT_ACTION_SPEC, AUDIT_TARGET_ORDER } = await import("@/lib/sunny-process/process-spec");
  const { todayInTimeZone } = await import("@/lib/install/balance");
  const { seedWarrantySettings } = await import("@/lib/install/warranty");
  const photoRoute = await import("@/app/api/install/tasks/[id]/items/[itemId]/photo/route");
  const issueRoute = await import("@/app/api/install/tasks/[id]/items/[itemId]/issue/route");
  const repairRoute = await import("@/app/api/install/tasks/[id]/repair/route");
  const completeRoute = await import("@/app/api/install/tasks/[id]/complete/route");
  const detailRoute = await import("@/app/api/install/tasks/[id]/route");
  const tasksRoute = await import("@/app/api/install/tasks/route");
  const repairDetailRoute = await import("@/app/api/install/repairs/[id]/route");
  const repairsRoute = await import("@/app/api/install/repairs/route");
  const issuedRoute = await import("@/app/api/install/repairs/[id]/factory-issued/route");
  const scheduleRoute = await import("@/app/api/install/repairs/[id]/schedule/route");
  const statusRoute = await import("@/app/api/blinds-orders/[id]/install-status/route");
  const balanceRoute = await import("@/app/api/accounting/balance/route");
  const confirmRoute = await import("@/app/api/accounting/balance/[orderId]/confirm/route");
  const filesRoute = await import("@/app/api/files/[...path]/route");

  const stamp = Date.now().toString(36);
  const ORG = `i2eorg_${stamp}`;
  const u = (k: string) => `i2e${k}_${stamp}`;
  const [BOSS, MIKI, ALEX, XW, XL, XZ, OPS, FV, FD, FS] = ["boss", "miki", "alex", "xw", "xl", "xz", "ops", "fv", "fd", "fs"].map(u);
  const users = [BOSS, MIKI, ALEX, XW, XL, XZ, OPS, FV, FD, FS];
  const roleOf = (id: string) => (id === ALEX ? "sales" : "user");
  for (const id of users) {
    await db.user.create({ data: { id, email: `${id}@fixture.test`, name: `Example ${id.split("_")[0]}`, role: roleOf(id) } });
  }
  const warranty = seedWarrantySettings();
  warranty.contact.phone = "416-555-0199";
  warranty.contact.email = "service@fixture.test";
  await db.organization.create({
    data: {
      id: ORG, name: "Example Dispatch Fixture", code: `${ORG}-c`, ownerId: BOSS, industryPackId: "window_covering_services_v1",
      settingsJson: { timezone: "America/Toronto", sunnyWarranty: warranty },
    },
  });
  for (const id of users) await db.organizationMember.create({ data: { orgId: ORG, userId: id, role: "org_member", status: "active" } });
  await seedOrgAuthorizationProfiles(ORG);
  const bind = async (userId: string, key: string) => {
    const profile = await db.roleProfile.findUnique({ where: { orgId_key: { orgId: ORG, key } } });
    if (!profile) throw new Error(`缺岗位模板 ${key}`);
    await db.principalRoleBinding.create({ data: { orgId: ORG, principalType: "HUMAN", principalId: userId, roleProfileId: profile.id, status: "active" } });
  };
  for (const [id, key] of [[BOSS, "owner"], [MIKI, "accounting"], [ALEX, "sales_rep"], [XW, "installer"], [XL, "installer"], [XZ, "installer"], [OPS, "ops_lead"], [FV, "fulfillment_vinyl"], [FD, "fulfillment_drapery"], [FS, "fulfillment_shades"]] as const) {
    await bind(id, key);
  }

  const cust = await db.salesCustomer.create({ data: { orgId: ORG, name: "Example Homeowner", phone: "416-555-0110", email: "homeowner@fixture.test", address: "1 Example Way", createdById: ALEX } });
  const createdOrders: string[] = [];
  const start = new Date(Date.now() + 3600_000);
  const vinyl = (location: string) => ({ location, width: 30, height: 60, panels: 2, openCode: "LR", posts: "", rail1In: null, rail1Ratio: null, rod: "", split: "", frame: "L", frameCount: 4, inOut: "内装", structure: "有框", rail2In: null, quoteFrame: "L", quoteOpenDirection: "", quoteMidRail: "" });
  const drape = (location: string) => ({ location, part: "drape", widthIn: 80, heightIn: 90, sku: "D-01", qty: 2, craft: "韩褶P", layer: "布", liner: "否", fullness: 2.3, mount: "顶装C", rod: "R1", rodColor: "黑" });
  const makeTask = async (code: string, opts: { vinyl?: string[]; drapes?: string[] }) => {
    const appt = await db.appointment.create({
      data: { customerId: cust.id, type: "install", title: `安装 — Example (${code})`, startAt: start, endAt: new Date(start.getTime() + 7200_000), status: "scheduled", assignedToId: XW, createdById: BOSS },
    });
    const order = await db.blindsOrder.create({ data: { code, status: "scheduled", customerName: "Example Homeowner", creatorId: ALEX, customerId: cust.id, appointmentId: appt.id } });
    createdOrders.push(order.id);
    await db.auditLog.create({
      data: { userId: BOSS, orgId: ORG, action: AUDIT_ACTION_SPEC, targetType: AUDIT_TARGET_ORDER, targetId: order.id, afterData: JSON.stringify({ ...emptySpec(), vinyl: (opts.vinyl ?? []).map(vinyl), drapes: (opts.drapes ?? []).map(drape) }) },
    });
    return { appt, order };
  };

  const session = async (uid: string) => `qy_session=${await createSession({ sub: uid, email: `${uid}@fixture.test`, role: roleOf(uid) })}`;
  const parse = async (res: Response) => {
    const text = await res.text();
    let body: Json | null = null;
    try { body = JSON.parse(text) as Json; } catch { body = null; }
    return { status: res.status, body, text };
  };
  const get = async (handler: Handler, uid: string, url: string, params: Record<string, unknown> = {}) => {
    const sep = url.includes("?") ? "&" : "?";
    const r = new NextRequest(`http://localhost${url}${sep}orgId=${ORG}`, { headers: { cookie: await session(uid), "x-forwarded-for": "10.37.0.7" } });
    return parse(await handler(r, { params: Promise.resolve(params) }));
  };
  const post = async (handler: Handler, uid: string, url: string, params: Record<string, string>, body?: FormData | Json) => {
    const isForm = body instanceof FormData;
    const r = new NextRequest(`http://localhost${url}`, {
      method: "POST",
      body: isForm ? body : JSON.stringify({ ...(body ?? {}), orgId: ORG }),
      headers: { cookie: await session(uid), "x-forwarded-for": "10.37.0.7", ...(isForm ? {} : { "content-type": "application/json" }) },
    });
    return parse(await handler(r, { params: Promise.resolve(params) }));
  };
  const jpeg = () => new File([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])], "w.jpg", { type: "image/jpeg" });
  const upload = (uid: string, apptId: string, unitId: string) => {
    const fd = new FormData();
    fd.append("file", jpeg());
    return post(photoRoute.POST as unknown as Handler, uid, `/api/install/tasks/${apptId}/items/${unitId}/photo`, { id: apptId, itemId: unitId }, fd);
  };
  const issue = (uid: string, apptId: string, unitId: string, issueType: string) => {
    const fd = new FormData();
    fd.append("file", jpeg());
    fd.append("issueType", issueType);
    fd.append("description", `${issueType} @ ${unitId}`);
    return post(issueRoute.POST as unknown as Handler, uid, `/api/install/tasks/${apptId}/items/${unitId}/issue`, { id: apptId, itemId: unitId }, fd);
  };
  const header = { customerName: "Example Homeowner", phone: "416-555-0110", notes: "", customerConfirmed: true };
  const submit = (uid: string, apptId: string) => post(repairRoute.POST as unknown as Handler, uid, `/api/install/tasks/${apptId}/repair`, { id: apptId }, header);
  const complete = (uid: string, apptId: string) => post(completeRoute.POST as unknown as Handler, uid, `/api/install/tasks/${apptId}/complete`, { id: apptId });
  const taskDetail = async (uid: string, apptId: string) => {
    const r = await get(detailRoute.GET as unknown as Handler, uid, `/api/install/tasks/${apptId}`, { id: apptId });
    return { status: r.status, task: (r.body?.task ?? {}) as Json & { windows: Array<Json & { itemId: string; location: string; state: string; issue: (Json & { photos: Array<{ proxyUrl: string }> }) | null }>; closeout: Json; returnRepair: Json | null; repair: Json | null } };
  };
  const repairDetail = async (uid: string, id: string) => {
    const r = await get(repairDetailRoute.GET as unknown as Handler, uid, `/api/install/repairs/${id}`, { id });
    return { status: r.status, repair: (r.body?.repair ?? {}) as Json & { stage: string; actions: { issueCategories: Array<{ key: string }>; canSchedule: boolean }; progress: Json & { pending: Array<{ key: string }>; issued: Array<{ key: string; readyDate: string }>; schedule: (Json & { appointmentId: string; assignedTo: { id: string } }) | null; closed: (Json & { reason: string; supersededBy: string | null }) | null } } };
  };
  const issueFactory = (uid: string, id: string, readyDate: string) => post(issuedRoute.POST as unknown as Handler, uid, `/api/install/repairs/${id}/factory-issued`, { id }, { readyDate, note: "已下单" });
  const schedule = (uid: string, id: string, installAt: string, assignedToId: string) => post(scheduleRoute.POST as unknown as Handler, uid, `/api/install/repairs/${id}/schedule`, { id }, { installAt, assignedToId });
  const notes = (userId: string, type: string) => db.notification.findMany({ where: { userId, type }, select: { entityType: true, entityId: true, title: true, summary: true } });
  const today = todayInTimeZone("America/Toronto");
  const plusDays = (n: number, hour = 14) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 11) + `${String(hour).padStart(2, "0")}:00:00.000Z`;
  const firstVisit = async (code: string, spec: { vinyl?: string[]; drapes?: string[] }, done: string[], issues: Array<[string, string]>) => {
    const t = await makeTask(code, spec);
    for (const unit of done) await upload(XW, t.appt.id, unit);
    for (const [unit, type] of issues) await issue(XW, t.appt.id, unit, type);
    const s = await submit(XW, t.appt.id);
    const repair = (s.body?.repair ?? {}) as { id: string; repairNo: string };
    return { ...t, repair, submitStatus: s.status };
  };

  try {
    console.log("\n[A] 主链路");
    const A = await firstVisit(`I2E-A-${stamp}`, { vinyl: ["Living Room", "Den", "Kitchen"] }, ["spec-vinyl-0", "spec-vinyl-2"], [["spec-vinyl-1", "wrong_size"]]);
    ok(A.submitStatus === 200 && A.repair.repairNo === `R-I2E-A-${stamp}-1`, "首装：2 ✅ 1 ⚠ → 维修单 R-…-1", A);
    const a0 = await repairDetail(OPS, A.repair.id);
    ok(a0.repair.stage === "repair_open" && a0.repair.progress.pending.map((p) => p.key).join() === "vinyl", "维修单：返修待出单，待登记 Vinyl", a0.repair.progress);
    const ia = await issueFactory(FV, A.repair.id, plusDays(4).slice(0, 10));
    ok(ia.status === 200 && (ia.body?.categories as string[]).join() === "vinyl" && (ia.body?.pendingCategories as string[]).length === 0, "出单·Vinyl 登记 → 200，无待登记", ia.body);
    ok((await repairDetail(OPS, A.repair.id)).repair.stage === "repair_ready_to_schedule", "登记后：返修待排期");
    const nOpsIssued = await notes(OPS, "install_repair_factory_issued");
    const nAlexIssued = await notes(ALEX, "install_repair_factory_issued");
    ok(nOpsIssued.some((n) => n.entityType === "install_repair" && n.entityId === A.repair.id) && nAlexIssued.some((n) => n.entityType === "blinds_order" && n.entityId === A.order.id), "出单通知：运营主管（维修单详情）、销售（工艺单详情）", [nOpsIssued, nAlexIssued]);
    ok((await notes(FV, "install_repair_factory_issued")).length === 0, "登记人本人不收");

    const s1 = await schedule(OPS, A.repair.id, plusDays(6, 14), XW);
    const apptA = String(s1.body?.appointmentId ?? "");
    const orderA1 = await db.blindsOrder.findUnique({ where: { id: A.order.id } });
    const retAppt = await db.appointment.findUnique({ where: { id: apptA } });
    ok(s1.status === 200 && s1.body?.rescheduled === false && retAppt?.assignedToId === XW && String(retAppt?.title).includes(A.repair.repairNo) && orderA1?.appointmentId === apptA && orderA1.status === "scheduled", "运营排返修：新预约分配给小王、标题含维修单号；工艺单指向它、仍已排期", { body: s1.body, title: retAppt?.title });
    ok((await repairDetail(OPS, A.repair.id)).repair.stage === "repair_scheduled", "排期后：返修已排期");
    const s2 = await schedule(OPS, A.repair.id, plusDays(7, 13), XL);
    const retAppt2 = await db.appointment.findUnique({ where: { id: apptA } });
    const apptCount = await db.appointment.count({ where: { customerId: cust.id, title: { contains: A.repair.repairNo } } });
    ok(s2.status === 200 && s2.body?.rescheduled === true && s2.body?.appointmentId === apptA && retAppt2?.assignedToId === XL && apptCount === 1, "改期：同一条预约改为小李、时间更新，没有新预约", s2.body);
    const nXl = await notes(XL, "install_repair_scheduled");
    ok(nXl.length === 1 && nXl[0].entityType === "install_task" && nXl[0].entityId === apptA, "小李收到返修任务通知（install_task → /install/<预约>）", nXl);
    ok((await notes(ALEX, "install_repair_scheduled")).some((n) => n.entityType === "blinds_order") && (await notes(MIKI, "install_repair_scheduled")).some((n) => n.entityType === "install_repair"), "销售（工艺单）与会计（维修单详情）收到排期通知");
    const st1 = await get(statusRoute.GET as unknown as Handler, ALEX, `/api/blinds-orders/${A.order.id}/install-status`, { id: A.order.id });
    ok(st1.body?.stage === "repair_scheduled" && /^\d{4}-\d{2}-\d{2} 再去返修$/.test(String(st1.body?.salesText)), "销售状态卡：<日期> 再去返修", st1.body);

    const rt = await taskDetail(XL, apptA);
    ok(rt.status === 200 && rt.task.windows.length === 1 && rt.task.windows[0].location === "Den" && (rt.task.returnRepair as Json)?.repairNo === A.repair.repairNo && (rt.task.closeout as Json).total === 1 && (rt.task.closeout as Json).completed === 0, "返修任务：只列 Den，0 / 1，标明返修单号", rt.task);
    const xlList = await get(tasksRoute.GET as unknown as Handler, XL, `/api/install/tasks`);
    const xlTask = ((xlList.body?.tasks ?? []) as Array<Json & { id: string; order: Json; returnRepair: Json | null }>).find((t) => t.id === apptA);
    ok(xlTask?.returnRepair?.repairNo === A.repair.repairNo && xlTask.order.windowCount === 1, "小李的任务列表：返修任务计数 0 / 1", xlTask);
    const outOfScope = await upload(XL, apptA, "spec-vinyl-2");
    ok(outOfScope.status === 404, "返修范围外拍照 → 404", outOfScope.body);
    const first = await taskDetail(XW, A.appt.id);
    ok(first.status === 200 && first.task.windows.length === 3 && (first.task.repair as Json)?.repairNo === A.repair.repairNo, "首装任务详情仍可打开（3 个单元、带维修单号）", first.status);

    // 照片代理：首装小王、返修小李可读；小张 403
    const issuePhoto = first.task.windows.find((w) => w.itemId === "spec-vinyl-1")?.issue?.photos?.[0]?.proxyUrl ?? "";
    const segs = issuePhoto.replace(/^\/api\/files\//, "").split("/");
    const fileAs = (uid: string) => get(filesRoute.GET as unknown as Handler, uid, issuePhoto, { path: segs });
    const [fXw, fXl, fXz] = await Promise.all([fileAs(XW), fileAs(XL), fileAs(XZ)]);
    ok(issuePhoto.startsWith("/api/files/install-photos/") && fXw.status === 200 && fXl.status === 200 && fXz.status === 403, "照片代理：小王 200、小李 200、小张 403", [fXw.status, fXl.status, fXz.status]);

    ok((await upload(XL, apptA, "spec-vinyl-1")).status === 200, "小李给 Den 拍完工照");
    const c1 = await complete(XL, apptA);
    const orderA2 = await db.blindsOrder.findUnique({ where: { id: A.order.id } });
    const closedEv = await db.auditLog.findFirst({ where: { action: "install.repair.completed", targetId: A.order.id } });
    const doneEv = await db.auditLog.findFirst({ where: { action: "install.task.completed", targetType: "appointment", targetId: apptA } });
    ok(c1.status === 200 && orderA2?.status === "installed" && !!orderA2.installedAt && JSON.parse(closedEv?.afterData ?? "{}").reason === "completed" && JSON.parse(doneEv?.afterData ?? "{}").outcome === "repair_completed", "返修收口：维修单关闭、工艺单 installed、结果 repair_completed", c1.body);
    ok((await db.orderStatusLog.count({ where: { orderId: A.order.id, toStatus: "installed", note: { contains: "返修完成" } } })) === 1, "状态日志：返修完成");
    ok((await notes(MIKI, "install_completed")).some((n) => n.entityId === A.order.id) && (await notes(ALEX, "install_completed")).some((n) => n.entityId === A.order.id), "会计收到待收尾款、销售收到已装完（2b 完工通知）");
    const bal = await get(balanceRoute.GET as unknown as Handler, MIKI, `/api/accounting/balance`);
    ok(((bal.body?.pending ?? []) as Array<{ orderId: string }>).some((p) => p.orderId === A.order.id), "会计「待收尾款」出现该单");
    const st2 = await get(statusRoute.GET as unknown as Handler, ALEX, `/api/blinds-orders/${A.order.id}/install-status`, { id: A.order.id });
    ok(st2.body?.stage === "awaiting_balance" && st2.body?.salesText === "已装完，收尾款", "阶段：待收尾款", st2.body);
    const ac = await post(confirmRoute.POST as unknown as Handler, MIKI, `/api/accounting/balance/${A.order.id}/confirm`, { orderId: A.order.id }, { amount: 1200, method: "visa", receivedAt: today });
    ok(ac.status === 200 && (ac.body?.warranty as Json)?.status === "pending_approval", "会计确认尾款 → 质保邮件待批准（路径 ② 接上 2b / 2c）", ac.body);
    ok((await repairDetail(OPS, A.repair.id)).repair.progress.closed?.reason === "completed", "维修单详情：已关闭（已完成）");
    ok((await schedule(OPS, A.repair.id, plusDays(8), XL)).status === 409, "已关闭的维修单排返修 → 409");

    console.log("\n[B] 多品类出单");
    const B = await firstVisit(`I2E-B-${stamp}`, { vinyl: ["Den"], drapes: ["Bedroom"] }, [], [["spec-vinyl-0", "wrong_size"], ["spec-drapes-0", "wrong_color"]]);
    const ib1 = await issueFactory(FV, B.repair.id, plusDays(3).slice(0, 10));
    const b1 = await repairDetail(OPS, B.repair.id);
    ok(ib1.status === 200 && (ib1.body?.categories as string[]).join() === "vinyl" && b1.repair.stage === "repair_open" && b1.repair.progress.pending.map((p) => p.key).join() === "drapery", "Vinyl 登记后：仍返修待出单，待登记布帘", b1.repair.progress);
    ok((await issueFactory(FS, B.repair.id, plusDays(3).slice(0, 10))).status === 403, "出单·Roller（不相关品类）→ 403");
    const again = await issueFactory(FV, B.repair.id, plusDays(3).slice(0, 10));
    ok(again.status === 409 && again.body?.code === "ALREADY_ISSUED", "出单·Vinyl 再登记 → 409 ALREADY_ISSUED", again.body);
    const sB = await schedule(OPS, B.repair.id, plusDays(2), XW);
    ok(sB.status === 200 && (sB.body?.warnings as string[]).join().includes("出单尚未登记：布帘"), "布帘未登记时排返修 → 200 + 提示", sB.body);
    ok((await issueFactory(FD, B.repair.id, plusDays(5).slice(0, 10))).status === 200, "出单·布帘登记 → 200");
    const b2 = await repairDetail(OPS, B.repair.id);
    ok(b2.repair.progress.pending.length === 0 && b2.repair.progress.issued.length === 2 && b2.repair.stage === "repair_scheduled", "全部登记：无待登记；已排返修仍为返修已排期", b2.repair.progress);
    const issuedBefore = await db.auditLog.count({ where: { action: "install.repair.factory_issued", targetId: B.order.id } });
    const noMore = await issueFactory(FD, B.repair.id, "2020-01-01");
    ok(noMore.status === 409 && noMore.body?.code === "ALREADY_ISSUED" && (await db.auditLog.count({ where: { action: "install.repair.factory_issued", targetId: B.order.id } })) === issuedBefore, "布帘已登记后再登记 → 409，不写记录", noMore.body);

    console.log("\n[C] 只有客户原因");
    const C = await firstVisit(`I2E-C-${stamp}`, { vinyl: ["Porch"] }, [], [["spec-vinyl-0", "customer"]]);
    const ic = await issueFactory(FV, C.repair.id, plusDays(3).slice(0, 10));
    ok(ic.status === 409 && ic.body?.code === "NOT_NEEDED", "出单 → 409 NOT_NEEDED", ic.body);
    const sC = await schedule(OPS, C.repair.id, plusDays(3), XW);
    ok(sC.status === 200 && (sC.body?.warnings as string[]).length === 0, "排返修无提示", sC.body);

    console.log("\n[D] 返修中再发现问题");
    const D = await firstVisit(`I2E-D-${stamp}`, { vinyl: ["Den"] }, [], [["spec-vinyl-0", "wrong_size"]]);
    const sD = await schedule(OPS, D.repair.id, plusDays(4), XW);
    const apptD = String(sD.body?.appointmentId ?? "");
    await issue(XW, apptD, "spec-vinyl-0", "damaged");
    const d2 = await submit(XW, apptD);
    const rep2 = (d2.body?.repair ?? {}) as { id: string; repairNo: string };
    const d1 = await repairDetail(OPS, D.repair.id);
    const d2d = await repairDetail(OPS, rep2.id);
    ok(d2.status === 200 && rep2.repairNo === `R-I2E-D-${stamp}-2`, "返修任务提交 → R-…-2", d2.body);
    ok(d1.repair.progress.closed?.reason === "superseded" && d1.repair.progress.closed.supersededBy === rep2.repairNo, "原单关闭：转入 R-…-2", d1.repair.progress.closed);
    ok(d2d.repair.progress.pending.map((p) => p.key).join() === "vinyl" && d2d.repair.stage === "repair_open" && d2d.repair.progress.closed === null, "新单待登记出单，阶段返修待出单", d2d.repair);
    const orderD = await db.blindsOrder.findUnique({ where: { id: D.order.id } });
    ok(orderD?.status === "scheduled", "工艺单仍已排期");

    console.log("\n[E] 可执行操作 ⇔ 接口");
    const E = await firstVisit(`I2E-E-${stamp}`, { vinyl: ["Den"], drapes: ["Bedroom"] }, [], [["spec-vinyl-0", "wrong_size"], ["spec-drapes-0", "wrong_color"]]);
    const badDate = await issueFactory(FV, E.repair.id, "2020-01-01");
    ok(badDate.status === 400 && (await db.auditLog.count({ where: { action: "install.repair.factory_issued", targetId: E.order.id } })) === 0, "预计备好日早于填写日 → 400，不写记录", badDate.body);
    const roles = [["出单·Vinyl", FV], ["出单·布帘", FD], ["出单·Roller", FS], ["运营主管", OPS], ["会计", MIKI]] as const;
    const snapshot = new Map<string, { issue: boolean; schedule: boolean }>();
    for (const [, uid] of roles) {
      const a = (await repairDetail(uid, E.repair.id)).repair.actions;
      snapshot.set(uid, { issue: a.issueCategories.length > 0, schedule: a.canSchedule });
    }
    ok(snapshot.get(FV)!.issue && snapshot.get(FD)!.issue && !snapshot.get(FS)!.issue && !snapshot.get(OPS)!.issue && snapshot.get(OPS)!.schedule && snapshot.get(MIKI)!.schedule && !snapshot.get(FV)!.schedule, "可执行操作：出单岗只能登记自己的品类，运营 / 会计能排返修", Object.fromEntries(snapshot));
    for (const [name, uid] of roles) {
      const r = await issueFactory(uid, E.repair.id, plusDays(3).slice(0, 10));
      ok(snapshot.get(uid)!.issue === (r.status === 200), `${name}：登记出单 列出 ⇔ 2xx`, [snapshot.get(uid), r.status]);
    }
    for (const [name, uid] of roles) {
      const r = await schedule(uid, E.repair.id, plusDays(5), XW);
      ok(snapshot.get(uid)!.schedule === (r.status === 200), `${name}：安排返修 列出 ⇔ 2xx`, [snapshot.get(uid), r.status]);
    }
    const wrongPerson = await schedule(OPS, E.repair.id, plusDays(5), ALEX);
    ok(wrongPerson.status === 400 && wrongPerson.body?.code === "NOT_INSTALLER", "选一位销售 → 400 NOT_INSTALLER", wrongPerson.body);
    const list = await get(repairsRoute.GET as unknown as Handler, OPS, `/api/install/repairs`);
    const le = ((list.body?.repairs ?? []) as Array<Json & { id: string; pendingFactory: unknown[]; scheduledAt: string | null; closed: unknown }>).find((r) => r.id === E.repair.id);
    ok(!!le && Array.isArray(le.pendingFactory) && le.pendingFactory.length === 0 && !!le.scheduledAt && le.closed === null, "列表：待登记品类、返修时间、关闭情况", le);
    const allText = JSON.stringify(await db.notification.findMany({ where: { userId: { in: users }, type: { in: ["install_repair_factory_issued", "install_repair_scheduled"] } }, select: { title: true, summary: true } }));
    ok(!/\$|grandTotal|尾款金额/.test(allText), "出单 / 排期通知不含金额");
  } finally {
    await db.notification.deleteMany({ where: { userId: { in: users } } });
    await db.orderStatusLog.deleteMany({ where: { orderId: { in: createdOrders } } });
    await db.blindsOrder.deleteMany({ where: { id: { in: createdOrders } } });
    await db.appointment.deleteMany({ where: { customerId: cust.id } });
    await db.pendingAction.deleteMany({ where: { orgId: ORG } });
    await db.salesCustomer.deleteMany({ where: { orgId: ORG } });
    await db.auditLog.deleteMany({ where: { OR: [{ userId: { in: users } }, { orgId: ORG }] } });
    await db.principalRoleBinding.deleteMany({ where: { orgId: ORG } });
    await db.roleProfile.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.organizationMember.deleteMany({ where: { orgId: ORG } });
    await db.organization.deleteMany({ where: { id: ORG } }).catch((e) => console.warn("org cleanup:", e instanceof Error ? e.message : e));
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
