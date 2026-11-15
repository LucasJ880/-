/**
 * FLOW-H3 询价发出之后招标分析更新过——真实 DB（隔离库）+ 真实路由
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/tender-rfq/__tests__/analysis-update-note-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture。不调任何模型，不发任何请求。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 FLOW-H3 询价轮次的分析更新提示 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "FLOW-H3 rfq analysis update note DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}
type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});

async function main() {
  const { NextRequest } = await import("next/server");
  const { db } = await import("@/lib/db");
  const { createSession } = await import("@/lib/auth/session");
  const route = await import("@/app/api/projects/[id]/tender-rfq/entry/route");

  console.log("FLOW-H3 rfq round × analysis update — isolated DB");
  const stamp = Date.now().toString(36);
  const OWNER = `h3owner_${stamp}`, OUTSIDER = `h3out_${stamp}`;
  const ORG = `h3org_${stamp}`, ORG_B = `h3orgb_${stamp}`;
  const users = [OWNER, OUTSIDER];
  const email = (id: string) => `${id}@fixture.test`;
  const DAY = 86_400_000;
  process.env.TENDER_RFQ_ANALYSIS_UPDATE_NOTE_ENABLED = "1";
  delete process.env.TENDER_RFQ_ANALYSIS_UPDATE_NOTE_ORG_ALLOWLIST;

  for (const id of users) await db.user.create({ data: { id, email: email(id), name: `Fixture ${id}`, role: "user" } });
  await db.organization.create({ data: { id: ORG, name: "Fixture Bidder Inc.", code: `h3-${stamp}`, ownerId: OWNER } });
  await db.organization.create({ data: { id: ORG_B, name: "Other Fixture Org", code: `h3b-${stamp}`, ownerId: OUTSIDER } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: OWNER, role: "org_admin", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG_B, userId: OUTSIDER, role: "org_admin", status: "active" } });
  const supplier = await db.supplier.create({ data: { orgId: ORG, name: "Fixture Supplier Ltd.", contactEmail: "supplier@fixture.test", status: "active", createdById: OWNER } as never });

  const projectIds: string[] = [];
  let seq = 0;
  const ago = (days: number) => new Date(Date.now() - days * DAY);
  async function mkProject() {
    seq += 1;
    const id = `h3proj_${stamp}_${seq}`;
    projectIds.push(id);
    await db.project.create({ data: { id, name: `Fixture Tender ${stamp}-${seq}`, orgId: ORG, ownerId: OWNER, workDomain: "tender", intakeStatus: "dispatched", closeDate: new Date(Date.now() + 10 * DAY) } });
    return id;
  }
  /** 一轮由询价引擎发出的询价：轮次 + 一家已发出 + 已执行的发送卡（创建时间 = 起草时间） */
  async function mkEngineRound(projectId: string, roundNumber: number, draftedDaysAgo: number) {
    const inquiry = await db.projectInquiry.create({ data: { projectId, roundNumber, status: "in_progress", createdById: OWNER } });
    await db.inquiryItem.create({ data: { inquiryId: inquiry.id, supplierId: supplier.id, status: "sent", sentAt: ago(draftedDaysAgo - 0.5), createdById: OWNER } as never });
    await db.pendingAction.create({ data: { type: "tender.send_rfq", title: `第 ${roundNumber} 轮询价`, preview: "fixture", payload: { inquiryId: inquiry.id, projectId, roundNumber, items: [{ supplierId: supplier.id, body: "1. 【强制】R-001 须提交样品（p.3）" }] }, status: "executed", createdById: OWNER, orgId: ORG, projectId, decidedById: OWNER, decidedAt: ago(draftedDaysAgo - 0.4), executedAt: ago(draftedDaysAgo - 0.5), createdAt: ago(draftedDaysAgo), expiresAt: new Date(Date.now() + 3 * DAY), idempotencyKey: `h3-${stamp}-${projectId}-${roundNumber}` } });
    return inquiry.id;
  }
  let runSeq = 0;
  const mkRun = (projectId: string, status: string, o: { completedDaysAgo?: number | null; createdDaysAgo?: number; orgId?: string } = {}) =>
    db.tenderAnalysisRun.create({ data: { orgId: o.orgId ?? ORG, projectId, status, idempotencyKey: `h3-${stamp}-run-${(runSeq += 1)}`, sourceHashFingerprint: "fixture", createdById: OWNER, createdAt: ago(o.createdDaysAgo ?? 20), completedAt: o.completedDaysAgo === null ? null : ago(o.completedDaysAgo ?? 19) } });

  const cookie = async (uid: string) => `qy_session=${await createSession({ sub: uid, email: email(uid), role: "user" })}`;
  const entry = async (projectId: string) => {
    const res = await route.GET(new NextRequest(`http://localhost/api/projects/${projectId}/tender-rfq/entry`, { headers: { cookie: await cookie(OWNER) } }), { params: Promise.resolve({ id: projectId }) });
    return { status: res.status, body: rec(await res.json().catch(() => null)) };
  };
  const notes = async (projectId: string) => (await entry(projectId)).body.analysisUpdateNotes as Record<string, { noteZh: string }> | undefined;
  const snapshot = async (projectId: string) => JSON.stringify({
    pa: await db.pendingAction.findMany({ where: { projectId }, orderBy: { id: "asc" }, select: { id: true, status: true, updatedAt: true } }),
    inq: await db.projectInquiry.findMany({ where: { projectId }, orderBy: { id: "asc" }, select: { id: true, status: true, updatedAt: true } }),
    items: await db.inquiryItem.findMany({ where: { inquiry: { projectId } }, orderBy: { id: "asc" }, select: { id: true, status: true } }),
    runs: await db.tenderAnalysisRun.findMany({ where: { projectId }, orderBy: { id: "asc" }, select: { id: true, status: true } }),
    audits: await db.auditLog.count({ where: { projectId } }),
  });

  try {
    /* ---------- 1. 起草之后分析更新过 ---------- */
    const P = await mkProject();
    await mkRun(P, "APPROVED", { createdDaysAgo: 20, completedDaysAgo: 19 });
    const r1 = await mkEngineRound(P, 1, 10);
    const r2 = await mkEngineRound(P, 2, 2);
    let n = await notes(P);
    ok(!!n && Object.keys(n).length === 0, "分析在两轮起草之前就完成了：两轮都没有提示", n);
    await mkRun(P, "REVIEW_REQUIRED", { createdDaysAgo: 6, completedDaysAgo: 5 });
    const before = await snapshot(P);
    const e = await entry(P);
    n = e.body.analysisUpdateNotes as Record<string, { noteZh: string }>;
    ok(e.status === 200 && Object.keys(n).join() === r1 && n[r1].noteZh.includes("起草的；之后招标分析在") && n[r1].noteZh.includes("可能已经变了"), "第 1 轮起草之后有一份新的分析完成（等待审核）：第 1 轮有提示；第 2 轮在那之后才起草，没有", n);
    ok(!n[r1].noteZh.includes("R-001") && !n[r1].noteZh.includes("须提交样品"), "提示里没有要求编号与原文");
    ok((await snapshot(P)) === before, "读取前后：审批卡、轮次、条目、分析、审计都没有变化");
    ok(!(r2 in n), "第 2 轮没有提示");

    /* ---------- 2. 完成时间缺失时按创建时间 ---------- */
    const P2 = await mkProject();
    const p2r = await mkEngineRound(P2, 1, 10);
    await mkRun(P2, "REVIEW_REQUIRED", { createdDaysAgo: 3, completedDaysAgo: null });
    n = await notes(P2);
    ok(!!n && Object.keys(n).join() === p2r, "完成时间缺失的分析按创建时间算（起草之后创建）：有提示", n);

    /* ---------- 3. 失败的、进行中的、已被取代的、别的项目的、别的组织名下的 ---------- */
    const P3 = await mkProject();
    await mkRun(P3, "APPROVED", { createdDaysAgo: 30, completedDaysAgo: 29 });
    await mkEngineRound(P3, 1, 10);
    await mkRun(P3, "FAILED", { createdDaysAgo: 4, completedDaysAgo: 3 });
    await mkRun(P3, "ANALYZING", { createdDaysAgo: 2, completedDaysAgo: null });
    await mkRun(P3, "SUPERSEDED", { createdDaysAgo: 5, completedDaysAgo: 4 });
    await mkRun(P3, "APPROVED", { createdDaysAgo: 2, completedDaysAgo: 1, orgId: ORG_B });
    await mkRun(P, "APPROVED", { createdDaysAgo: 1, completedDaysAgo: 0.5 }); // 别的项目（P）有更新的
    n = await notes(P3);
    ok(!!n && Object.keys(n).length === 0, "之后只有失败的、进行中的、已被取代的、别的组织名下的分析，或别的项目有新的：没有提示", n);

    /* ---------- 4. 没有分析 ---------- */
    const P4 = await mkProject();
    await mkEngineRound(P4, 1, 3);
    n = await notes(P4);
    ok(!!n && Object.keys(n).length === 0, "项目没有可用的分析：没有提示", n);

    /* ---------- 5. 开关 ---------- */
    process.env.TENDER_RFQ_ANALYSIS_UPDATE_NOTE_ENABLED = "0";
    const off = await entry(P);
    ok(off.status === 200 && off.body.available === true && !("analysisUpdateNotes" in off.body), "开关关闭：接口不返回这一项（其余照常）", Object.keys(off.body));
    process.env.TENDER_RFQ_ANALYSIS_UPDATE_NOTE_ENABLED = "1";
    process.env.TENDER_RFQ_ANALYSIS_UPDATE_NOTE_ORG_ALLOWLIST = ORG_B;
    ok(!("analysisUpdateNotes" in (await entry(P)).body), "组织不在名单里：同样不返回");
    delete process.env.TENDER_RFQ_ANALYSIS_UPDATE_NOTE_ORG_ALLOWLIST;
  } finally {
    delete process.env.TENDER_RFQ_ANALYSIS_UPDATE_NOTE_ENABLED;
    delete process.env.TENDER_RFQ_ANALYSIS_UPDATE_NOTE_ORG_ALLOWLIST;
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: { in: [ORG, ORG_B] } }, { userId: { in: users } }, { projectId: { in: projectIds } }] } });
    await db.pendingAction.deleteMany({ where: { orgId: { in: [ORG, ORG_B] } } });
    await db.inquiryItem.deleteMany({ where: { inquiry: { projectId: { in: projectIds } } } });
    await db.projectInquiry.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.tenderAnalysisRun.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.supplier.deleteMany({ where: { orgId: { in: [ORG, ORG_B] } } });
    await db.project.deleteMany({ where: { id: { in: projectIds } } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: [ORG, ORG_B] } } });
    await db.organization.deleteMany({ where: { id: { in: [ORG, ORG_B] } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  }

  console.log(`\nFLOW-H3 rfq round × analysis update DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
