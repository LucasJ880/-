/**
 * INSTALL-2f：维修单作废 / 关闭不返修 / 逾期提醒——真实 DB（隔离库）+ 真实路由
 *
 *   [A] 作废（未排返修）：无权 403 / 缺原因 400 / 超长 400 → 作废 200 → 首装预约回到已排期、工艺单不动 → 再作废 / 再关闭 409
 *       → 通知（出单·Vinyl / 会计 / 老板 → 维修单；销售 → 工艺单；小王 → 首装任务；操作人不收；不带原因与金额）每人点得上
 *       → 任务详情带已作废提示 → 补拍完成收口 → 已安装 → 待收尾款；完成后不带已作废的单、再提交 409；列表关闭原因
 *   [B] 作废（已排返修）+ 并发：一个 200 一个 409；返修预约取消；工艺单指回首装、安装日期恢复；小李通知点得上；重新提交 → R-…-2
 *   [C] 关闭不返修（已排返修）：403 / 400 → 200 → 返修预约取消、工艺单 installed、状态日志、完工通知、待收尾款、阶段；
 *       通知不带原因；已取消的返修任务完成收口 409
 *   [D] 关闭不返修（未排返修）→ 已安装、没有新预约
 *   [E] 返修中提交的不能作废（409 RETURN_VISIT）；岗位 × 作废 / 关闭不返修：列出 ⇔ 2xx
 *   [H] 他企业 404；工艺单不是已排期 / 提交预约已取消 → 409 ORDER_STATUS（不写记录）
 *   [F] 逾期提醒：未排 / 明天已排 / 返修日已过 / 已关闭 / 一天一条 / 第二天再一条；挂在每日简报定时任务
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/install/__tests__/repair-close-db.isolated.test.ts
 * 无隔离库时自动跳过。只用虚构数据；照片写入临时本地盘（PRODUCT_CONTENT_LOCAL_STORE=1）。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 INSTALL-2f 作废 / 关闭不返修 / 逾期提醒 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "INSTALL-2f repair close DB test" });

process.env.JWT_SECRET = process.env.JWT_SECRET || "install-2f-isolated-test-secret-0123456789abcdef";
const BLOB_DIR = mkdtempSync(path.join(tmpdir(), "install-2f-blobs-"));
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
  const voidRoute = await import("@/app/api/install/repairs/[id]/void/route");
  const closeRoute = await import("@/app/api/install/repairs/[id]/close/route");
  const { remindOverdueRepairs } = await import("@/lib/install/repair-service");
  const { readFileSync } = await import("node:fs");

  const stamp = Date.now().toString(36);
  const ORG = `i2forg_${stamp}`;
  const u = (k: string) => `i2f${k}_${stamp}`;
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
      id: ORG, name: "Example Close Fixture", code: `${ORG}-c`, ownerId: BOSS, industryPackId: "window_covering_services_v1",
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
    return { status: r.status, task: (r.body?.task ?? {}) as Json & { windows: Array<Json & { itemId: string; location: string; state: string; issue: (Json & { photos: Array<{ proxyUrl: string }> }) | null }>; closeout: Json; returnRepair: Json | null; repair: Json | null; voidedRepair: (Json & { repairNo: string; note: string }) | null; status: string } };
  };
  const repairDetail = async (uid: string, id: string) => {
    const r = await get(repairDetailRoute.GET as unknown as Handler, uid, `/api/install/repairs/${id}`, { id });
    return { status: r.status, repair: (r.body?.repair ?? {}) as Json & { stage: string; actions: { issueCategories: Array<{ key: string }>; canSchedule: boolean; canVoid: boolean; canClose: boolean }; progress: Json & { pending: Array<{ key: string }>; issued: Array<{ key: string; readyDate: string }>; schedule: (Json & { appointmentId: string; assignedTo: { id: string } }) | null; closed: (Json & { reason: string; label: string; note: string; by: { id: string }; supersededBy: string | null }) | null } } };
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

  const voidR = (uid: string, id: string, reason?: string) => post(voidRoute.POST as unknown as Handler, uid, `/api/install/repairs/${id}/void`, { id }, reason === undefined ? {} : { reason });
  const closeR = (uid: string, id: string, reason?: string) => post(closeRoute.POST as unknown as Handler, uid, `/api/install/repairs/${id}/close`, { id }, reason === undefined ? {} : { reason });
  const status = (uid: string, orderId: string) => get(statusRoute.GET as unknown as Handler, uid, `/api/blinds-orders/${orderId}/install-status`, { id: orderId });
  const closedNotes = (userId: string) => db.notification.findMany({ where: { userId, type: "install_repair_closed" }, select: { entityType: true, entityId: true, title: true, summary: true } });
  const closeEvents = (orderId: string) => db.auditLog.findMany({ where: { action: "install.repair.completed", targetId: orderId }, select: { afterData: true } });
  const inBalance = async (orderId: string) => {
    const bal = await get(balanceRoute.GET as unknown as Handler, MIKI, `/api/accounting/balance`);
    return ((bal.body?.pending ?? []) as Array<{ orderId: string }>).some((p) => p.orderId === orderId);
  };

  try {
    console.log("\n[A] 作废（未排返修）→ 首装任务重新打开 → 补完收口 → 已安装");
    const A = await firstVisit(`I2F-A-${stamp}`, { vinyl: ["Living Room", "Den", "Kitchen"] }, ["spec-vinyl-0", "spec-vinyl-2"], [["spec-vinyl-1", "wrong_size"]]);
    ok(A.submitStatus === 200 && A.repair.repairNo === `R-I2F-A-${stamp}-1`, "首装：2 ✅ 1 ⚠ → R-…-1", A.repair);
    const aFv = await voidR(FV, A.repair.id, "出单岗作废");
    const aNoReason = await voidR(OPS, A.repair.id, "   ");
    const aAppt0 = await db.appointment.findUnique({ where: { id: A.appt.id } });
    ok(aFv.status === 403 && aNoReason.status === 400 && (await repairDetail(OPS, A.repair.id)).repair.progress.closed === null && aAppt0?.status === "completed", "出单·Vinyl 作废 → 403；缺原因 → 400；维修单仍未关闭、预约不变", [aFv.status, aNoReason.status, aAppt0?.status]);
    const aLong = await voidR(OPS, A.repair.id, "x".repeat(501));
    ok(aLong.status === 400, "原因超过 500 字 → 400", aLong.body);
    const logs0 = await db.orderStatusLog.count({ where: { orderId: A.order.id } });
    const av = await voidR(OPS, A.repair.id, "Den 标错了，实际没问题");
    const aAppt1 = await db.appointment.findUnique({ where: { id: A.appt.id } });
    const aOrder1 = await db.blindsOrder.findUnique({ where: { id: A.order.id } });
    ok(av.status === 200 && av.body?.reason === "voided" && av.body?.reopenedAppointmentId === A.appt.id && av.body?.cancelledAppointmentId === null, "运营主管作废 → 200", av.body);
    ok(aAppt1?.status === "scheduled" && aAppt1.completedAt === null && aOrder1?.status === "scheduled" && aOrder1.appointmentId === A.appt.id && (await db.orderStatusLog.count({ where: { orderId: A.order.id } })) === logs0, "首装预约回到已排期、无完成时间；工艺单仍已排期、不写状态日志", { appt: aAppt1?.status, order: aOrder1?.status });
    const ad = await repairDetail(OPS, A.repair.id);
    ok(ad.repair.progress.closed?.reason === "voided" && ad.repair.progress.closed.label === "已作废" && ad.repair.progress.closed.note === "Den 标错了，实际没问题" && ad.repair.progress.closed.by.id === OPS, "详情：已作废、原因说明、操作人", ad.repair.progress.closed);
    ok(!ad.repair.actions.canVoid && !ad.repair.actions.canClose && !ad.repair.actions.canSchedule && ad.repair.actions.issueCategories.length === 0, "已作废：没有可执行操作", ad.repair.actions);
    const aSt = await status(ALEX, A.order.id);
    ok(aSt.body?.stage === "scheduled", "阶段回到已排期（销售状态卡）", aSt.body);
    const aAgain = await voidR(OPS, A.repair.id, "再作废一次");
    ok(aAgain.status === 409 && aAgain.body?.code === "CLOSED", "再作废 → 409 CLOSED", aAgain.body);
    const aCloseAgain = await closeR(OPS, A.repair.id, "再关闭");
    ok(aCloseAgain.status === 409 && aCloseAgain.body?.code === "CLOSED", "已作废再关闭不返修 → 409 CLOSED", aCloseAgain.body);
    // 通知：提交时的收件人（出单·Vinyl、运营已是操作人、会计、老板）→ 维修单详情；销售 → 工艺单；小王 → 重新打开的任务
    const [nFv, nFd, nMiki, nBoss, nOps, nAlex, nXw] = await Promise.all([FV, FD, MIKI, BOSS, OPS, ALEX, XW].map(closedNotes));
    ok(nFv.length === 1 && nFv[0].entityType === "install_repair" && nFv[0].entityId === A.repair.id && nMiki.length === 1 && nBoss.length === 1 && nFd.length === 0, "出单·Vinyl / 会计 / 老板各一条落到维修单详情；出单·布帘不收", [nFv, nMiki.length, nBoss.length, nFd.length]);
    ok(nOps.length === 0, "操作人本人不收");
    ok(nAlex.length === 1 && nAlex[0].entityType === "blinds_order" && nAlex[0].entityId === A.order.id, "销售一条落到工艺单详情", nAlex);
    ok(nXw.length === 1 && nXw[0].entityType === "install_task" && nXw[0].entityId === A.appt.id, "小王一条落到重新打开的首装任务", nXw);
    const allA = JSON.stringify([nFv, nMiki, nBoss, nAlex, nXw]);
    ok(!allA.includes("标错了") && !/\$|grandTotal/.test(allA) && allA.includes("已作废"), "通知写明已作废，不带原因说明与金额", allA.slice(0, 300));
    const [dFv, dMiki, dBoss] = await Promise.all([FV, MIKI, BOSS].map((uid) => repairDetail(uid, A.repair.id)));
    const tXw = await taskDetail(XW, A.appt.id);
    ok(dFv.status === 200 && dMiki.status === 200 && dBoss.status === 200 && aSt.status === 200 && tXw.status === 200, "每个收件人都能打开落点页", [dFv.status, dMiki.status, dBoss.status, aSt.status, tXw.status]);
    ok(tXw.task.status === "scheduled" && tXw.task.voidedRepair?.repairNo === A.repair.repairNo && tXw.task.voidedRepair.note === "Den 标错了，实际没问题" && tXw.task.repair === null, "任务详情：带已作废维修单与原因，不带维修单摘要", { voided: tXw.task.voidedRepair, repair: tXw.task.repair });
    ok((await upload(XW, A.appt.id, "spec-vinyl-1")).status === 200, "小王给 Den 补拍完工照");
    const ac = await complete(XW, A.appt.id);
    const aOrder2 = await db.blindsOrder.findUnique({ where: { id: A.order.id } });
    ok(ac.status === 200 && aOrder2?.status === "installed", "完成收口 → 工艺单已安装", ac.body);
    ok((await notes(MIKI, "install_completed")).some((n) => n.entityId === A.order.id) && (await inBalance(A.order.id)), "会计收到完工通知，「待收尾款」出现该单");
    const tXw2 = await taskDetail(XW, A.appt.id);
    ok(tXw2.task.status === "completed" && tXw2.task.repair === null && tXw2.task.voidedRepair === null, "完成后：任务详情不带已作废的维修单", { repair: tXw2.task.repair, voided: tXw2.task.voidedRepair });
    const aDup = await submit(XW, A.appt.id);
    ok(aDup.status === 409, "完成后再提交维修单 → 409（不返回已作废的单）", aDup.body);
    const aList = await get(repairsRoute.GET as unknown as Handler, OPS, `/api/install/repairs`);
    const aItem = ((aList.body?.repairs ?? []) as Array<Json & { id: string; closed: (Json & { label: string }) | null; overdue: boolean }>).find((r) => r.id === A.repair.id);
    ok(aItem?.closed?.label === "已作废" && aItem.overdue === false, "列表：关闭原因已作废、不标已过目标日", aItem);

    console.log("\n[B] 作废（已排返修）+ 并发 → 返修预约取消 → 重新提交得新单号");
    const B = await firstVisit(`I2F-B-${stamp}`, { vinyl: ["Den", "Kitchen"] }, ["spec-vinyl-1"], [["spec-vinyl-0", "wrong_size"]]);
    const bs = await schedule(OPS, B.repair.id, plusDays(5), XL);
    const bRet = String(bs.body?.appointmentId ?? "");
    ok(bs.status === 200 && (await db.blindsOrder.findUnique({ where: { id: B.order.id } }))?.appointmentId === bRet, "已排小李返修，工艺单指向返修预约", bs.body);
    const [bv1, bv2] = await Promise.all([voidR(OPS, B.repair.id, "提交错了"), voidR(BOSS, B.repair.id, "提交错了")]);
    const bStatuses = [bv1.status, bv2.status].sort();
    ok(bStatuses.join() === "200,409" && [bv1, bv2].some((r) => r.body?.code === "CLOSED") && (await closeEvents(B.order.id)).length === 1, "并发作废：一个 200、一个 409 CLOSED，只有一条关闭记录", [bv1.body, bv2.body]);
    const bRetAppt = await db.appointment.findUnique({ where: { id: bRet } });
    const bVisit = await db.appointment.findUnique({ where: { id: B.appt.id } });
    const bOrder = await db.blindsOrder.findUnique({ where: { id: B.order.id } });
    ok(bRetAppt?.status === "cancelled" && String(bRetAppt.cancelReason).includes(B.repair.repairNo) && bVisit?.status === "scheduled", "返修预约已取消（写明维修单号）、首装预约回到已排期", { ret: bRetAppt?.status, visit: bVisit?.status });
    const bd = await repairDetail(OPS, B.repair.id);
    ok((bd.repair.progress.schedule as (Json & { cancelled?: boolean }) | null)?.cancelled === true, "详情：返修排期标为已取消", bd.repair.progress.schedule);
    ok(bOrder?.appointmentId === B.appt.id && bOrder.installDate === todayInTimeZone("America/Toronto", B.appt.startAt) && bOrder.expectedInstallDate?.getTime() === B.appt.startAt.getTime() && bOrder.status === "scheduled", "工艺单指回首装预约，安装日期恢复为首装预约日期", { appt: bOrder?.appointmentId, installDate: bOrder?.installDate });
    const nXl = await closedNotes(XL);
    const tXl = await taskDetail(XL, bRet);
    ok(nXl.length === 1 && nXl[0].entityType === "install_task" && nXl[0].entityId === bRet && tXl.status === 200 && tXl.task.status === "cancelled", "小李收到落到已取消返修任务的通知，能打开（已取消）", [nXl, tXl.status, tXl.task.status]);
    ok((await complete(XL, bRet)).status === 409, "已取消的返修任务完成收口 → 409");
    const bResubmit = await submit(XW, B.appt.id);
    ok(bResubmit.status === 200 && (bResubmit.body?.repair as Json)?.repairNo === `R-I2F-B-${stamp}-2` && bResubmit.body?.idempotent === false, "作废后再提交 → 新单号 R-…-2，不返回已作废的单", bResubmit.body);

    console.log("\n[C] 关闭不返修（已排返修）→ 已安装 → 待收尾款");
    const C = await firstVisit(`I2F-C-${stamp}`, { vinyl: ["Den", "Kitchen"] }, ["spec-vinyl-1"], [["spec-vinyl-0", "wrong_color"]]);
    ok((await issueFactory(FV, C.repair.id, plusDays(3).slice(0, 10))).status === 200, "出单·Vinyl 已登记");
    const cs = await schedule(OPS, C.repair.id, plusDays(6), XL);
    const cRet = String(cs.body?.appointmentId ?? "");
    const cFv = await closeR(FV, C.repair.id, "出单岗关闭");
    const cNo = await closeR(OPS, C.repair.id);
    ok(cFv.status === 403 && cNo.status === 400 && (await db.blindsOrder.findUnique({ where: { id: C.order.id } }))?.status === "scheduled", "出单·Vinyl → 403；缺原因 → 400；工艺单不变", [cFv.status, cNo.status]);
    const cc = await closeR(OPS, C.repair.id, "客户接受色差");
    const cOrder = await db.blindsOrder.findUnique({ where: { id: C.order.id } });
    const cRetAppt = await db.appointment.findUnique({ where: { id: cRet } });
    ok(cc.status === 200 && cc.body?.orderStatus === "installed" && cc.body?.cancelledAppointmentId === cRet, "运营主管关闭不返修 → 200，工艺单已安装", cc.body);
    ok(cRetAppt?.status === "cancelled" && cOrder?.status === "installed" && !!cOrder.installedAt && cOrder.appointmentId === C.appt.id, "返修预约已取消；工艺单 installed、指回首装预约", { ret: cRetAppt?.status, appt: cOrder?.appointmentId });
    const cLog = await db.orderStatusLog.findFirst({ where: { orderId: C.order.id, toStatus: "installed" }, orderBy: { createdAt: "desc" } });
    ok(cLog?.note === `关闭不返修（${C.repair.repairNo}）`, "状态日志：关闭不返修（R-…），不含原因说明", cLog?.note);
    ok((await notes(MIKI, "install_completed")).some((n) => n.entityId === C.order.id) && (await inBalance(C.order.id)), "会计收到完工通知，「待收尾款」出现该单");
    const cSt = await status(ALEX, C.order.id);
    ok(cSt.body?.stage === "awaiting_balance" && cSt.body?.salesText === "已装完，收尾款", "阶段：待收尾款", cSt.body);
    const cd = await repairDetail(OPS, C.repair.id);
    ok(cd.repair.progress.closed?.reason === "waived" && cd.repair.progress.closed.label === "关闭不返修" && cd.repair.progress.closed.note === "客户接受色差", "详情：关闭不返修、原因说明", cd.repair.progress.closed);
    ok((await closeR(OPS, C.repair.id, "再关一次")).status === 409, "再关闭 → 409 CLOSED");
    const cXl = (await closedNotes(XL)).filter((n) => n.entityId === cRet);
    const cFvN = (await closedNotes(FV)).filter((n) => n.entityId === C.repair.id);
    const cAlex = (await closedNotes(ALEX)).filter((n) => n.entityId === C.order.id);
    ok(cXl.length === 1 && cXl[0].entityType === "install_task" && cFvN.length === 1 && cAlex.length === 1 && cAlex[0].entityType === "blinds_order", "通知：小李（已取消返修任务）、出单·Vinyl（维修单）、销售（工艺单）", [cXl, cFvN.length, cAlex]);
    ok(!JSON.stringify([cXl, cFvN, cAlex]).includes("色差"), "关闭通知不带原因说明");
    ok((await complete(XL, cRet)).status === 409, "已取消的返修任务完成收口 → 409，不改成完成");
    ok((await db.appointment.findUnique({ where: { id: cRet } }))?.status === "cancelled", "返修预约仍为已取消");

    console.log("\n[D] 关闭不返修（未排返修）");
    const D = await firstVisit(`I2F-D-${stamp}`, { vinyl: ["Den"] }, [], [["spec-vinyl-0", "wrong_size"]]);
    const apptsBefore = await db.appointment.count({ where: { customerId: cust.id } });
    const dc = await closeR(OPS, D.repair.id, "客户不修了");
    ok(dc.status === 200 && (await db.blindsOrder.findUnique({ where: { id: D.order.id } }))?.status === "installed" && (await db.appointment.count({ where: { customerId: cust.id } })) === apptsBefore, "未登记出单、未排返修也能关闭 → 已安装，没有新预约", dc.body);

    console.log("\n[E] 返修中提交的维修单不能作废；可执行操作 ⇔ 接口");
    const E = await firstVisit(`I2F-E-${stamp}`, { vinyl: ["Den"] }, [], [["spec-vinyl-0", "wrong_size"]]);
    const es = await schedule(OPS, E.repair.id, plusDays(4), XW);
    const eRet = String(es.body?.appointmentId ?? "");
    await issue(XW, eRet, "spec-vinyl-0", "damaged");
    const e2 = await submit(XW, eRet);
    const e2Repair = (e2.body?.repair ?? {}) as { id: string; repairNo: string };
    ok(e2.status === 200 && e2Repair.repairNo === `R-I2F-E-${stamp}-2`, "返修时又有问题 → R-…-2", e2.body);
    const e2d = await repairDetail(OPS, e2Repair.id);
    ok(e2d.repair.actions.canClose && !e2d.repair.actions.canVoid, "返修中提交的：可执行操作有关闭不返修、没有作废", e2d.repair.actions);
    const e2v = await voidR(OPS, e2Repair.id, "想作废");
    ok(e2v.status === 409 && e2v.body?.code === "RETURN_VISIT" && (await repairDetail(OPS, e2Repair.id)).repair.progress.closed === null, "作废 → 409 RETURN_VISIT，维修单仍未关闭", e2v.body);
    const roles = [["出单·Vinyl", FV], ["出单·布帘", FD], ["出单·Roller", FS], ["运营主管", OPS], ["会计", MIKI]] as const;
    let n = 0;
    for (const [name, uid] of roles) {
      for (const op of ["void", "close"] as const) {
        n++;
        const G = await firstVisit(`I2F-G${n}-${stamp}`, { vinyl: ["Den"] }, [], [["spec-vinyl-0", "wrong_size"]]);
        const act = (await repairDetail(uid, G.repair.id)).repair.actions;
        const listed = op === "void" ? act?.canVoid === true : act?.canClose === true;
        const r = op === "void" ? await voidR(uid, G.repair.id, "测试") : await closeR(uid, G.repair.id, "测试");
        ok(listed === (r.status === 200), `${name}：${op === "void" ? "作废" : "关闭不返修"} 列出 ⇔ 2xx`, [act, r.status]);
      }
    }

    console.log("\n[H] 他企业 404；工艺单不是已排期 / 提交预约已取消 → 409 ORDER_STATUS（不写记录）");
    const ORG2 = `i2forg2_${stamp}`;
    const OPS2 = u("ops2");
    await db.user.create({ data: { id: OPS2, email: `${OPS2}@fixture.test`, name: "Example ops2", role: "user" } });
    users.push(OPS2);
    await db.organization.create({ data: { id: ORG2, name: "Example Other Fixture", code: `${ORG2}-c`, ownerId: OPS2, industryPackId: "window_covering_services_v1", settingsJson: { timezone: "America/Toronto" } } });
    await db.organizationMember.create({ data: { orgId: ORG2, userId: OPS2, role: "org_member", status: "active" } });
    await seedOrgAuthorizationProfiles(ORG2);
    const p2 = await db.roleProfile.findUnique({ where: { orgId_key: { orgId: ORG2, key: "ops_lead" } } });
    await db.principalRoleBinding.create({ data: { orgId: ORG2, principalType: "HUMAN", principalId: OPS2, roleProfileId: p2!.id, status: "active" } });
    const H1 = await firstVisit(`I2F-H1-${stamp}`, { vinyl: ["Den"] }, [], [["spec-vinyl-0", "wrong_size"]]);
    const asOrg2 = async (handler: Handler, id: string, kind: string) => {
      const r = new NextRequest(`http://localhost/api/install/repairs/${id}/${kind}`, {
        method: "POST",
        body: JSON.stringify({ reason: "他企业", orgId: ORG2 }),
        headers: { cookie: await session(OPS2), "x-forwarded-for": "10.37.0.7", "content-type": "application/json" },
      });
      return parse(await handler(r, { params: Promise.resolve({ id }) }));
    };
    const [x1, x2] = [await asOrg2(voidRoute.POST as unknown as Handler, H1.repair.id, "void"), await asOrg2(closeRoute.POST as unknown as Handler, H1.repair.id, "close")];
    ok(x1.status === 404 && x2.status === 404 && (await closeEvents(H1.order.id)).length === 0, "他企业运营主管作废 / 关闭不返修 → 404，不写记录", [x1.status, x2.status]);
    await db.blindsOrder.update({ where: { id: H1.order.id }, data: { status: "cancelled" } });
    const [h1v, h1c] = [await voidR(OPS, H1.repair.id, "工艺单已取消"), await closeR(OPS, H1.repair.id, "工艺单已取消")];
    ok(h1v.status === 409 && h1v.body?.code === "ORDER_STATUS" && h1c.status === 409 && h1c.body?.code === "ORDER_STATUS" && (await closeEvents(H1.order.id)).length === 0 && (await db.appointment.findUnique({ where: { id: H1.appt.id } }))?.status === "completed", "工艺单不是已排期 → 作废 / 关闭不返修都 409 ORDER_STATUS，不写记录、预约不变", [h1v.body, h1c.body]);
    const H2 = await firstVisit(`I2F-H2-${stamp}`, { vinyl: ["Den"] }, [], [["spec-vinyl-0", "wrong_size"]]);
    await db.appointment.update({ where: { id: H2.appt.id }, data: { status: "cancelled" } });
    const h2v = await voidR(OPS, H2.repair.id, "提交预约已取消");
    ok(h2v.status === 409 && h2v.body?.code === "ORDER_STATUS" && (await closeEvents(H2.order.id)).length === 0, "提交维修单的那次预约已取消 → 作废 409 ORDER_STATUS，不写记录", h2v.body);

    console.log("\n[F] 逾期提醒（每日简报定时任务里的一步）");
    const route = readFileSync(path.join(process.cwd(), "src/app/api/cron/daily-brief/route.ts"), "utf8");
    ok(/remindOverdueRepairs\(org\.id, org\.timezone, now\)/.test(route), "每日简报定时任务对每个企业调用逾期提醒（不新增 cron 条目）");
    const F1 = await firstVisit(`I2F-F1-${stamp}`, { vinyl: ["Den"] }, [], [["spec-vinyl-0", "wrong_size"]]);
    const F2 = await firstVisit(`I2F-F2-${stamp}`, { vinyl: ["Den"] }, [], [["spec-vinyl-0", "customer"]]);
    const F3 = await firstVisit(`I2F-F3-${stamp}`, { vinyl: ["Den"] }, [], [["spec-vinyl-0", "customer"]]);
    // 目标日 = 今天 + 7；把"今天"推到 +10：F1 未排；F2 返修排在 +11（之后）；F3 返修排在 +8（已过）
    // plusDays 按 UTC 日期取 14:00Z，与企业时区（多伦多）日期在傍晚可能差一天，所以两边各留一天余量
    ok((await schedule(OPS, F2.repair.id, plusDays(11), XL)).status === 200 && (await schedule(OPS, F3.repair.id, plusDays(8), XL)).status === 200, "F2 返修排在推后的今天之后、F3 返修排在之前");
    // "推后的今天"取企业时区今天 +10 天的 17:00Z（多伦多中午前后），不随运行时刻与夏令时切换跨日
    const later = new Date(`${today}T17:00:00.000Z`);
    later.setUTCDate(later.getUTCDate() + 10);
    const laterDay = todayInTimeZone("America/Toronto", later);
    const run1 = await remindOverdueRepairs(ORG, "America/Toronto", later);
    const overdue = (uid: string, entityId: string) => db.notification.findMany({ where: { userId: uid, type: "install_repair_overdue", entityId }, select: { entityType: true, title: true, summary: true } });
    const [f1Ops, f1Miki, f1Boss, f1Alex] = await Promise.all([overdue(OPS, F1.repair.id), overdue(MIKI, F1.repair.id), overdue(BOSS, F1.repair.id), overdue(ALEX, F1.order.id)]);
    ok(run1.repairs >= 2 && f1Ops.length === 1 && f1Miki.length === 1 && f1Boss.length === 1 && f1Ops[0].entityType === "install_repair", "F1 过了目标日还没排：运营主管 / 会计 / 老板各一条落到维修单详情", [run1, f1Ops.length, f1Miki.length, f1Boss.length]);
    ok(f1Alex.length === 1 && f1Alex[0].entityType === "blinds_order", "销售一条落到工艺单详情", f1Alex);
    ok(String(f1Ops[0]?.summary).includes("已过 3 天") && String(f1Ops[0]?.summary).includes("待登记出单：Vinyl") && !/\$|grandTotal/.test(JSON.stringify(f1Ops)), "内容：已过 3 天、待登记出单：Vinyl，不含金额", f1Ops[0]);
    ok((await overdue(OPS, F2.repair.id)).length === 0, "F2 返修排在以后 → 不提醒");
    const f3 = await overdue(OPS, F3.repair.id);
    ok(f3.length === 1 && String(f3[0].summary).includes("已过仍未收口"), "F3 返修日已过仍未收口 → 提醒", f3);
    for (const [label, id] of [["已作废", A.repair.id], ["关闭不返修（已排）", C.repair.id], ["关闭不返修（未排）", D.repair.id], ["转入新单", E.repair.id]] as const) {
      ok((await overdue(OPS, id)).length === 0, `${label}的维修单 → 不提醒`);
    }
    await remindOverdueRepairs(ORG, "America/Toronto", later);
    ok((await overdue(OPS, F1.repair.id)).length === 1 && (await overdue(ALEX, F1.order.id)).length === 1, "同一天再跑一次：每人仍只有一条");
    const nextDay = new Date(later.getTime() + 86_400_000);
    await remindOverdueRepairs(ORG, "America/Toronto", nextDay);
    const f1Next = await overdue(OPS, F1.repair.id);
    ok(f1Next.length === 2 && f1Next.some((x) => String(x.summary).includes("已过 4 天")), "第二天再跑：每人新增一条（已过 4 天）", f1Next.map((x) => x.summary));
    ok(laterDay > today, "推后的日期在今天之后", laterDay);
    ok((await repairDetail(OPS, F1.repair.id)).status === 200 && (await status(ALEX, F1.order.id)).status === 200, "逾期提醒的落点都能打开");
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
    await db.principalRoleBinding.deleteMany({ where: { orgId: { startsWith: "i2forg2_" + stamp } } });
    await db.roleProfile.deleteMany({ where: { orgId: { startsWith: "i2forg2_" + stamp } } }).catch(() => undefined);
    await db.organizationMember.deleteMany({ where: { orgId: { startsWith: "i2forg2_" + stamp } } });
    await db.organization.deleteMany({ where: { id: { startsWith: "i2forg2_" + stamp } } }).catch(() => undefined);
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
