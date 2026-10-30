/**
 * PERM-4a：签约单改总价走审批——真实 DB（隔离库）+ 真实路由 / 执行器端到端
 *
 *   未签约改价直接生效；签约后改总价 → 202（报价不变）；重复提交 409；提交人自批拒绝；
 *   另一位老板批准 → 按提交内容落库、签名作废回 draft、审计含改前改后；提交后报价又被改 → 执行失败；
 *   只改备注 200；唯一老板 409 NO_APPROVER；平台 super_admin 直接生效记自批。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/sales/__tests__/signed-quote-amount-db.isolated.test.ts
 * 无隔离库时自动跳过。只用虚构数据。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过签约单改价审批 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "PERM-4a signed quote amount approval DB test" });

process.env.JWT_SECRET = process.env.JWT_SECRET || "perm-4a-isolated-test-secret-0123456789abcdef";

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

const item = (widthIn: number) => ({ product: "Zebra", fabric: "Light Filtering", widthIn, heightIn: 36, location: "Living" });

async function main() {
  const { db } = await import("@/lib/db");
  const { NextRequest } = await import("next/server");
  const { createSession } = await import("@/lib/auth/session");
  const quoteRoute = await import("@/app/api/sales/quotes/[quoteId]/route");
  const { executePendingAction } = await import("@/lib/pending-actions/executor");
  const { seedOrgAuthorizationProfiles } = await import("@/lib/authorization/seed-org-profiles");

  const stamp = Date.now().toString(36);
  const BOSS_A = `sqbossa_${stamp}`;
  const BOSS_B = `sqbossb_${stamp}`;
  const LEAD = `sqlead_${stamp}`;
  const SOLO = `sqsolo_${stamp}`;
  const SA = `sqsa_${stamp}`;
  const ORG = `sqorg_${stamp}`;
  const ORG_SOLO = `sqorgs_${stamp}`;
  const CUST = `sqcust_${stamp}`;
  const CUST_SOLO = `sqcusts_${stamp}`;
  const Q = `sqq_${stamp}`;
  const Q_SOLO = `sqqs_${stamp}`;
  const users = [BOSS_A, BOSS_B, LEAD, SOLO, SA];

  for (const id of users) {
    await db.user.create({ data: { id, email: `${id}@fixture.test`, name: `Example ${id}`, role: id === SA ? "super_admin" : "user" } });
  }
  await db.organization.create({ data: { id: ORG, name: "Example Blinds Fixture", code: `sqo-${stamp}`, ownerId: BOSS_A, industryPackId: "window_covering_services_v1" } });
  await db.organization.create({ data: { id: ORG_SOLO, name: "Solo Blinds Fixture", code: `sqs-${stamp}`, ownerId: SOLO, industryPackId: "window_covering_services_v1" } });
  for (const [orgId, userId] of [[ORG, BOSS_A], [ORG, BOSS_B], [ORG, LEAD], [ORG_SOLO, SOLO]] as const) {
    await db.organizationMember.create({ data: { orgId, userId, role: "org_member", status: "active" } });
  }
  await seedOrgAuthorizationProfiles(ORG);
  await seedOrgAuthorizationProfiles(ORG_SOLO);
  const bind = async (orgId: string, userId: string, key: string) => {
    const profile = await db.roleProfile.findUnique({ where: { orgId_key: { orgId, key } } });
    const dup = await db.principalRoleBinding.findFirst({ where: { orgId, principalId: userId, roleProfileId: profile!.id } });
    if (!dup) await db.principalRoleBinding.create({ data: { orgId, principalType: "HUMAN", principalId: userId, roleProfileId: profile!.id, status: "active" } });
  };
  await bind(ORG, BOSS_A, "owner");
  await bind(ORG, BOSS_B, "owner");
  await bind(ORG, LEAD, "pricing_lead");
  await bind(ORG_SOLO, SOLO, "owner");
  await db.salesCustomer.create({ data: { id: CUST, orgId: ORG, name: "Example Homeowner", createdById: LEAD } });
  await db.salesCustomer.create({ data: { id: CUST_SOLO, orgId: ORG_SOLO, name: "Solo Homeowner", createdById: SOLO } });
  await db.salesQuote.create({ data: { id: Q, orgId: ORG, customerId: CUST, status: "draft", orderNumber: `SQ-${stamp}`, grandTotal: 0, createdById: LEAD } });
  await db.salesQuote.create({ data: { id: Q_SOLO, orgId: ORG_SOLO, customerId: CUST_SOLO, status: "draft", orderNumber: `SQS-${stamp}`, grandTotal: 0, createdById: SOLO } });

  const cookie = async (id: string) => `qy_session=${await createSession({ sub: id, email: `${id}@fixture.test`, role: id === SA ? "super_admin" : "user" })}`;
  const put = async (uid: string, quoteId: string, orgId: string, body: Record<string, unknown>) => {
    const r = new NextRequest(`http://localhost/api/sales/quotes/${quoteId}?orgId=${orgId}`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: await cookie(uid), "x-forwarded-for": "10.31.0.4" },
      body: JSON.stringify({ orgId, ...body }),
    });
    const res = await (quoteRoute.PUT as unknown as (r: unknown, c: unknown) => Promise<Response>)(r, { params: Promise.resolve({ quoteId }) });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const sign = async (quoteId: string) => db.salesQuote.update({ where: { id: quoteId }, data: { status: "signed", signedAt: new Date() } });
  const approve = (actionId: string, uid: string, role = "user") =>
    executePendingAction(actionId.replace(/^PENDING_ACTION:/, ""), { userId: uid, role, orgId: ORG });

  try {
    console.log("\n[1] 未签约报价改价直接生效（基线）");
    const p0 = await put(LEAD, Q, ORG, { items: [item(24)], installMode: "default" });
    const base = await db.salesQuote.findUnique({ where: { id: Q } });
    ok(p0.status === 200 && (base?.grandTotal ?? 0) > 0, "draft 报价 PUT 200，总价已算出", { p0: p0.status, total: base?.grandTotal });
    const total0 = base?.grandTotal ?? 0;

    console.log("\n[2] 签约后合价改总价 → 202，报价不变；重复 → 409");
    await sign(Q);
    const p1 = await put(LEAD, Q, ORG, { items: [item(48)], installMode: "default" });
    const afterSubmit = await db.salesQuote.findUnique({ where: { id: Q }, include: { items: true } });
    ok(p1.status === 202 && typeof p1.body.approvalId === "string", "签约单改总价 → 202 + 审批 ID", p1.body);
    ok(afterSubmit?.status === "signed" && afterSubmit.grandTotal === total0 && afterSubmit.items[0]?.widthIn === 24 && !!afterSubmit.signedAt, "报价的行 / 总价 / 状态 / 签约时间均未变", afterSubmit);
    const action1 = await db.pendingAction.findUnique({ where: { id: String(p1.body.approvalId).replace(/^PENDING_ACTION:/, "") } });
    ok(action1?.type === "sales.update_signed_quote" && !/成本|毛利|costPrice/.test(`${action1.title}${action1.preview}`) && action1.preview.includes(`SQ-${stamp}`), "审批类型正确，预览含报价号、不含成本", action1?.preview);
    const p1dup = await put(LEAD, Q, ORG, { items: [item(60)], installMode: "default" });
    ok(p1dup.status === 409 && p1dup.body.code === "SIGNED_QUOTE_APPROVAL_PENDING", "已有待批 → 409 SIGNED_QUOTE_APPROVAL_PENDING", p1dup.body);

    console.log("\n[3] 批准：提交人以外的老板批准 → 落库、签名作废");
    const e1 = await approve(String(p1.body.approvalId), String(action1?.approverUserId ?? BOSS_A));
    const approved = await db.salesQuote.findUnique({ where: { id: Q }, include: { items: true } });
    ok(e1.ok === true, "批准执行成功", e1);
    ok(!!approved && approved.grandTotal > total0 && approved.items[0]?.widthIn === 48 && approved.status === "draft" && approved.signedAt === null, "按提交内容落库：宽 48、总价变大、回 draft、签名作废", approved && { total: approved.grandTotal, status: approved.status });
    const audit = await db.auditLog.findFirst({ where: { targetId: Q, action: "sales.signed_quote.amount_changed" }, orderBy: { createdAt: "desc" } });
    const after = audit?.afterData ? JSON.parse(audit.afterData) : {};
    const before = audit?.beforeData ? JSON.parse(audit.beforeData) : {};
    ok(before.grandTotal === total0 && after.grandTotal === approved?.grandTotal && after.requestedById === LEAD && after.selfApproved === false, "审计含改前 / 改后总价、提交人、非自批", { before, after });

    console.log("\n[4] 老板 A 提交、A 自批 → 拒绝；B 批准 → 成功");
    await sign(Q);
    const p2 = await put(BOSS_A, Q, ORG, { items: [item(30)], installMode: "default" });
    ok(p2.status === 202, "老板 A 改签约单总价 → 202", p2.body);
    const action2 = await db.pendingAction.findUnique({ where: { id: String(p2.body.approvalId).replace(/^PENDING_ACTION:/, "") } });
    ok(action2?.approverUserId === BOSS_B, "收件人是另一位老板 B（排除提交人）", action2?.approverUserId);
    const self = await approve(String(p2.body.approvalId), BOSS_A);
    ok(self.ok === false && /自己/.test(String(self.error)), "提交人自批 → 拒绝", self);
    ok((await db.salesQuote.findUnique({ where: { id: Q }, include: { items: true } }))?.items[0]?.widthIn === 48, "自批被拒后报价不变");
    const p2b = await put(BOSS_A, Q, ORG, { items: [item(30)], installMode: "default" });
    ok(p2b.status === 202 && p2b.body.approvalId !== p2.body.approvalId, "自批失败后再提交同一内容 → 新审批（不复用已失败的那条）", { p2: p2.body.approvalId, p2b: p2b.body });
    const e2 = await approve(String(p2b.body.approvalId), BOSS_B);
    ok(e2.ok === true && (await db.salesQuote.findUnique({ where: { id: Q }, include: { items: true } }))?.items[0]?.widthIn === 30, "B 批准 → 报价宽 30", e2);

    console.log("\n[5] 提交后报价又被改（只改备注 200）→ 批准时执行失败");
    await sign(Q);
    const p3 = await put(LEAD, Q, ORG, { items: [item(40)], installMode: "default" });
    ok(p3.status === 202, "改总价 → 202", p3.body);
    const cur = await db.salesQuote.findUnique({ where: { id: Q }, include: { items: true } });
    const pNote = await put(LEAD, Q, ORG, { items: [item(cur?.items[0]?.widthIn ?? 30)], installMode: "default", notes: "客户要求周末安装" });
    ok(pNote.status === 200 && (await db.salesQuote.findUnique({ where: { id: Q } }))?.notes === "客户要求周末安装", "总价不变只改备注 → 200 直接生效", pNote.body);
    const action3 = await db.pendingAction.findUnique({ where: { id: String(p3.body.approvalId).replace(/^PENDING_ACTION:/, "") } });
    const e3 = await approve(String(p3.body.approvalId), String(action3?.approverUserId ?? BOSS_A));
    const keep = await db.salesQuote.findUnique({ where: { id: Q }, include: { items: true } });
    ok(e3.ok === false && /报价已变化/.test(String(e3.error)), "执行失败：报价已变化，请重新提交", e3);
    ok(keep?.notes === "客户要求周末安装" && keep.items[0]?.widthIn === cur?.items[0]?.widthIn, "报价保持备注修改后的内容");

    console.log("\n[6] 唯一老板改签约单总价 → 409 NO_APPROVER");
    const s0 = await put(SOLO, Q_SOLO, ORG_SOLO, { items: [item(24)], installMode: "default" });
    await sign(Q_SOLO);
    const s1 = await put(SOLO, Q_SOLO, ORG_SOLO, { items: [item(48)], installMode: "default" });
    const solo = await db.salesQuote.findUnique({ where: { id: Q_SOLO }, include: { items: true } });
    ok(s0.status === 200 && s1.status === 409 && s1.body.code === "NO_APPROVER" && solo?.items[0]?.widthIn === 24 && solo.status === "signed", "409 NO_APPROVER，报价不变", { s0: s0.status, s1: s1.body });

    console.log("\n[7] 平台 super_admin 改签约单总价 → 直接生效、审计自批");
    await sign(Q);
    const sa = await put(SA, Q, ORG, { items: [item(36)], installMode: "default" });
    const saQuote = await db.salesQuote.findUnique({ where: { id: Q }, include: { items: true } });
    const saAudit = await db.auditLog.findFirst({ where: { targetId: Q, action: "sales.signed_quote.amount_changed", userId: SA } });
    ok(sa.status === 200 && saQuote?.items[0]?.widthIn === 36 && !!saAudit && JSON.parse(saAudit.afterData ?? "{}").selfApproved === true, "super_admin → 200，报价更新，审计 selfApproved", { status: sa.status, body: sa.body });
  } finally {
    const quoteIds = [Q, Q_SOLO];
    await db.pendingAction.deleteMany({ where: { orgId: { in: [ORG, ORG_SOLO] } } });
    await db.auditLog.deleteMany({ where: { OR: [{ targetId: { in: quoteIds } }, { userId: { in: users } }, { orgId: { in: [ORG, ORG_SOLO] } }] } });
    await db.notification.deleteMany({ where: { userId: { in: users } } });
    await db.salesQuote.deleteMany({ where: { id: { in: quoteIds } } });
    await db.salesCustomer.deleteMany({ where: { id: { in: [CUST, CUST_SOLO] } } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: [ORG, ORG_SOLO] } } });
    await db.organization.deleteMany({ where: { id: { in: [ORG, ORG_SOLO] } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  }

  console.log(`\n签约单改价审批 DB 端到端：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
