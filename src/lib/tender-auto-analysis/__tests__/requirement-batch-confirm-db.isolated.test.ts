/**
 * RFQ-AUTO-4 批量确认接口——真实 DB（隔离库）经真实路由处理函数
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/tender-auto-analysis/__tests__/requirement-batch-confirm-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture（虚构组织 / 用户 / 要求）。不发任何邮件、不建任何审批卡。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 RFQ-AUTO-4 批量确认 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "RFQ-AUTO-4 requirement batch confirm DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}

async function main() {
  const { NextRequest } = await import("next/server");
  const { db } = await import("@/lib/db");
  const { createSession } = await import("@/lib/auth/session");
  const { BATCH_CONFIRM_AUDIT_ACTION, BATCH_CONFIRM_LIMIT } = await import("../requirement-batch-confirm");
  const route = await import("@/app/api/projects/[id]/tender-analysis/runs/[runId]/requirements/batch-confirm/route");

  console.log("RFQ-AUTO-4 requirement batch confirm — isolated DB");
  const stamp = Date.now().toString(36);
  const OWNER = `bcowner_${stamp}`, OUTSIDER = `bcout_${stamp}`, ORG = `bcorg_${stamp}`;
  const email = (id: string) => `${id}@fixture.test`;
  // 两个自动流的开关都不开：这个接口的响应里不应出现 rfqAutoDraft
  delete process.env.TENDER_RFQ_AUTO_DRAFT_ENABLED;
  delete process.env.TENDER_RFQ_FOLLOWUP_PREAPPROVAL_ENABLED;

  for (const id of [OWNER, OUTSIDER]) await db.user.create({ data: { id, email: email(id), name: `Fixture ${id}`, role: "user" } });
  await db.organization.create({ data: { id: ORG, name: "Fixture Buyer Inc.", code: `bc-${stamp}`, ownerId: OWNER } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: OWNER, role: "org_admin", status: "active" } });

  const projectIds: string[] = [];
  let seq = 0;
  async function mkProject(statuses: string[]) {
    seq += 1;
    const projectId = `bcproj_${stamp}_${seq}`;
    projectIds.push(projectId);
    await db.project.create({ data: { id: projectId, name: `Fixture Tender ${stamp}-${seq}`, orgId: ORG, ownerId: OWNER, workDomain: "tender", intakeStatus: "dispatched" } });
    const run = await db.tenderAnalysisRun.create({ data: { orgId: ORG, projectId, status: "REVIEW_REQUIRED", idempotencyKey: `bc-${stamp}-${seq}`, sourceHashFingerprint: "fixture", createdById: OWNER } });
    const ids: string[] = [];
    for (const [i, reviewStatus] of statuses.entries()) {
      const r = await db.tenderExtractedRequirement.create({ data: { projectId, analysisRunId: run.id, requirementCode: `R-${String(i + 1).padStart(3, "0")}`, category: "SAFETY", originalRequirement: `Fixture requirement ${i + 1}`, chineseTranslation: `示例要求 ${i + 1}`, mandatory: true, reviewStatus } });
      ids.push(r.id);
    }
    return { projectId, runId: run.id, ids };
  }
  const statusOf = async (ids: string[]) => (await db.tenderExtractedRequirement.findMany({ where: { id: { in: ids } }, select: { id: true, reviewStatus: true } })).reduce<Record<string, string>>((m, r) => ({ ...m, [r.id]: r.reviewStatus }), {});
  const audits = (runId: string) => db.auditLog.findMany({ where: { orgId: ORG, action: BATCH_CONFIRM_AUDIT_ACTION, targetId: runId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const cookieOf = async (userId: string) => `qy_session=${await createSession({ sub: userId, email: email(userId), role: "user" })}`;
  const call = async (p: { projectId: string; runId: string }, body: unknown, userId = OWNER) =>
    route.POST(new NextRequest(`http://localhost/api/projects/${p.projectId}/tender-analysis/runs/${p.runId}/requirements/batch-confirm`, { method: "POST", headers: { cookie: await cookieOf(userId), "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: p.projectId, runId: p.runId }) });

  try {
    // —— 1. 确认成功 + 审计 ——
    const p1 = await mkProject(["AI_EXTRACTED", "AI_EXTRACTED", "AI_EXTRACTED", "CONFIRMED", "REJECTED"]);
    const res1 = await call(p1, { requirementIds: [p1.ids[0], p1.ids[1], p1.ids[2]] });
    const j1 = (await res1.json()) as Record<string, unknown>;
    const st1 = await statusOf(p1.ids);
    ok(res1.status === 200 && j1.ok === true && j1.confirmedCount === 3 && [0, 1, 2].every((i) => st1[p1.ids[i]] === "CONFIRMED") && st1[p1.ids[3]] === "CONFIRMED" && st1[p1.ids[4]] === "REJECTED", "有写权限的人批量确认 3 条：这 3 条变为已确认，已驳回的那条不动", { j1, st1 });
    ok(Object.keys(j1).sort().join() === "confirmedCount,ok", "响应结构与以前相同：只有 ok 与 confirmedCount（自动流的开关没开时没有别的字段）", j1);
    const a1 = await audits(p1.runId);
    const d1 = JSON.parse(a1[0]?.afterData ?? "{}") as { requestedRequirementIds?: string[]; requestedCount?: number; confirmedCount?: number };
    ok(a1.length === 1 && a1[0].userId === OWNER && a1[0].projectId === p1.projectId && a1[0].targetType === "tender_analysis_run" && d1.confirmedCount === 3 && d1.requestedCount === 3 && [...(d1.requestedRequirementIds ?? [])].sort().join() === [p1.ids[0], p1.ids[1], p1.ids[2]].sort().join(), "留一条审计：操作者、分析、请求确认的要求与实际确认的条数", d1);

    // —— 2. 实际确认数少于请求数 ——
    const p2 = await mkProject(["AI_EXTRACTED", "AI_EXTRACTED", "AI_EXTRACTED"]);
    await db.tenderExtractedRequirement.update({ where: { id: p2.ids[1] }, data: { reviewStatus: "REJECTED" } }); // 提交前被别人驳回了
    const res2 = await call(p2, { requirementIds: p2.ids });
    const j2 = (await res2.json()) as { confirmedCount?: number };
    const st2 = await statusOf(p2.ids);
    const d2 = JSON.parse((await audits(p2.runId))[0]?.afterData ?? "{}") as { requestedCount?: number; confirmedCount?: number };
    ok(res2.status === 200 && j2.confirmedCount === 2 && st2[p2.ids[1]] === "REJECTED" && st2[p2.ids[0]] === "CONFIRMED" && st2[p2.ids[2]] === "CONFIRMED" && d2.requestedCount === 3 && d2.confirmedCount === 2, "选了 3 条、其中 1 条已被别人驳回：返回确认了 2 条，被驳回的不会被改回确认；审计如实记 3 / 2", { j2, st2, d2 });

    // —— 3. 别的项目的要求号不被确认 ——
    const p3 = await mkProject(["AI_EXTRACTED"]);
    const p4 = await mkProject(["AI_EXTRACTED"]);
    const res3 = await call(p3, { requirementIds: [p3.ids[0], p4.ids[0]] });
    const j3 = (await res3.json()) as { confirmedCount?: number };
    ok(res3.status === 200 && j3.confirmedCount === 1 && (await statusOf(p4.ids))[p4.ids[0]] === "AI_EXTRACTED", "请求里夹着别的项目的要求号：只确认本分析的那 1 条，别的项目的不动", j3);

    // —— 4. 没有写权限 / 没登录 ——
    const p5 = await mkProject(["AI_EXTRACTED", "AI_EXTRACTED"]);
    const resOut = await call(p5, { requirementIds: p5.ids }, OUTSIDER);
    const resAnon = await route.POST(new NextRequest(`http://localhost/api/projects/${p5.projectId}/tender-analysis/runs/${p5.runId}/requirements/batch-confirm`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requirementIds: p5.ids }) }), { params: Promise.resolve({ id: p5.projectId, runId: p5.runId }) });
    const st5 = await statusOf(p5.ids);
    ok(resOut.status >= 400 && resAnon.status === 401 && p5.ids.every((id) => st5[id] === "AI_EXTRACTED") && (await audits(p5.runId)).length === 0, "不是本组织成员的人、没登录的人调接口：被拒，没有要求被确认，也没有审计", { out: resOut.status, anon: resAnon.status });

    // —— 5. 请求不合规：不确认、不留审计 ——
    const resEmpty = await call(p5, { requirementIds: [] });
    const resBad = await call(p5, { requirementIds: "all" });
    ok(resEmpty.status === 400 && resBad.status === 400 && (await audits(p5.runId)).length === 0 && p5.ids.every((id) => st5[id] === "AI_EXTRACTED"), "没给要求号、或给的不是数组：400，不确认、不留审计", { empty: resEmpty.status, bad: resBad.status });

    // —— 6. 一次超过上限：接口只处理前 200 条（所以界面必须自己分批），审计只记处理了的 ——
    const many = await mkProject(Array.from({ length: BATCH_CONFIRM_LIMIT + 5 }, () => "AI_EXTRACTED"));
    const resMany = await call(many, { requirementIds: many.ids });
    const jMany = (await resMany.json()) as { confirmedCount?: number };
    const left = await db.tenderExtractedRequirement.count({ where: { analysisRunId: many.runId, reviewStatus: "AI_EXTRACTED" } });
    const dMany = JSON.parse((await audits(many.runId))[0]?.afterData ?? "{}") as { requestedRequirementIds?: string[]; requestedCount?: number; confirmedCount?: number };
    ok(jMany.confirmedCount === BATCH_CONFIRM_LIMIT && left === 5 && dMany.requestedCount === BATCH_CONFIRM_LIMIT + 5 && dMany.requestedRequirementIds?.length === BATCH_CONFIRM_LIMIT && dMany.confirmedCount === BATCH_CONFIRM_LIMIT, `一次提交 ${BATCH_CONFIRM_LIMIT + 5} 条：接口只确认前 ${BATCH_CONFIRM_LIMIT} 条，剩 5 条仍待确认；审计记下请求了多少、处理了哪些`, { confirmed: jMany.confirmedCount, left });
    const resRest = await call(many, { requirementIds: many.ids.slice(BATCH_CONFIRM_LIMIT) });
    ok(((await resRest.json()) as { confirmedCount?: number }).confirmedCount === 5 && (await db.tenderExtractedRequirement.count({ where: { analysisRunId: many.runId, reviewStatus: "AI_EXTRACTED" } })) === 0 && (await audits(many.runId)).length === 2, "再提交剩下的那一批（界面的分批做法）：全部确认，两批各留一条审计");
  } finally {
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: ORG }, { userId: { in: [OWNER, OUTSIDER] } }] } });
    await db.tenderExtractedRequirement.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.tenderAnalysisRun.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.project.deleteMany({ where: { id: { in: projectIds } } });
    await db.organizationMember.deleteMany({ where: { orgId: ORG } });
    await db.organization.deleteMany({ where: { id: ORG } });
    await db.user.deleteMany({ where: { id: { in: [OWNER, OUTSIDER] } } });
    await db.$disconnect();
  }

  console.log(`\nRFQ-AUTO-4 requirement batch confirm DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
