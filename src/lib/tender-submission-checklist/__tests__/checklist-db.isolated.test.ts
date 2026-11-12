/**
 * FLOW-H4b 交付前检查清单——真实 DB（隔离库），调用真实路由
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/tender-submission-checklist/__tests__/checklist-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture（虚构组织 / 用户 / 项目 / 要求）。不调任何模型，不发任何请求。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 FLOW-H4b 交付前检查清单 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "FLOW-H4b submission checklist DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
const arr = (v: unknown): Rec[] => (Array.isArray(v) ? (v as Rec[]) : []);

async function main() {
  const { NextRequest } = await import("next/server");
  const { db } = await import("@/lib/db");
  const { createSession } = await import("@/lib/auth/session");
  const { SUBMISSION_CHECKLIST_AUDIT_ACTION, checklistKeyOf } = await import("../contract");
  const route = await import("@/app/api/projects/[id]/submission-checklist/route");
  const itemRoute = await import("@/app/api/projects/[id]/submission-checklist/items/[key]/route");
  const legacyRoute = await import("@/app/api/projects/[id]/checklist/route");

  console.log("FLOW-H4b submission checklist — isolated DB");
  const stamp = Date.now().toString(36);
  const OWNER = `clowner_${stamp}`, VIEWER = `clviewer_${stamp}`, OUTSIDER = `clout_${stamp}`;
  const ORG = `clorg_${stamp}`, ORG_B = `clorgb_${stamp}`;
  const users = [OWNER, VIEWER, OUTSIDER];
  const email = (id: string) => `${id}@fixture.test`;
  const DAY = 86_400_000;
  process.env.TENDER_SUBMISSION_CHECKLIST_ENABLED = "1";
  delete process.env.TENDER_SUBMISSION_CHECKLIST_ORG_ALLOWLIST;

  for (const id of users) await db.user.create({ data: { id, email: email(id), name: `Fixture ${id}`, role: "user" } });
  await db.organization.create({ data: { id: ORG, name: "Fixture Bidder Inc.", code: `cl-${stamp}`, ownerId: OWNER } });
  await db.organization.create({ data: { id: ORG_B, name: "Other Fixture Org", code: `clb-${stamp}`, ownerId: OUTSIDER } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: OWNER, role: "org_admin", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: VIEWER, role: "org_member", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG_B, userId: OUTSIDER, role: "org_admin", status: "active" } });

  const projectIds: string[] = [];
  let seq = 0;
  async function mkProject(o: { orgId?: string; ownerId?: string; workDomain?: string } = {}) {
    seq += 1;
    const id = `clproj_${stamp}_${seq}`;
    projectIds.push(id);
    await db.project.create({ data: { id, name: `Fixture Tender ${stamp}-${seq}`, orgId: o.orgId ?? ORG, ownerId: o.ownerId ?? OWNER, workDomain: o.workDomain ?? "tender", intakeStatus: "dispatched", closeDate: new Date(Date.now() + 10 * DAY), questionCloseDate: new Date(Date.now() + 3 * DAY) } });
    if ((o.orgId ?? ORG) === ORG) await db.projectMember.create({ data: { projectId: id, userId: VIEWER, role: "viewer", status: "active" } });
    return id;
  }
  let runSeq = 0;
  const mkRun = (projectId: string, status: string, o: { orgId?: string; ageMinutes?: number; criticalFacts?: Rec } = {}) => db.tenderAnalysisRun.create({ data: { orgId: o.orgId ?? ORG, projectId, status, idempotencyKey: `cl-${stamp}-${(runSeq += 1)}`, sourceHashFingerprint: "fixture", createdById: OWNER, createdAt: new Date(Date.now() - (o.ageMinutes ?? 0) * 60_000), summaryJson: { criticalFacts: o.criticalFacts ?? {} } as never } });
  const mkReq = (projectId: string, runId: string, code: string, o: Rec = {}) => db.tenderExtractedRequirement.create({ data: { projectId, analysisRunId: runId, requirementCode: code, category: "submission", originalRequirement: `Original ${code}`, chineseTranslation: `中文 ${code}`, mandatory: true, reviewStatus: "CONFIRMED", sourcePage: 4, ...o } as never });

  const cookieOf = async (userId: string) => `qy_session=${await createSession({ sub: userId, email: email(userId), role: "user" })}`;
  const get = async (projectId: string, userId: string = OWNER) => {
    const res = await route.GET(new NextRequest(`http://localhost/api/projects/${projectId}/submission-checklist`, { headers: { cookie: await cookieOf(userId) } }), { params: Promise.resolve({ id: projectId }) });
    return { status: res.status, body: rec(await res.json().catch(() => null)) };
  };
  const put = async (projectId: string, key: string, body: unknown, userId: string = OWNER) => {
    const res = await itemRoute.PUT(new NextRequest(`http://localhost/api/projects/${projectId}/submission-checklist/items/${key}`, { method: "PUT", headers: { cookie: await cookieOf(userId), "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: projectId, key }) });
    return { status: res.status, body: rec(await res.json().catch(() => null)) };
  };
  const legacy = async (method: "GET" | "POST", projectId: string) => {
    const res = await legacyRoute[method](new NextRequest(`http://localhost/api/projects/${projectId}/checklist`, { method, headers: { cookie: await cookieOf(OWNER) } }), { params: Promise.resolve({ id: projectId }) });
    return { status: res.status, body: rec(await res.json().catch(() => null)) };
  };
  const view = async (projectId: string, userId: string = OWNER) => rec((await get(projectId, userId)).body.view);
  const codes = (v: unknown) => arr(v).map((x) => x.requirementCode).join();
  const writes = async (projectId: string) => JSON.stringify({ d: await db.tenderDeliverable.findMany({ where: { projectId }, orderBy: { deliverableKey: "asc" }, select: { deliverableKey: true, status: true, title: true } }), a: await db.auditLog.count({ where: { projectId } }) });

  try {
    /* ---------- 1. 没有分析 ---------- */
    const P = await mkProject();
    let v = await view(P);
    ok(v.hasAnalysis === false && arr(v.toPrepare).length === 0 && arr(v.conditions).length === 0 && typeof v.closesAt === "string" && typeof v.questionCloseAt === "string", "还没有分析：清单为空，带着项目上的截标与提问截止时间", v);

    /* ---------- 2. 分组 ---------- */
    const run1 = await mkRun(P, "APPROVED", { criticalFacts: { submission_method: { status: "KNOWN", text: "通过 MERX 门户在线提交" }, bond: { status: "UNKNOWN", text: null } } });
    await mkReq(P, run1.id, "R-001");
    await mkReq(P, run1.id, "R-002", { reviewStatus: "AI_EXTRACTED", category: "bonding" });
    await mkReq(P, run1.id, "R-003", { reviewStatus: "REJECTED" });
    await mkReq(P, run1.id, "R-004", { category: "insurance" });
    await mkReq(P, run1.id, "T-001", { category: "technical", complianceStatus: "NON_COMPLIANT" });
    await mkReq(P, run1.id, "T-002", { category: "technical" });
    await mkReq(P, run1.id, "S-009", { mandatory: false });
    // 分析时投影出来的交付物行（R-001 有，R-004 没有——后来才确认的要求）
    await db.tenderDeliverable.create({ data: { projectId: P, analysisRunId: run1.id, deliverableKey: checklistKeyOf("R-001"), title: "分析时写的标题", mandatory: true, sourcePage: 4 } });
    v = await view(P);
    ok(v.hasAnalysis === true && v.analysisApproved === true && codes(v.toPrepare) === "R-001,R-004" && codes(v.unconfirmed) === "R-002" && codes(v.risks) === "T-001" && !JSON.stringify(v).includes("R-003") && !JSON.stringify(v).includes("S-009") && !JSON.stringify(v).includes("T-002"), "已确认的两条进「要备齐的」；没确认的单列；不满足的技术要求进废标风险；驳回的、非强制的、别的类别的不出现", v);
    const conds = arr(v.conditions);
    ok(conds.find((c) => c.slot === "submission_method")?.textZh === "通过 MERX 门户在线提交" && conds.find((c) => c.slot === "bond")?.found === false && conds.find((c) => c.slot === "insurance")?.found === false, "提交条件：分析里写明的原样带出；没找到的写明没有找到", conds);
    ok(JSON.stringify(v.progress) === JSON.stringify({ total: 2, done: 0, waived: 0, pending: 2 }) && arr(v.toPrepare).every((i) => i.status === "PENDING" && i.tickable === true) && v.canEdit === true, "进度 0 / 2，都是待办（系统不会自己打勾）", v.progress);
    const first = arr(v.toPrepare)[0];
    ok(first.key === "req_r_001" && first.textZh === "中文 R-001" && first.originalText === "Original R-001" && first.sourcePage === 4 && first.categoryZh === "提交要求", "每条带编号、中文、原文、出处页码、类别名", first);

    /* ---------- 3. 权限、隔离、开关 ---------- */
    const before = await writes(P);
    const asViewer = await get(P, VIEWER);
    ok(asViewer.status === 200 && rec(asViewer.body.view).canEdit === false && codes(rec(asViewer.body.view).toPrepare) === "R-001,R-004", "只读成员读取：成功，内容相同，知道自己不能标");
    ok((await put(P, "req_r_001", { status: "DONE" }, VIEWER)).status === 403, "只读成员标状态：403");
    ok((await get(P, OUTSIDER)).status >= 400 && (await put(P, "req_r_001", { status: "DONE" }, OUTSIDER)).status >= 400, "别的组织的人：读写都被拒");
    const notTender = await mkProject({ workDomain: "sales" });
    ok((await get(notTender)).status === 404 && (await put(notTender, "req_r_001", { status: "DONE" })).status === 404, "不是招投标项目：404");
    process.env.TENDER_SUBMISSION_CHECKLIST_ENABLED = "0";
    ok((await get(P)).status === 404 && (await put(P, "req_r_001", { status: "DONE" })).status === 404, "开关关闭：404");
    const legacyOffGet = await legacy("GET", P), legacyOffPost = await legacy("POST", P);
    ok(legacyOffGet.status === 200 && !("replaced" in legacyOffGet.body) && legacyOffPost.status !== 409 && legacyOffPost.body.replaced === undefined, "开关关闭：模型清单的两个接口与原来相同（读取不带「已取代」；生成照常往下走）", { get: legacyOffGet.body, post: { status: legacyOffPost.status, body: legacyOffPost.body } });
    process.env.TENDER_SUBMISSION_CHECKLIST_ENABLED = "1";
    process.env.TENDER_SUBMISSION_CHECKLIST_ORG_ALLOWLIST = ORG_B;
    ok((await get(P)).status === 404 && (await legacy("POST", P)).status !== 409, "组织不在名单里：新接口 404，模型清单照旧");
    delete process.env.TENDER_SUBMISSION_CHECKLIST_ORG_ALLOWLIST;
    ok((await put(P, "req_r_001", { status: "IN_PROGRESS" })).status === 400 && (await put(P, "req_r_001", null)).status === 400, "状态值不对：400");
    ok((await put(P, "req_r_002", { status: "DONE" })).status === 404 && (await put(P, "req_r_003", { status: "DONE" })).status === 404 && (await put(P, "req_t_001", { status: "DONE" })).status === 404 && (await put(P, "req_made_up", { status: "DONE" })).status === 404, "不在「要备齐的」里的键（还没确认的、已驳回的、废标风险里的、编造的）：404");
    ok((await writes(P)) === before, "以上所有被拒的请求之后：交付物与审计都没有变化");

    /* ---------- 4. 模型清单被取代 ---------- */
    const legacyGet = await legacy("GET", P), legacyPost = await legacy("POST", P);
    ok(legacyGet.status === 200 && legacyGet.body.replaced === true && legacyPost.status === 409 && legacyPost.body.replaced === true, "开关开启：模型清单的读取标明已被取代；生成直接返回 409、不往下走到模型", { get: legacyGet.body, post: legacyPost.body });
    ok((await db.projectDocument.count({ where: { projectId: P, source: "ai_checklist" } })) === 0 && (await db.auditLog.count({ where: { projectId: P, action: "ai_analyze" } })) === 0, "没有生成、没有存下任何模型清单");
    ok((await legacy("POST", notTender)).status !== 409, "不是招投标项目：模型清单不受影响（那里没有确定性清单可用）");

    /* ---------- 5. 标状态 ---------- */
    const done = await put(P, "req_r_001", { status: "DONE" });
    const dv = rec(done.body.view);
    ok(done.status === 200 && arr(dv.toPrepare)[0].status === "DONE" && JSON.stringify(dv.progress) === JSON.stringify({ total: 2, done: 1, waived: 0, pending: 1 }), "标为备好了：响应里就是新的清单，进度 1 / 2", dv.progress);
    const row1 = await db.tenderDeliverable.findUnique({ where: { analysisRunId_deliverableKey: { analysisRunId: run1.id, deliverableKey: "req_r_001" } } });
    ok(row1?.status === "DONE" && row1.title === "分析时写的标题", "状态写在分析时已有的那一行上，没有动它的标题", row1);
    const waived = await put(P, "req_r_004", { status: "WAIVED" });
    const row4 = await db.tenderDeliverable.findUnique({ where: { analysisRunId_deliverableKey: { analysisRunId: run1.id, deliverableKey: "req_r_004" } } });
    ok(waived.status === 200 && row4?.status === "WAIVED" && row4.projectId === P && row4.title === "中文 R-004" && row4.mandatory === true && row4.sourcePage === 4, "分析时没有投影的那条：标状态时现建一行（项目、标题、出处都对）", row4);
    v = await view(P, VIEWER);
    ok(arr(v.toPrepare).map((i) => i.status).join() === "DONE,WAIVED" && JSON.stringify(v.progress) === JSON.stringify({ total: 2, done: 1, waived: 1, pending: 0 }), "重新读取（只读成员）：状态都在，进度 1 备好 + 1 不适用", v.progress);
    const audits = await db.auditLog.findMany({ where: { projectId: P, action: SUBMISSION_CHECKLIST_AUDIT_ACTION }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    ok(audits.length === 2 && audits[0].orgId === ORG && audits[0].userId === OWNER && audits[0].targetId === "req_r_001" && rec(JSON.parse(audits[0].afterData ?? "{}")).status === "DONE" && rec(JSON.parse(audits[0].afterData ?? "{}")).requirementCode === "R-001" && rec(JSON.parse(audits[0].beforeData ?? "{}")).status === "PENDING" && rec(JSON.parse(audits[1].beforeData ?? "{}")).status === null, "每次修改留一条审计：谁、哪一条、从什么改成什么", audits.map((a) => [a.targetId, a.beforeData, a.afterData]));
    const back = await put(P, "req_r_001", { status: "PENDING" });
    ok(back.status === 200 && arr(rec(back.body.view).toPrepare)[0].status === "PENDING" && (await db.tenderDeliverable.count({ where: { projectId: P } })) === 2, "改回待办：可以；交付物行没有多出来");
    // 标过之后这条要求被驳回：从清单里消失，也不能再标
    await db.tenderExtractedRequirement.updateMany({ where: { analysisRunId: run1.id, requirementCode: "R-004" }, data: { reviewStatus: "REJECTED" } });
    v = await view(P);
    ok(codes(v.toPrepare) === "R-001" && (await put(P, "req_r_004", { status: "DONE" })).status === 404, "标过之后这条要求被驳回：从清单里消失，也不能再标");
    await db.tenderExtractedRequirement.updateMany({ where: { analysisRunId: run1.id, requirementCode: "R-004" }, data: { reviewStatus: "CONFIRMED" } });
    await put(P, "req_r_001", { status: "DONE" });

    /* ---------- 6. 用哪一份分析 ---------- */
    // 最近一次失败、之前那份可用 → 用之前那份
    await mkRun(P, "FAILED");
    v = await view(P);
    ok(codes(v.toPrepare) === "R-001,R-004" && arr(v.toPrepare)[0].status === "DONE", "最近一次分析失败、之前那份已批准：仍用之前那份，状态都在");
    // 一份记在别的组织名下的分析不拿来用
    const stray = await mkRun(P, "APPROVED", { orgId: ORG_B });
    await mkReq(P, stray.id, "X-001");
    ok(codes((await view(P)).toPrepare) === "R-001,R-004", "分析记录上的组织不是这个项目的组织：不拿来用");
    await db.tenderExtractedRequirement.deleteMany({ where: { analysisRunId: stray.id } });
    await db.tenderAnalysisRun.delete({ where: { id: stray.id } });
    // 重新分析并批准了新的一份：状态从待办重新开始
    await new Promise((r) => setTimeout(r, 20));
    const run2 = await mkRun(P, "REVIEW_REQUIRED");
    await mkReq(P, run2.id, "R-001");
    await mkReq(P, run2.id, "R-005", { category: "pricing" });
    v = await view(P);
    ok(v.analysisApproved === false && codes(v.toPrepare) === "R-001,R-005" && arr(v.toPrepare).every((i) => i.status === "PENDING") && (await db.tenderDeliverable.findUnique({ where: { analysisRunId_deliverableKey: { analysisRunId: run1.id, deliverableKey: "req_r_001" } } }))?.status === "DONE", "重新分析出了新的一份（等审核）：清单按新的这份来，状态从待办重新开始；旧的那份上的状态还留在库里", v);
    const onNew = await put(P, "req_r_001", { status: "DONE" });
    ok(onNew.status === 200 && (await db.tenderDeliverable.findUnique({ where: { analysisRunId_deliverableKey: { analysisRunId: run2.id, deliverableKey: "req_r_001" } } }))?.status === "DONE", "在新的这份上标：写在新的这份的行上");

    /* ---------- 7. 别的组织自己的项目 ---------- */
    const PB = await mkProject({ orgId: ORG_B, ownerId: OUTSIDER });
    ok((await get(PB, OWNER)).status >= 400 && (await get(PB, OUTSIDER)).status === 200, "别的组织的项目：这边的人读不到；那边自己的人能读");
  } finally {
    delete process.env.TENDER_SUBMISSION_CHECKLIST_ENABLED;
    delete process.env.TENDER_SUBMISSION_CHECKLIST_ORG_ALLOWLIST;
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: { in: [ORG, ORG_B] } }, { userId: { in: users } }, { projectId: { in: projectIds } }] } });
    await db.tenderDeliverable.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.tenderExtractedRequirement.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.tenderAnalysisRun.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.projectDocument.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.projectMember.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.project.deleteMany({ where: { id: { in: projectIds } } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: [ORG, ORG_B] } } });
    await db.organization.deleteMany({ where: { id: { in: [ORG, ORG_B] } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  }

  console.log(`\nFLOW-H4b submission checklist DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
