/**
 * RFQ-AUTO-2 要求确认后自动起草第 1 轮询价——真实 DB（隔离库）端到端
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/tender-rfq/__tests__/auto-draft-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture（虚构组织 / 用户 / 供应商）。
 * 自动起草只产出待批的审批卡：整个测试不批准任何卡，也没有任何发送器被调用。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 RFQ-AUTO-2 自动起草 DB 端到端（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "RFQ-AUTO-2 auto draft DB test" });

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
  const { rejectApprovalItem } = await import("@/lib/approval/port");
  const { approveAnalysisRun, confirmRequirement } = await import("@/lib/tender-auto-analysis/review");
  const { maybeAutoDraftRfq } = await import("../auto-draft-service");
  const { AUTO_DRAFT_AUDIT_ACTION, AUTO_DRAFT_TITLE_PREFIX, AUTO_DRAFT_TOOL_NAME } = await import("../auto-draft-pure");
  const { loadRfqWebEntry } = await import("../web-entry");
  const { TENDER_SEND_RFQ_TYPE } = await import("../types");
  const approveRoute = await import("@/app/api/projects/[id]/tender-analysis/runs/[runId]/approve/route");
  const confirmRoute = await import("@/app/api/projects/[id]/tender-analysis/runs/[runId]/requirements/[requirementId]/confirm/route");

  console.log("RFQ-AUTO-2 auto draft — isolated DB");
  const stamp = Date.now().toString(36);
  const OWNER = `adowner_${stamp}`, OTHER = `adother_${stamp}`, ORG = `adorg_${stamp}`;
  const email = (id: string) => `${id}@fixture.test`;
  const MAILBOX = `mailbox_${stamp}@fixture.test`;
  const NOW = new Date("2026-11-12T12:00:00Z");

  const flagOn = () => { process.env.TENDER_RFQ_AUTO_DRAFT_ENABLED = "1"; delete process.env.TENDER_RFQ_AUTO_DRAFT_ORG_ALLOWLIST; };
  const flagOff = () => { delete process.env.TENDER_RFQ_AUTO_DRAFT_ENABLED; };
  // RFQ-AUTO-1 的开关全程打开：证明自动起草的卡即使在它打开时也不带跟进授权
  process.env.TENDER_RFQ_FOLLOWUP_PREAPPROVAL_ENABLED = "1";

  // —— fixture ——
  for (const id of [OWNER, OTHER]) await db.user.create({ data: { id, email: email(id), name: id === OWNER ? "Fixture Owner" : "Fixture Other", role: "user" } });
  await db.organization.create({ data: { id: ORG, name: "Fixture Buyer Inc.", code: `ad-${stamp}`, ownerId: OWNER } });
  for (const id of [OWNER, OTHER]) await db.organizationMember.create({ data: { orgId: ORG, userId: id, role: "org_admin", status: "active" } });
  await db.emailProvider.create({ data: { userId: OWNER, type: "gmail", accessToken: "fixture", accountEmail: MAILBOX, grantedScopes: "gmail.compose gmail.readonly" } });
  const mkSupplier = (n: string, o: { status?: string; contactEmail?: string | null } = {}) =>
    db.supplier.create({ data: { orgId: ORG, name: `Fixture Supplier ${n} ${stamp}`, contactEmail: o.contactEmail === undefined ? `sales-${n.toLowerCase()}-${stamp}@supplier.test` : o.contactEmail, status: o.status ?? "active", createdById: OWNER } });
  const [sA, sB, sC, sD, sZ] = [await mkSupplier("A"), await mkSupplier("B"), await mkSupplier("C"), await mkSupplier("D", { status: "inactive" }), await mkSupplier("Z")];
  const settings = (mailboxEmail: string) => ({
    tenderRfq: { fromName: "Fixture Purchasing", fromEmail: MAILBOX, mailboxEmail },
    // OWNER 的常用供应商：C、D（已停用）、A、B，按这个顺序；Z 就绪但不在常用里；OTHER 没有常用供应商
    museBridge: { userPrefs: { [OWNER]: { defaultSupplierIds: [sC.id, sD.id, sA.id, sB.id], defaultIncoterm: "FOB", chaseAfterDays: null, lastUpdatedAt: null } } },
  });
  await db.organization.update({ where: { id: ORG }, data: { settingsJson: settings(MAILBOX) } });

  const projectIds: string[] = [];
  let outsiderId: string | null = null;
  let seq = 0;
  /** 建一个投标项目 + 一份招标分析 + 若干要求 */
  async function mkProject(opts: { runStatus: string; reqs: string[] }) {
    seq += 1;
    const projectId = `adproj_${stamp}_${seq}`;
    projectIds.push(projectId);
    await db.project.create({ data: { id: projectId, name: `Fixture Tender ${stamp}-${seq}`, orgId: ORG, ownerId: OWNER, workDomain: "tender", intakeStatus: "dispatched", closeDate: new Date("2026-12-15T00:00:00Z") } });
    const run = await db.tenderAnalysisRun.create({ data: { orgId: ORG, projectId, status: opts.runStatus, idempotencyKey: `ad-${stamp}-${seq}`, sourceHashFingerprint: "fixture", createdById: OWNER } });
    const reqIds: string[] = [];
    for (const [i, reviewStatus] of opts.reqs.entries()) {
      const r = await db.tenderExtractedRequirement.create({
        data: { projectId, analysisRunId: run.id, requirementCode: `R-${String(i + 1).padStart(3, "0")}`, category: "SAFETY", originalRequirement: `Fixture requirement ${i + 1}: flame retardant certificate`, chineseTranslation: `示例要求 ${i + 1}：阻燃证书`, mandatory: true, reviewStatus },
      });
      reqIds.push(r.id);
    }
    return { projectId, runId: run.id, reqIds };
  }
  const rounds = (projectId: string) => db.projectInquiry.findMany({ where: { projectId }, include: { items: true } });
  const cards = (projectId: string) => db.pendingAction.findMany({ where: { orgId: ORG, projectId, type: TENDER_SEND_RFQ_TYPE } });
  const draft = (p: { projectId: string; runId: string }, trigger: "approve_run" | "confirm_requirement" | "batch_confirm" | "reject_requirement" = "approve_run", userId = OWNER) =>
    maybeAutoDraftRfq({ orgId: ORG, projectId: p.projectId, runId: p.runId, userId, trigger, now: NOW });

  try {
    // —— 1. 开关关闭：零变化 ——
    flagOff();
    const p1 = await mkProject({ runStatus: "APPROVED", reqs: ["CONFIRMED", "CONFIRMED"] });
    const off = await draft(p1);
    ok(off === null && (await rounds(p1.projectId)).length === 0 && (await cards(p1.projectId)).length === 0, "开关关闭：不起草，结果为空（接口不带 rfqAutoDraft）", off);
    const offEntry = await loadRfqWebEntry({ projectId: p1.projectId, orgId: ORG, userId: OWNER, now: NOW });
    ok(offEntry.available && !("autoDraftedRounds" in offEntry), "开关关闭：入口响应里没有自动起草的字段");

    // —— 2. 批准分析后起草 ——
    flagOn();
    const p2 = await mkProject({ runStatus: "REVIEW_REQUIRED", reqs: ["CONFIRMED", "CONFIRMED", "REJECTED", "AI_EXTRACTED"] });
    const early = await draft(p2);
    ok(early?.drafted === false && early.reason === "RUN_NOT_APPROVED" && (await rounds(p2.projectId)).length === 0, "分析还没批准：不起草", early);
    const approved = await approveAnalysisRun({ runId: p2.runId, projectId: p2.projectId, orgId: ORG, actorUserId: OWNER });
    const r2 = await draft(p2);
    const rounds2 = await rounds(p2.projectId);
    const cards2 = await cards(p2.projectId);
    ok(approved.ok && r2?.drafted === true && r2.roundNumber === 1 && r2.supplierCount === 3 && r2.skippedCount === 1, "批准分析后：起草第 1 轮，3 家常用供应商，跳过 1 家（已停用）", r2);
    ok(r2?.drafted === true && r2.unconfirmedCount === 1 && r2.messageZh.includes("另有 1 条没有确认的没带上"), "批准时还有 1 条没确认的要求：照样起草，结果里写明有 1 条没带上（被驳回的那条不算）", r2);
    ok(rounds2.length === 1 && cards2.length === 1 && cards2[0].status === "pending" && cards2[0].decidedById === null, "库里只有一个轮次、一张待批卡（没有被批准）", { rounds: rounds2.length, cards: cards2.map((c) => c.status) });
    const payload2 = cards2[0].payload as { items: Array<{ supplierId: string; to: string; body: string }>; followUpPolicy?: unknown; incoterm?: string; metadata?: { sourceToolName?: string } };
    ok(payload2.items.every((i) => i.body.includes("Fixture requirement 1") && i.body.includes("Fixture requirement 2") && !i.body.includes("Fixture requirement 3") && !i.body.includes("Fixture requirement 4")) && (cards2[0].preview ?? "").includes("带了 2 条已确认的要求，另有 1 条没有确认的没带上"), "询价单正文只有已确认的 2 条；卡的摘要写明带了几条、有几条没带上", { preview: cards2[0].preview });
    ok(payload2.items.map((i) => i.supplierId).join() === [sC.id, sA.id, sB.id].join() && !payload2.items.some((i) => i.supplierId === sZ.id), "收件人就是操作者的常用供应商，按他保存的顺序；就绪但不在常用里的那家没有被选", payload2.items.map((i) => i.to));
    ok(!("followUpPolicy" in payload2) && payload2.incoterm === "FOB", "卡不带跟进授权（RFQ-AUTO-1 的开关开着也不带）；贸易条款取操作者的默认值");
    ok(cards2[0].title.startsWith(AUTO_DRAFT_TITLE_PREFIX) && (cards2[0].preview ?? "").includes("Fixture Owner 的常用供应商") && payload2.metadata?.sourceToolName === AUTO_DRAFT_TOOL_NAME, "标题标明「自动起草」，摘要写明供应商取自谁的常用供应商，来源记为自动起草", { title: cards2[0].title });
    ok(rounds2[0].items.length === 3 && rounds2[0].items.every((i) => i.sentAt === null) && rounds2[0].status !== "in_progress", "零出站：没有任何询价项被标为已发出，轮次还没开始");
    ok(r2?.drafted === true && r2.href === `/projects/${p2.projectId}?tab=bid#rfq-round-${rounds2[0].id}`, "结果里的链接指向这一轮");
    const audit2 = await db.auditLog.findMany({ where: { orgId: ORG, action: AUTO_DRAFT_AUDIT_ACTION, targetId: rounds2[0].id } });
    const a2 = JSON.parse(audit2[0]?.afterData ?? "{}") as { trigger?: string; actionId?: string; supplierSource?: string; suppliers?: unknown[]; skipped?: Array<{ reason: string }>; analysisRunId?: string; unconfirmedRequirementCount?: number };
    ok(audit2.length === 1 && audit2[0].userId === OWNER && a2.trigger === "approve_run" && a2.actionId === cards2[0].id && a2.supplierSource === "operator_default_suppliers" && a2.suppliers?.length === 3 && a2.skipped?.[0]?.reason === "inactive" && a2.analysisRunId === p2.runId && a2.unconfirmedRequirementCount === 1, "留一条审计：谁触发、哪张卡、选了哪几家、跳过了谁、供应商来源、有几条要求没带上", a2);
    const entry2 = await loadRfqWebEntry({ projectId: p2.projectId, orgId: ORG, userId: OWNER, now: NOW });
    ok(entry2.available && Object.keys(entry2.autoDraftedRounds ?? {}).join() === rounds2[0].id && (entry2.autoDraftedRounds?.[rounds2[0].id]?.noteZh ?? "").includes("带了 2 条已确认的要求，另有 1 条没有确认的没带上"), "入口把这一轮标为自动起草，并带上卡摘要里的那句说明", entry2.available ? entry2.autoDraftedRounds : null);

    // —— 3. 驳回这张卡之后不再自动起草 ——
    const again = await draft(p2, "confirm_requirement");
    ok(again?.drafted === false && again.reason === "ROUND_EXISTS" && again.quiet && (await rounds(p2.projectId)).length === 1, "卡还在待批时再触发：不重复起草", again);
    const rejected = await rejectApprovalItem("pending_action", cards2[0].id, { userId: OWNER, role: "org_admin", orgId: ORG });
    const afterReject = await draft(p2, "reject_requirement");
    ok(rejected.ok && afterReject?.drafted === false && afterReject.reason === "ROUND_EXISTS" && (await rounds(p2.projectId)).length === 1 && (await cards(p2.projectId)).length === 1, "人驳回了自动起草的卡：之后不再自动起草", { rejected, afterReject });

    // —— 4. 批准之前逐条确认：不起草也不提示；批准的那一下才起草 ——
    const p3 = await mkProject({ runStatus: "REVIEW_REQUIRED", reqs: ["CONFIRMED", "AI_EXTRACTED"] });
    await confirmRequirement({ runId: p3.runId, requirementId: p3.reqIds[1], projectId: p3.projectId, orgId: ORG });
    const before3 = await draft(p3, "confirm_requirement");
    ok(before3?.drafted === false && before3.reason === "RUN_NOT_APPROVED" && before3.quiet && (await rounds(p3.projectId)).length === 0, "分析批准之前确认要求：不起草，也不提示", before3);
    await approveAnalysisRun({ runId: p3.runId, projectId: p3.projectId, orgId: ORG, actorUserId: OWNER });
    const last3 = await draft(p3);
    ok(last3?.drafted === true && last3.unconfirmedCount === 0 && !last3.messageZh.includes("没带上") && (await rounds(p3.projectId)).length === 1, "批准分析的那一下起草第 1 轮；要求都确认了就不提「没带上」", last3);

    // —— 5. 并发两次触发只起草一轮 ——
    const p4 = await mkProject({ runStatus: "APPROVED", reqs: ["CONFIRMED"] });
    const [c1, c2] = await Promise.all([draft(p4), draft(p4, "batch_confirm")]);
    const draftedCount = [c1, c2].filter((r) => r?.drafted).length;
    ok(draftedCount === 1 && (await rounds(p4.projectId)).length === 1 && (await cards(p4.projectId)).length === 1 && [c1, c2].some((r) => r?.drafted === false && r.reason === "ROUND_EXISTS"), "并发两次触发：只有一个轮次、一张待批卡，另一次的结果是没有起草", { c1, c2 });

    // —— 6. 别人的常用供应商不被使用 ——
    const p5 = await mkProject({ runStatus: "APPROVED", reqs: ["CONFIRMED"] });
    const other = await draft(p5, "approve_run", OTHER);
    ok(other?.drafted === false && other.reason === "NO_DEFAULT_SUPPLIERS" && !other.quiet && other.action?.href === `/projects/${p5.projectId}?tab=bid` && (await rounds(p5.projectId)).length === 0, "操作者自己没有常用供应商（同组织别人有）：不起草，给出去处", other);

    // —— 7. 起草出错不影响审核动作 ——
    const failing = await maybeAutoDraftRfq({ orgId: ORG, projectId: p5.projectId, runId: p5.runId, userId: OWNER, trigger: "approve_run", now: NOW }, { prepare: async () => { throw new Error("fixture: 建轮次出错"); } });
    ok(failing?.drafted === false && failing.reason === "DRAFT_FAILED" && (await rounds(p5.projectId)).length === 0, "建轮次时抛错：不向上抛，结果为起草失败", failing);
    const refused = await maybeAutoDraftRfq({ orgId: ORG, projectId: p5.projectId, runId: p5.runId, userId: OWNER, trigger: "approve_run", now: NOW }, { prepare: async () => ({ ok: false as const, errorCode: "DRAFT_FAILED" as const, message: "fixture" }) });
    ok(refused?.drafted === false && refused.reason === "DRAFT_FAILED" && !refused.quiet && (await db.auditLog.count({ where: { orgId: ORG, action: AUTO_DRAFT_AUDIT_ACTION, projectId: p5.projectId } })) === 0, "建轮次返回失败：结果为起草失败，不留「已起草」的审计", refused);

    // —— 8. 其它不起草的情形 ——
    const p6 = await mkProject({ runStatus: "APPROVED", reqs: ["CONFIRMED"] });
    const newer = await db.tenderAnalysisRun.create({ data: { orgId: ORG, projectId: p6.projectId, status: "REVIEW_REQUIRED", idempotencyKey: `ad-${stamp}-newer`, sourceHashFingerprint: "fixture", createdById: OWNER } });
    const stale = await draft(p6);
    ok(stale?.drafted === false && stale.reason === "RUN_NOT_APPROVED" && (await rounds(p6.projectId)).length === 0, "这份分析已被新的一份取代：不起草", stale);
    await db.tenderAnalysisRun.delete({ where: { id: newer.id } });

    const p7 = await mkProject({ runStatus: "APPROVED", reqs: ["REJECTED", "REJECTED"] });
    const none = await draft(p7);
    ok(none?.drafted === false && none.reason === "NO_CONFIRMED_REQUIREMENTS" && none.action?.href === `/projects/${p7.projectId}?tab=requirements`, "要求全部被驳回：不起草，原因是没有已确认的要求", none);

    await db.organization.update({ where: { id: ORG }, data: { settingsJson: settings(`nobody_${stamp}@fixture.test`) } });
    const noSender = await draft(p6);
    await db.organization.update({ where: { id: ORG }, data: { settingsJson: settings(MAILBOX) } });
    ok(noSender?.drafted === false && noSender.reason === "SENDER_NOT_READY" && noSender.action?.href === "/settings/email" && (await rounds(p6.projectId)).length === 0, "授权邮箱没连接：不起草，去处是连接邮箱", noSender);

    const otherProjectRun = await maybeAutoDraftRfq({ orgId: ORG, projectId: p6.projectId, runId: p1.runId, userId: OWNER, trigger: "approve_run", now: NOW });
    ok(otherProjectRun?.drafted === false && otherProjectRun.reason === "RUN_NOT_APPROVED" && (await rounds(p6.projectId)).length === 0, "拿同组织别的项目的分析来触发：不起草");
    const otherOrg = await maybeAutoDraftRfq({ orgId: `${ORG}_other`, projectId: p6.projectId, runId: p6.runId, userId: OWNER, trigger: "approve_run", now: NOW });
    ok(otherOrg?.drafted === false && otherOrg.reason === "RUN_NOT_APPROVED" && (await rounds(p6.projectId)).length === 0, "组织对不上（拿别的组织号来触发本组织的项目）：不起草");

    // —— 8b. 只建第 1 轮：轮次号对不上、或并发撞上唯一约束，都什么也不建 ——
    const { createInquiry, RoundNumberTakenError } = await import("@/lib/inquiry/service");
    const p10 = await mkProject({ runStatus: "APPROVED", reqs: ["CONFIRMED"] });
    const settled = await Promise.allSettled([createInquiry({ projectId: p10.projectId, expectRoundNumber: 1 }, OWNER), createInquiry({ projectId: p10.projectId, expectRoundNumber: 1 }, OWNER), createInquiry({ projectId: p10.projectId, expectRoundNumber: 1 }, OWNER)]);
    const lost = settled.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    ok(settled.filter((r) => r.status === "fulfilled").length === 1 && lost.length === 2 && lost.every((r) => r.reason instanceof RoundNumberTakenError) && (await rounds(p10.projectId)).length === 1, "并发三次建「只能是第 1 轮」的轮次：只建成一个，另外两次报已有轮次", settled.map((r) => r.status));
    const late = await createInquiry({ projectId: p10.projectId, expectRoundNumber: 1 }, OWNER).then(() => "created", (e: unknown) => (e instanceof RoundNumberTakenError ? "taken" : "other"));
    const plain = await createInquiry({ projectId: p10.projectId }, OWNER);
    ok(late === "taken" && plain.roundNumber === 2, "已有第 1 轮之后再要求「只能是第 1 轮」：不建；不带这个要求时照旧建出第 2 轮（既有入口行为不变）", { late, round: plain.roundNumber });
    const blockedByExisting = await draft(p10);
    ok(blockedByExisting?.drafted === false && blockedByExisting.reason === "ROUND_EXISTS" && (await cards(p10.projectId)).length === 0, "项目里已有人工建的轮次：不自动起草");

    // —— 9. 经真实路由处理函数：响应里带 rfqAutoDraft；重复批准不触发；开关关闭不带字段 ——
    const cookie = `qy_session=${await createSession({ sub: OWNER, email: email(OWNER), role: "user" })}`;
    const post = (url: string, body?: unknown) => new NextRequest(`http://localhost${url}`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
    const p8 = await mkProject({ runStatus: "REVIEW_REQUIRED", reqs: ["CONFIRMED", "AI_EXTRACTED", "AI_EXTRACTED"] });
    const base8 = `/api/projects/${p8.projectId}/tender-analysis/runs/${p8.runId}`;
    const res0 = await confirmRoute.POST(post(`${base8}/requirements/${p8.reqIds[1]}/confirm`), { params: Promise.resolve({ id: p8.projectId, runId: p8.runId, requirementId: p8.reqIds[1] }) });
    const j0 = (await res0.json()) as { ok?: boolean; rfqAutoDraft?: { drafted: boolean; reason?: string; quiet?: boolean } };
    ok(res0.status === 200 && j0.ok === true && j0.rfqAutoDraft?.drafted === false && j0.rfqAutoDraft.reason === "RUN_NOT_APPROVED" && j0.rfqAutoDraft.quiet === true && (await rounds(p8.projectId)).length === 0, "确认接口（分析还没批准）：确认成功，响应带 rfqAutoDraft 但标为不提示，没有轮次", j0);
    const res1 = await approveRoute.POST(post(`${base8}/approve`), { params: Promise.resolve({ id: p8.projectId, runId: p8.runId }) });
    const j1 = (await res1.json()) as { ok?: boolean; status?: string; leftAiExtractedCount?: number; rfqAutoDraft?: Record<string, unknown> };
    ok(res1.status === 200 && j1.ok === true && j1.status === "APPROVED" && j1.leftAiExtractedCount === 1 && j1.rfqAutoDraft?.drafted === true && j1.rfqAutoDraft.unconfirmedCount === 1 && j1.rfqAutoDraft.quiet === false && (await rounds(p8.projectId)).length === 1, "批准接口（还剩 1 条没确认）：批准成功，响应里 rfqAutoDraft.drafted 为 true 并写明 1 条没带上，库里有了第 1 轮", j1);
    ok(Object.keys(j1.rfqAutoDraft ?? {}).sort().join() === "drafted,href,messageZh,quiet,roundNumber,skippedCount,supplierCount,unconfirmedCount" && !/@/.test(JSON.stringify(j1.rfqAutoDraft)), "响应里的 rfqAutoDraft 只有白名单字段，不含任何邮箱");
    const res2 = await approveRoute.POST(post(`${base8}/approve`), { params: Promise.resolve({ id: p8.projectId, runId: p8.runId }) });
    const j2 = (await res2.json()) as Record<string, unknown>;
    ok(res2.status === 200 && !("rfqAutoDraft" in j2) && (await rounds(p8.projectId)).length === 1, "重复批准（幂等返回）：不触发判定，响应不带 rfqAutoDraft", j2);
    // 驳回与批量确认两个接口同样带回结果（这个项目已有轮次 → 不再起草、不提示）
    const rejectRoute = await import("@/app/api/projects/[id]/tender-analysis/runs/[runId]/requirements/[requirementId]/reject/route");
    const batchRoute = await import("@/app/api/projects/[id]/tender-analysis/runs/[runId]/requirements/batch-confirm/route");
    const res5 = await rejectRoute.POST(post(`${base8}/requirements/${p8.reqIds[2]}/reject`), { params: Promise.resolve({ id: p8.projectId, runId: p8.runId, requirementId: p8.reqIds[2] }) });
    const j5 = (await res5.json()) as { ok?: boolean; rfqAutoDraft?: { drafted: boolean; reason?: string; quiet?: boolean } };
    const res6 = await batchRoute.POST(post(`${base8}/requirements/batch-confirm`, { requirementIds: [p8.reqIds[0]] }), { params: Promise.resolve({ id: p8.projectId, runId: p8.runId }) });
    const j6 = (await res6.json()) as { ok?: boolean; rfqAutoDraft?: { drafted: boolean; reason?: string; quiet?: boolean } };
    ok(res5.status === 200 && j5.ok === true && j5.rfqAutoDraft?.reason === "ROUND_EXISTS" && j5.rfqAutoDraft.quiet === true && res6.status === 200 && j6.ok === true && j6.rfqAutoDraft?.reason === "ROUND_EXISTS" && (await rounds(p8.projectId)).length === 1, "驳回接口与批量确认接口：动作成功，响应带 rfqAutoDraft（已有轮次，不提示），没有多建轮次", { j5, j6 });

    // 没有项目写权限的人：审核动作本身被拒，自然也不会起草
    const OUTSIDER = `adoutsider_${stamp}`;
    await db.user.create({ data: { id: OUTSIDER, email: email(OUTSIDER), name: "Fixture Outsider", role: "user" } });
    outsiderId = OUTSIDER;
    const pOut = await mkProject({ runStatus: "REVIEW_REQUIRED", reqs: ["CONFIRMED"] });
    const outsiderCookie = `qy_session=${await createSession({ sub: OUTSIDER, email: email(OUTSIDER), role: "user" })}`;
    const resOut = await approveRoute.POST(
      new NextRequest(`http://localhost/api/projects/${pOut.projectId}/tender-analysis/runs/${pOut.runId}/approve`, { method: "POST", headers: { cookie: outsiderCookie, "content-type": "application/json" }, body: "{}" }),
      { params: Promise.resolve({ id: pOut.projectId, runId: pOut.runId }) },
    );
    const runOut = await db.tenderAnalysisRun.findUnique({ where: { id: pOut.runId }, select: { status: true } });
    ok(resOut.status >= 400 && runOut?.status === "REVIEW_REQUIRED" && (await rounds(pOut.projectId)).length === 0, "不是本组织成员的人调批准接口：被拒，分析没有被批准，也没有起草", { status: resOut.status });

    flagOff();
    const p9 = await mkProject({ runStatus: "REVIEW_REQUIRED", reqs: ["CONFIRMED"] });
    const res4 = await approveRoute.POST(post(`/api/projects/${p9.projectId}/tender-analysis/runs/${p9.runId}/approve`), { params: Promise.resolve({ id: p9.projectId, runId: p9.runId }) });
    const j4 = (await res4.json()) as Record<string, unknown>;
    ok(res4.status === 200 && j4.ok === true && !("rfqAutoDraft" in j4) && (await rounds(p9.projectId)).length === 0, "开关关闭时批准接口：响应与以前逐字段相同，没有轮次", j4);

    // —— 10. 全程零出站 ——
    const allCards = await db.pendingAction.findMany({ where: { orgId: ORG, type: TENDER_SEND_RFQ_TYPE }, select: { status: true, executedAt: true } });
    ok(allCards.length === 4 && allCards.every((c) => c.status !== "executed" && c.status !== "approved" && c.executedAt === null) && (await db.inquiryItem.count({ where: { inquiry: { projectId: { in: projectIds } }, sentAt: { not: null } } })) === 0, "整个测试里没有任何卡被批准或执行，没有任何询价项被标为已发出", allCards);
  } finally {
    flagOff();
    delete process.env.TENDER_RFQ_FOLLOWUP_PREAPPROVAL_ENABLED;
    // —— 清理 ——
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: ORG }, { userId: { in: [OWNER, OTHER, ...(outsiderId ? [outsiderId] : [])] } }] } });
    await db.pendingAction.deleteMany({ where: { orgId: ORG } });
    await db.inquiryItem.deleteMany({ where: { inquiry: { projectId: { in: projectIds } } } });
    await db.projectInquiry.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.notification.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.tenderExtractedRequirement.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.tenderAnalysisRun.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.supplier.deleteMany({ where: { orgId: ORG } });
    await db.project.deleteMany({ where: { id: { in: projectIds } } });
    await db.emailProvider.deleteMany({ where: { userId: { in: [OWNER, OTHER] } } });
    await db.organizationMember.deleteMany({ where: { orgId: ORG } });
    await db.organization.deleteMany({ where: { id: ORG } });
    await db.user.deleteMany({ where: { id: { in: [OWNER, OTHER, ...(outsiderId ? [outsiderId] : [])] } } });
    await db.$disconnect();
  }

  console.log(`\nRFQ-AUTO-2 auto draft DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
