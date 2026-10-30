/**
 * INSTALL-2j：返修时间确认邮件——真实 DB（隔离库）+ 真实路由 + 测试发件通道（不触达真实邮件）
 *
 *   [1] 排期后待批准：排期 200，响应 visitEmail pending_approval + 预览，审批人 = 运营主管，发送 0；详情同一审批
 *   [2] 未配置组织发件身份时批准 → NO_ORG_SENDER，发送 0
 *   [3] 配置发件身份后重新生成并批准 → 发送 1、审计、审批 executed、详情 sent；再生成 409 ALREADY_SENT；重复审批 ALREADY_SENT
 *   [4] 改期：新时间新审批（改期主题）；再改期后批准上一条 → SCHEDULE_CHANGED；批准最新一条 → 发送（改期主题）
 *   [5] 客户没有邮箱 → 排期 200 + blocked「客户没有邮箱」、无审批；补邮箱后运营主管重新生成 → pending；出单·Vinyl 调用 → 403
 *   [6] 没有返修安排 → 409 NO_SCHEDULE；维修单关闭不返修后批准待发审批 → REPAIR_CLOSED
 *   [7] 发出的邮件不含金额、问题描述原文、员工名
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/install/__tests__/repair-visit-email-db.isolated.test.ts
 * 无隔离库时自动跳过。只用虚构数据；照片写入临时本地盘（PRODUCT_CONTENT_LOCAL_STORE=1）。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 INSTALL-2j 返修时间确认邮件 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "INSTALL-2j repair visit email DB test" });

process.env.JWT_SECRET = process.env.JWT_SECRET || "install-2j-isolated-test-secret-0123456789abcdef";
const BLOB_DIR = mkdtempSync(path.join(tmpdir(), "install-2j-blobs-"));
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
type VisitView = { status?: string; approvalId?: string; blockers?: string[]; sentAt?: string; installAt?: string; preview?: { to: string; subject: string; html: string } };

async function main() {
  const { db } = await import("@/lib/db");
  const { NextRequest } = await import("next/server");
  const { createSession } = await import("@/lib/auth/session");
  const { seedOrgAuthorizationProfiles } = await import("@/lib/authorization/seed-org-profiles");
  const { emptySpec, AUDIT_ACTION_SPEC, AUDIT_TARGET_ORDER } = await import("@/lib/sunny-process/process-spec");
  const { saveOrgEmailSender } = await import("@/lib/trade/email-sender");
  const { requestApproval } = await import("@/lib/approval/request");
  const { __setRepairVisitSenderForTest } = await import("@/lib/pending-actions/exec-install-repair-visit-email");
  const photoRoute = await import("@/app/api/install/tasks/[id]/items/[itemId]/photo/route");
  const issueRoute = await import("@/app/api/install/tasks/[id]/items/[itemId]/issue/route");
  const repairRoute = await import("@/app/api/install/tasks/[id]/repair/route");
  const repairDetailRoute = await import("@/app/api/install/repairs/[id]/route");
  const scheduleRoute = await import("@/app/api/install/repairs/[id]/schedule/route");
  const visitRoute = await import("@/app/api/install/repairs/[id]/visit-email/route");
  const closeRoute = await import("@/app/api/install/repairs/[id]/close/route");
  const approveRoute = await import("@/app/api/ai/pending-actions/[id]/route");

  const sends: Array<{ to: string; subject: string; body: string; html: string }> = [];
  __setRepairVisitSenderForTest(async (input) => {
    sends.push({ to: input.to, subject: input.subject, body: input.body, html: input.html });
    return { messageId: `visit-msg-${sends.length}`, from: "service@fixture.test" };
  });

  const stamp = Date.now().toString(36);
  const ORG = `i2jorg_${stamp}`;
  const u = (k: string) => `i2j${k}_${stamp}`;
  const [BOSS, ALEX, XW, XL, OPS, FV] = ["boss", "alex", "xw", "xl", "ops", "fv"].map(u);
  const users = [BOSS, ALEX, XW, XL, OPS, FV];
  const roleOf = (id: string) => (id === ALEX ? "sales" : "user");
  for (const id of users) {
    await db.user.create({ data: { id, email: `${id}@fixture.test`, name: id === XL ? "Xiao Li" : `Example ${id.split("_")[0]}`, role: roleOf(id) } });
  }
  await db.organization.create({
    data: { id: ORG, name: "Example Visit Fixture", code: `${ORG}-c`, ownerId: BOSS, industryPackId: "window_covering_services_v1", settingsJson: { timezone: "America/Toronto" } },
  });
  for (const id of users) await db.organizationMember.create({ data: { orgId: ORG, userId: id, role: "org_member", status: "active" } });
  await seedOrgAuthorizationProfiles(ORG);
  for (const [id, key] of [[BOSS, "owner"], [ALEX, "sales_rep"], [XW, "installer"], [XL, "installer"], [OPS, "ops_lead"], [FV, "fulfillment_vinyl"]] as const) {
    const profile = await db.roleProfile.findUnique({ where: { orgId_key: { orgId: ORG, key } } });
    if (!profile) throw new Error(`缺岗位模板 ${key}`);
    await db.principalRoleBinding.create({ data: { orgId: ORG, principalType: "HUMAN", principalId: id, roleProfileId: profile.id, status: "active" } });
  }

  const createdOrders: string[] = [];
  const customers: string[] = [];
  const start = new Date(Date.now() + 3600_000);
  const vinyl = (location: string) => ({ location, width: 30, height: 60, panels: 2, openCode: "LR", posts: "", rail1In: null, rail1Ratio: null, rod: "", split: "", frame: "L", frameCount: 4, inOut: "内装", structure: "有框", rail2In: null, quoteFrame: "L", quoteOpenDirection: "", quoteMidRail: "" });
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
      headers: { cookie: await session(uid), "x-forwarded-for": "10.39.0.7", ...(isForm ? {} : { "content-type": "application/json" }) },
    });
    return parse(await handler(r, { params: Promise.resolve(params) }));
  };
  const get = async (handler: Handler, uid: string, url: string, params: Record<string, string>) => {
    const r = new NextRequest(`http://localhost${url}?orgId=${ORG}`, { headers: { cookie: await session(uid), "x-forwarded-for": "10.39.0.7" } });
    return parse(await handler(r, { params: Promise.resolve(params) }));
  };
  const jpeg = () => new File([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])], "w.jpg", { type: "image/jpeg" });
  const firstVisit = async (code: string, customerEmail: string | null) => {
    const cust = await db.salesCustomer.create({ data: { orgId: ORG, name: "Example Homeowner", phone: "416-555-0110", email: customerEmail, address: "1 Example Way", createdById: ALEX } });
    customers.push(cust.id);
    const appt = await db.appointment.create({
      data: { customerId: cust.id, type: "install", title: `安装 — Example (${code})`, startAt: start, endAt: new Date(start.getTime() + 7200_000), status: "scheduled", assignedToId: XW, createdById: BOSS },
    });
    const order = await db.blindsOrder.create({ data: { code, status: "scheduled", customerName: "Example Homeowner", creatorId: ALEX, customerId: cust.id, appointmentId: appt.id, address: "6 Example Ct" } });
    createdOrders.push(order.id);
    await db.auditLog.create({ data: { userId: BOSS, orgId: ORG, action: AUDIT_ACTION_SPEC, targetType: AUDIT_TARGET_ORDER, targetId: order.id, afterData: JSON.stringify({ ...emptySpec(), vinyl: ["Living Room", "Den"].map(vinyl) }) } });
    const up = new FormData();
    up.append("file", jpeg());
    await post(photoRoute.POST as unknown as Handler, XW, `/api/install/tasks/${appt.id}/items/spec-vinyl-0/photo`, { id: appt.id, itemId: "spec-vinyl-0" }, up);
    const is = new FormData();
    is.append("file", jpeg());
    is.append("issueType", "wrong_size");
    is.append("description", "Den 宽差半寸（内部描述）");
    await post(issueRoute.POST as unknown as Handler, XW, `/api/install/tasks/${appt.id}/items/spec-vinyl-1/issue`, { id: appt.id, itemId: "spec-vinyl-1" }, is);
    const s = await post(repairRoute.POST as unknown as Handler, XW, `/api/install/tasks/${appt.id}/repair`, { id: appt.id }, { customerName: "Example Homeowner", phone: "416-555-0110", notes: "客户难沟通（内部备注）", customerConfirmed: true });
    return { cust, order, appt, repair: (s.body?.repair ?? {}) as { id: string; repairNo: string }, submitStatus: s.status };
  };
  const at = (days: number, hourUtc: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 11) + `${String(hourUtc).padStart(2, "0")}:00:00.000Z`;
  const schedule = (id: string, installAt: string) => post(scheduleRoute.POST as unknown as Handler, OPS, `/api/install/repairs/${id}/schedule`, { id }, { installAt, assignedToId: XL });
  const regen = (uid: string, id: string) => post(visitRoute.POST as unknown as Handler, uid, `/api/install/repairs/${id}/visit-email`, { id }, {});
  const approve = (id: string) => post(approveRoute.POST as unknown as Handler, OPS, `/api/ai/pending-actions/${id}`, { id }, { decision: "approve" });
  const detailView = async (id: string) => ((await get(repairDetailRoute.GET as unknown as Handler, OPS, `/api/install/repairs/${id}`, { id })).body?.visitEmail ?? null) as VisitView | null;
  const actionRow = (id: string) => db.pendingAction.findUnique({ where: { id }, select: { status: true, failureReason: true, approverUserId: true, payload: true } });

  try {
    console.log("\n[1] 排期后待批准");
    const R = await firstVisit(`I2J-R-${stamp}`, "homeowner1@fixture.test");
    ok(R.submitStatus === 200, "提交维修单", R.repair);
    const s1 = await schedule(R.repair.id, at(5, 15));
    const v1 = (s1.body?.visitEmail ?? {}) as VisitView;
    ok(s1.status === 200 && v1.status === "pending_approval" && !!v1.approvalId, "排期 200，响应 visitEmail pending_approval + 审批 id", s1.body);
    ok(v1.preview?.to === "homeowner1@fixture.test" && /^Your repair visit is scheduled — .+ \(Repair R-I2J-R-/.test(v1.preview.subject), "预览：收件人 = 客户档案邮箱、首次排期主题", v1.preview?.subject);
    const a1 = await actionRow(v1.approvalId!);
    ok(a1?.approverUserId === OPS && a1.status === "pending" && sends.length === 0, "审批人 = 运营主管，状态 pending，发送 0");
    ok((await detailView(R.repair.id))?.approvalId === v1.approvalId, "详情 visitEmail 是同一审批");

    console.log("\n[2] 未配置组织发件身份时批准");
    const ap1 = await approve(v1.approvalId!);
    ok(ap1.status === 400 && /NO_ORG_SENDER/.test((await actionRow(v1.approvalId!))?.failureReason ?? "") && sends.length === 0, "NO_ORG_SENDER，发送 0", ap1.body);

    console.log("\n[3] 配置发件身份后重新生成并批准");
    await saveOrgEmailSender(ORG, { fromName: "Sunny Shutter Inc", fromEmail: null, replyTo: "service@fixture.test", bcc: [] }, BOSS);
    const g2 = await regen(OPS, R.repair.id);
    const v2 = (g2.body?.visitEmail ?? {}) as VisitView;
    ok(g2.status === 200 && v2.status === "pending_approval" && v2.approvalId !== v1.approvalId, "重新生成 → 新审批", g2.body);
    const ap2 = await approve(v2.approvalId!);
    ok(ap2.status === 200 && (await actionRow(v2.approvalId!))?.status === "executed" && sends.length === 1 && sends[0].to === "homeowner1@fixture.test", "批准 → 已执行、发送 1 次", ap2.body);
    const sentAudit = await db.auditLog.findMany({ where: { action: "install.repair_visit_email.sent", targetId: R.order.id } });
    const sa = JSON.parse(sentAudit[0]?.afterData ?? "{}") as Json;
    ok(sentAudit.length === 1 && sa.repairId === R.repair.id && sa.messageId === "visit-msg-1" && sa.installAt === at(5, 15) && typeof sa.appointmentId === "string", "审计一条（维修单、预约、时间、消息 id）", sa);
    ok((await detailView(R.repair.id))?.status === "sent", "详情 visitEmail = sent");
    const g3 = await regen(OPS, R.repair.id);
    ok(g3.status === 409 && g3.body?.code === "ALREADY_SENT", "该时间已发送 → 再生成 409 ALREADY_SENT", g3.body);
    const p2 = await actionRow(v2.approvalId!);
    const dup = await requestApproval({
      orgId: ORG,
      principal: { userId: OPS, actorType: "user" },
      actionType: "install.send_repair_visit_email",
      title: "dup",
      preview: "dup",
      payload: p2!.payload as Record<string, unknown>,
      risk: { vocabulary: "agent-core.tool-risk", value: "l3_strong", requiresApproval: true },
      source: { module: "install.repair-visit.test", toolName: "install_send_repair_visit_email" },
      approver: { approverUserId: OPS },
      idempotencyKey: `install-repair-visit-dup:${R.repair.id}`,
    });
    const before3 = sends.length;
    const apDup = await approve(dup.ok ? dup.actionIds[0] : "");
    ok(dup.ok && apDup.status === 400 && /ALREADY_SENT/.test((await actionRow(dup.ok ? dup.actionIds[0] : ""))?.failureReason ?? "") && sends.length === before3, "同一时间第二条审批 → ALREADY_SENT，不发送");

    console.log("\n[4] 改期");
    const s4 = await schedule(R.repair.id, at(7, 16));
    const v4 = (s4.body?.visitEmail ?? {}) as VisitView;
    ok(s4.status === 200 && s4.body?.rescheduled === true && v4.status === "pending_approval" && /^Your repair visit has been rescheduled — /.test(v4.preview?.subject ?? ""), "改期 → 新审批、改期主题", v4.preview?.subject);
    const s5 = await schedule(R.repair.id, at(8, 16));
    const v5 = (s5.body?.visitEmail ?? {}) as VisitView;
    ok(v5.status === "pending_approval" && v5.approvalId !== v4.approvalId, "再改期 → 又一条新审批");
    const before4 = sends.length;
    const ap4 = await approve(v4.approvalId!);
    ok(ap4.status === 400 && /SCHEDULE_CHANGED/.test((await actionRow(v4.approvalId!))?.failureReason ?? "") && sends.length === before4, "批准改期前的审批 → SCHEDULE_CHANGED，不发送", ap4.body);
    const ap5 = await approve(v5.approvalId!);
    ok(ap5.status === 200 && sends.length === before4 + 1 && /rescheduled/.test(sends[sends.length - 1].subject), "批准最新一条 → 发送（改期主题）");

    console.log("\n[5] 客户没有邮箱");
    const N = await firstVisit(`I2J-N-${stamp}`, null);
    const s6 = await schedule(N.repair.id, at(6, 15));
    const v6 = (s6.body?.visitEmail ?? {}) as VisitView;
    ok(s6.status === 200 && v6.status === "blocked" && (v6.blockers ?? []).includes("客户没有邮箱"), "排期 200 + blocked「客户没有邮箱」", v6);
    ok((await db.pendingAction.count({ where: { orgId: ORG, type: "install.send_repair_visit_email", idempotencyKey: { contains: N.repair.id } } })) === 0, "没有新审批");
    await db.salesCustomer.update({ where: { id: N.cust.id }, data: { email: "homeowner2@fixture.test" } });
    ok((await regen(FV, N.repair.id)).status === 403, "出单·Vinyl 重新生成 → 403");
    const g7 = await regen(OPS, N.repair.id);
    ok(g7.status === 200 && (g7.body?.visitEmail as VisitView)?.status === "pending_approval", "补邮箱后运营主管重新生成 → pending_approval", g7.body);

    console.log("\n[6] 没有返修安排 / 维修单已关闭");
    const Z = await firstVisit(`I2J-Z-${stamp}`, "homeowner3@fixture.test");
    const g8 = await regen(OPS, Z.repair.id);
    ok(g8.status === 409 && g8.body?.code === "NO_SCHEDULE", "没有返修安排 → 409 NO_SCHEDULE", g8.body);
    const pendingN = (g7.body?.visitEmail as VisitView).approvalId!;
    const cl = await post(closeRoute.POST as unknown as Handler, OPS, `/api/install/repairs/${N.repair.id}/close`, { id: N.repair.id }, { reason: "客户接受现状" });
    ok(cl.status === 200, "关闭不返修 200", cl.body);
    const before6 = sends.length;
    const ap8 = await approve(pendingN);
    ok(ap8.status === 400 && /REPAIR_CLOSED/.test((await actionRow(pendingN))?.failureReason ?? "") && sends.length === before6, "关闭后批准待发审批 → REPAIR_CLOSED，不发送");
    ok((await detailView(N.repair.id)) === null, "已关闭的维修单详情不带 visitEmail");

    console.log("\n[7] 发出的邮件不含内部信息");
    ok(sends.every((m) => !/\$|CAD|内部描述|内部备注|Xiao Li|\/api\/files/.test(`${m.subject}${m.body}${m.html}`)), "不含金额、问题描述原文、备注、员工名、照片地址");
    ok(sends.every((m) => m.body.includes("Den — Size adjustment / remake") && m.body.includes("Address:     6 Example Ct")), "含英文问题说明与工艺单地址");
  } finally {
    __setRepairVisitSenderForTest(null);
    await db.notification.deleteMany({ where: { userId: { in: users } } });
    await db.orderStatusLog.deleteMany({ where: { orderId: { in: createdOrders } } });
    await db.blindsOrder.deleteMany({ where: { id: { in: createdOrders } } });
    await db.appointment.deleteMany({ where: { customerId: { in: customers } } });
    await db.pendingAction.deleteMany({ where: { orgId: ORG } });
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
