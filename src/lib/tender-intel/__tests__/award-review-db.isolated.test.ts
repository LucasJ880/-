/**
 * P2-0d 授标记录人工处理（确认 / 撤回，仅组织管理员）— 真实 DB（隔离库）+ 真实路由 + 真实会话（虚构企业）
 *
 *   GET canReview：管理员 true、成员 false → 成员 / 别的组织管理员 POST → 403，记录不变
 *   → 管理员确认疑似重复 / AI 线索 → ACTIVE + HUMAN_CONFIRMED + 审计；再确认幂等
 *   → 撤回：原因必填；RETRACTED + 审计；列表不再出现；已撤回不能再确认
 *   → 更正：撤回填错的中标方后重新标记「未中标」→ 新记录；重放幂等；再换名仍不覆盖
 *   → 我方中标撤回后重新标记「中标」→ 新记录；授标情报关闭 → 409
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/tender-intel/__tests__/award-review-db.isolated.test.ts
 * 无隔离库时自动跳过。只用虚构企业名。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 P2-0d 授标记录人工处理 DB 端到端（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "P2-0d award review DB e2e" });
process.env.T4_AWARD_INTELLIGENCE_SCHEMA_READY = "1";
process.env.JWT_SECRET = process.env.JWT_SECRET || "p2-0d-isolated-test-secret-0123456789abcdef";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1000) : "");
  }
}

const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const ORG = `fx_p20d_org_${stamp}`;
const ORG2 = `fx_p20d_org2_${stamp}`;
const ADMIN = `fx_p20d_admin_${stamp}`;
const MEMBER = `fx_p20d_member_${stamp}`;
const OTHER = `fx_p20d_other_${stamp}`;
const USERS = [ADMIN, MEMBER, OTHER];
const ORG_NAME = `Fixture Shutters ${stamp} Inc.`;
const BUYER = "Fixture Housing Agency";
const P_LOST = `fx_p20d_lost_${stamp}`;
const P_WON = `fx_p20d_won_${stamp}`;
const PROJECTS = [P_LOST, P_WON];

async function main() {
  const { db } = await import("@/lib/db");
  const { NextRequest } = await import("next/server");
  const { createSession } = await import("@/lib/auth/session");
  const { markProjectTenderResult } = await import("@/lib/projects/tender-result");
  const { createOrObserveAwardRecord, listAwardsForOrg } = await import("@/lib/tender-intel/awards");
  const { deriveAwardIntelligence } = await import("@/lib/tender-intel/award-intelligence");
  const awardsRoute = await import("@/app/api/org/tender-awards/route");
  const reviewRoute = await import("@/app/api/organizations/[orgId]/tender-awards/[awardId]/review/route");

  for (const id of USERS) {
    await db.user.create({ data: { id, email: `${id}@fixture.test`, name: "虚构用户", role: "user" } });
  }
  await db.organization.create({ data: { id: ORG, name: ORG_NAME, code: `p20d-${stamp}`, ownerId: ADMIN } });
  await db.organization.create({ data: { id: ORG2, name: `Other Fixture ${stamp}`, code: `p20d2-${stamp}`, ownerId: OTHER } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: ADMIN, role: "org_admin", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: MEMBER, role: "org_member", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG2, userId: OTHER, role: "org_admin", status: "active" } });
  for (const id of PROJECTS) {
    await db.project.create({
      data: { id, name: "Supply and install roller blinds", orgId: ORG, ownerId: ADMIN, workDomain: "tender", intakeStatus: "dispatched", clientOrganization: BUYER, solicitationNumber: `FX-${id.slice(-8)}`, currency: "CAD" },
    });
  }

  const cookie = async (id: string) => `qy_session=${await createSession({ sub: id, email: `${id}@fixture.test`, role: "user" })}`;
  const getAwards = async (uid: string) => {
    const r = new NextRequest(`http://localhost/api/org/tender-awards?orgId=${ORG}`, {
      headers: { cookie: await cookie(uid), "x-forwarded-for": "10.31.0.6", "x-org-id": ORG },
    });
    const res = await (awardsRoute.GET as unknown as (r: unknown, c: unknown) => Promise<Response>)(r, { params: Promise.resolve({}) });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as { canReview?: boolean; records: Array<{ id: string; winnerName: string; status: string }> } };
  };
  const post = async (uid: string, awardId: string, body: Record<string, unknown>, orgId = ORG) => {
    const r = new NextRequest(`http://localhost/api/organizations/${orgId}/tender-awards/${awardId}/review`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: await cookie(uid), "x-forwarded-for": "10.31.0.6" },
      body: JSON.stringify(body),
    });
    const res = await reviewRoute.POST(r, { params: Promise.resolve({ orgId, awardId }) });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as { record?: { status: string; verificationStatus: string }; unchanged?: boolean; error?: string } };
  };
  const rec = (id: string) => db.awardRecord.findUnique({ where: { id } });
  const audits = (id: string, action: string) => db.auditLog.findMany({ where: { targetId: id, action } });
  const observe = (
    winnerName: string,
    sourceKey: string,
    verificationStatus: "AI_EXTRACTED" | "HUMAN_CONFIRMED",
    actor: { actorType: "user" | "system"; userId: string | null },
    awardDate = "2025-03-01",
  ) =>
    createOrObserveAwardRecord({
      orgId: ORG,
      actor,
      // 没有招标编号、日期不同 → 同中标方 + 同买家的第二条落「疑似重复」（日期 + 金额都相同会被强匹配并为同一条）
      award: { winnerName, buyerNameRaw: BUYER, solicitationNumber: null, awardDate: new Date(awardDate), contractAmount: 40000, currency: "CAD", scopeSummary: "roller blinds" },
      source: { sourceType: verificationStatus === "AI_EXTRACTED" ? "WEB_SEARCH" : "USER_ENTRY", sourceKey, capturedAt: new Date() },
      confidence: "MEDIUM",
      verificationStatus,
    });

  try {
    console.log("\n[1] 准备：填错的中标方、AI 线索、疑似重复");
    const lost1 = await markProjectTenderResult({ projectId: P_LOST, result: "lost", winningBidPrice: 120000, winnerName: "Wrong Blinds Co", actorUserId: ADMIN });
    const wrongId = lost1.canonicalBackfill?.awardRecordId ?? "";
    const lead = await observe("Lead Coverings Inc", `web:p20d-lead-${stamp}`, "AI_EXTRACTED", { actorType: "system", userId: null });
    await observe("Repeat Shades Ltd", `p20d:rep1:${stamp}`, "HUMAN_CONFIRMED", { actorType: "user", userId: ADMIN });
    const dup = await observe("Repeat Shades Ltd", `p20d:rep2:${stamp}`, "HUMAN_CONFIRMED", { actorType: "user", userId: ADMIN }, "2026-03-02");
    ok(!!wrongId && lead.record.verificationStatus === "AI_EXTRACTED" && dup.record.status === "NEEDS_REVIEW", "三类记录就位", { wrongId, lead: lead.record.verificationStatus, dup: dup.record.status });

    console.log("\n[2] 权限");
    const gA = await getAwards(ADMIN);
    const gM = await getAwards(MEMBER);
    ok(gA.status === 200 && gA.body.canReview === true && gM.status === 200 && gM.body.canReview === false, "GET canReview：管理员 true、成员 false", { a: gA.body.canReview, m: gM.body.canReview });
    const m1 = await post(MEMBER, dup.record.id, { action: "confirm" });
    const o1 = await post(OTHER, dup.record.id, { action: "retract", reason: "x" });
    const o2 = await post(OTHER, dup.record.id, { action: "retract", reason: "x" }, ORG2);
    ok(m1.status === 403 && o1.status === 403 && o2.status === 404, "成员 403；别的组织管理员走本组织路径 403、走自己组织路径 404", [m1.status, o1.status, o2.status]);
    ok((await rec(dup.record.id))?.status === "NEEDS_REVIEW", "被拒时记录不变");

    console.log("\n[3] 确认");
    const c1 = await post(ADMIN, dup.record.id, { action: "confirm" });
    ok(c1.status === 200 && c1.body.record?.status === "ACTIVE" && c1.body.record.verificationStatus === "HUMAN_CONFIRMED" && c1.body.unchanged === false, "疑似重复 → ACTIVE + 人工确认", c1);
    ok((await audits(dup.record.id, "award_record_confirmed")).length === 1, "写了一条审计");
    const c2 = await post(ADMIN, dup.record.id, { action: "confirm" });
    ok(c2.status === 200 && c2.body.unchanged === true && (await audits(dup.record.id, "award_record_confirmed")).length === 1, "再确认幂等，不重复写审计", c2);
    const c3 = await post(ADMIN, lead.record.id, { action: "confirm" });
    const intel = deriveAwardIntelligence(await listAwardsForOrg({ orgId: ORG }), { ownWinnerNames: [ORG_NAME] });
    ok(c3.status === 200 && intel.competitorSignals.confirmed.some((c) => c.name === "Lead Coverings Inc"), "AI 线索确认后进入已确认竞争对手", intel.competitorSignals);

    console.log("\n[4] 撤回");
    const r0 = await post(ADMIN, wrongId, { action: "retract", reason: "   " });
    const r00 = await post(ADMIN, wrongId, { action: "retract" });
    ok(r0.status === 400 && r00.status === 400 && (await rec(wrongId))?.status === "ACTIVE", "原因为空或缺失 → 400，不改状态", [r0, r00]);
    const r1 = await post(ADMIN, wrongId, { action: "retract", reason: "中标方填错了" });
    const wrong = await rec(wrongId);
    const meta = wrong?.metadata as { retraction?: { reason?: string; byUserId?: string } } | null;
    ok(r1.status === 200 && wrong?.status === "RETRACTED" && meta?.retraction?.reason === "中标方填错了" && meta.retraction.byUserId === ADMIN, "RETRACTED，原因与撤回人留痕", { s: wrong?.status, meta });
    const ra = await audits(wrongId, "award_record_retracted");
    ok(ra.length === 1 && (ra[0].afterData ?? "").includes("中标方填错了"), "撤回审计带原因", ra.map((a) => a.afterData));
    ok(!(await getAwards(ADMIN)).body.records.some((r) => r.id === wrongId), "撤回后列表不再出现");
    const r2 = await post(ADMIN, wrongId, { action: "confirm" });
    ok(r2.status === 409, "已撤回不能再确认 → 409", r2);

    console.log("\n[5] 更正：撤回后重新标记未中标");
    const lost2 = await markProjectTenderResult({ projectId: P_LOST, result: "lost", winnerName: "Right Blinds Co", actorUserId: ADMIN });
    const rightId = lost2.canonicalBackfill?.awardRecordId ?? "";
    const right = await rec(rightId);
    ok(lost2.canonicalBackfill?.award === "written" && rightId !== wrongId && right?.status === "ACTIVE" && right.winnerName === "Right Blinds Co", "新中标方写成新记录", lost2.canonicalBackfill);
    const lost3 = await markProjectTenderResult({ projectId: P_LOST, result: "lost", winnerName: "right blinds co", actorUserId: ADMIN });
    ok(lost3.canonicalBackfill?.awardRecordId === rightId && lost3.canonicalBackfill.award === "written", "重放同名 → 同一条（幂等）", lost3.canonicalBackfill);
    const lost4 = await markProjectTenderResult({ projectId: P_LOST, result: "lost", winnerName: "Third Co", actorUserId: ADMIN });
    ok(lost4.canonicalBackfill?.awardReason === "winner_already_recorded", "再换名仍不覆盖", lost4.canonicalBackfill);
    ok((await db.awardRecord.count({ where: { orgId: ORG, projectId: P_LOST, status: { not: "RETRACTED" } } })) === 1, "该项目只有一条有效中标方记录");

    console.log("\n[6] 我方中标撤回后重新标记");
    const won1 = await markProjectTenderResult({ projectId: P_WON, result: "won", winningBidPrice: 90000, actorUserId: ADMIN });
    const ownId = won1.canonicalBackfill?.awardRecordId ?? "";
    await post(ADMIN, ownId, { action: "retract", reason: "误标中标" });
    const won2 = await markProjectTenderResult({ projectId: P_WON, result: "won", winningBidPrice: 90000, actorUserId: ADMIN });
    ok(won2.canonicalBackfill?.award === "written" && won2.canonicalBackfill.awardRecordId !== ownId && (await rec(won2.canonicalBackfill.awardRecordId ?? ""))?.status === "ACTIVE", "重新标记中标 → 新记录", won2.canonicalBackfill);

    console.log("\n[7] 其它");
    const bad = await post(ADMIN, rightId, { action: "delete" });
    const missing = await post(ADMIN, `nope_${stamp}`, { action: "confirm" });
    ok(bad.status === 400 && missing.status === 404, "非法 action 400；不存在 404", [bad.status, missing.status]);
    process.env.T4_AWARD_INTELLIGENCE_SCHEMA_READY = "0";
    const off = await post(ADMIN, rightId, { action: "retract", reason: "x" });
    process.env.T4_AWARD_INTELLIGENCE_SCHEMA_READY = "1";
    ok(off.status === 409 && (await rec(rightId))?.status === "ACTIVE", "授标情报关闭 → 409，记录不变", off);
  } finally {
    const ids = (await db.awardRecord.findMany({ where: { orgId: ORG }, select: { id: true } })).map((r) => r.id);
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: { in: [ORG, ORG2] } }, { targetId: { in: ids } }, { userId: { in: USERS } }] } });
    await db.awardRecordSource.deleteMany({ where: { orgId: ORG } });
    await db.awardRecord.deleteMany({ where: { orgId: ORG } });
    await db.projectReview.deleteMany({ where: { projectId: { in: PROJECTS } } });
    await db.project.deleteMany({ where: { id: { in: PROJECTS } } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: [ORG, ORG2] } } });
    await db.organization.deleteMany({ where: { id: { in: [ORG, ORG2] } } });
    await db.user.deleteMany({ where: { id: { in: USERS } } });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await db.$disconnect();
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
