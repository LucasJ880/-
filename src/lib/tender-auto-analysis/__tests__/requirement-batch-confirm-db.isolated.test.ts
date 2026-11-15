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
  const extraUsers: string[] = [];
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

    // —— 7. 面板带的那道保护：分析已不是等待审核 → 409，一条都不确认 ——
    const p7 = await mkProject(["AI_EXTRACTED", "AI_EXTRACTED", "CONFIRMED"]);
    const inReview = await call(p7, { requirementIds: [p7.ids[0]], onlyWhileInReview: true });
    const dIn = JSON.parse((await audits(p7.runId))[0]?.afterData ?? "{}") as { onlyWhileInReview?: boolean };
    ok(inReview.status === 200 && ((await inReview.json()) as { confirmedCount?: number }).confirmedCount === 1 && dIn.onlyWhileInReview === true, "分析等待审核、带着保护：照常确认；审计记下带了保护");
    await db.tenderAnalysisRun.update({ where: { id: p7.runId }, data: { status: "APPROVED", approvedById: OWNER, approvedAt: new Date() } }); // 面板还开着，别人把分析批准了
    const stale = await call(p7, { requirementIds: [p7.ids[1]], onlyWhileInReview: true });
    const jStale = (await stale.json()) as { code?: string; error?: string };
    ok(stale.status === 409 && jStale.code === "run_not_in_review" && (jStale.error ?? "").includes("不是等待审核") && (await statusOf(p7.ids))[p7.ids[1]] === "AI_EXTRACTED" && (await audits(p7.runId)).length === 1, "分析刚被批准、带着保护再提交：409，那条要求仍是待确认，不留审计", jStale);
    const alreadyDone = await call(p7, { requirementIds: [p7.ids[0], p7.ids[2]], onlyWhileInReview: true });
    ok(alreadyDone.status === 409, "已批准的分析上、要求本来就已确认：同样 409（不让人误以为还能确认）");
    const legacy = await call(p7, { requirementIds: [p7.ids[1]] });
    ok(legacy.status === 200 && ((await legacy.json()) as { confirmedCount?: number }).confirmedCount === 1 && (await statusOf(p7.ids))[p7.ids[1]] === "CONFIRMED", "不带这个字段：与以前相同，不看分析的状态（接口的既有行为没有变）");
    const p8 = await mkProject(["AI_EXTRACTED"]);
    await db.tenderAnalysisRun.update({ where: { id: p8.runId }, data: { status: "SUPERSEDED" } });
    const superseded = await call(p8, { requirementIds: p8.ids, onlyWhileInReview: true });
    ok(superseded.status === 409 && (await statusOf(p8.ids))[p8.ids[0]] === "AI_EXTRACTED", "分析已被新的一份取代、带着保护：409，不确认");
    const p9 = await mkProject(["CONFIRMED", "REJECTED"]);
    const nothingPending = await call(p9, { requirementIds: p9.ids, onlyWhileInReview: true });
    ok(nothingPending.status === 200 && ((await nothingPending.json()) as { confirmedCount?: number }).confirmedCount === 0, "分析仍在审核、只是这些要求都不是待确认：200、确认 0 条（不是 409）");

    // —— 8. 是本组织成员、也是项目成员，但没有写权限 ——
    const MEMBER = `bcmember_${stamp}`;
    await db.user.create({ data: { id: MEMBER, email: email(MEMBER), name: "Fixture Member", role: "user" } });
    extraUsers.push(MEMBER);
    await db.organizationMember.create({ data: { orgId: ORG, userId: MEMBER, role: "org_member", status: "active" } });
    const p10 = await mkProject(["AI_EXTRACTED"]);
    await db.projectMember.create({ data: { projectId: p10.projectId, userId: MEMBER, role: "operator", status: "active" } });
    const resMember = await call(p10, { requirementIds: p10.ids, onlyWhileInReview: true }, MEMBER);
    ok(resMember.status === 403 && (await statusOf(p10.ids))[p10.ids[0]] === "AI_EXTRACTED" && (await audits(p10.runId)).length === 0, "本组织的普通成员、项目里只是操作员：403，不确认、不留审计", { status: resMember.status });

    // —— 9. 审计里不存过长的字符串 ——
    const p11 = await mkProject(["AI_EXTRACTED"]);
    await call(p11, { requirementIds: [p11.ids[0], "x".repeat(5000)] });
    const d11 = JSON.parse((await audits(p11.runId))[0]?.afterData ?? "{}") as { requestedRequirementIds?: string[]; requestedCount?: number; confirmedCount?: number };
    ok(d11.confirmedCount === 1 && d11.requestedCount === 2 && d11.requestedRequirementIds?.join() === p11.ids[0], "请求里夹着一个 5000 字符的「要求号」：正常的那条照常确认，审计里只记合规长度的要求号", { n: d11.requestedRequirementIds?.length });
  } finally {
    await db.projectMember.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: ORG }, { userId: { in: [OWNER, OUTSIDER, ...extraUsers] } }] } });
    await db.tenderExtractedRequirement.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.tenderAnalysisRun.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.project.deleteMany({ where: { id: { in: projectIds } } });
    await db.organizationMember.deleteMany({ where: { orgId: ORG } });
    await db.organization.deleteMany({ where: { id: ORG } });
    await db.user.deleteMany({ where: { id: { in: [OWNER, OUTSIDER, ...extraUsers] } } });
    await db.$disconnect();
  }

  console.log(`\nRFQ-AUTO-4 requirement batch confirm DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
