/**
 * T2-P1.5 财务控制 — DB 集成矩阵（隔离库；非隔离自动跳过）
 *
 * BUDGET-01..05 / EXP-01..16 / COST-READ-01/02 / EVENT-01..03。
 * 运行：DATABASE_URL=<隔离分支> DIRECT_URL=<同> NODE_ENV=test \
 *       DATABASE_ENVIRONMENT=isolated npx tsx <本文件>
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

if (!process.env.DATABASE_URL?.trim()) {
  console.log("⏭  跳过 T2-P1.5 财务 DB 测试（未提供 DATABASE_URL）");
  process.exit(0);
}
assertSafeTestDatabase({ scriptName: "project-finance p15 db test" });
if (process.env.NODE_ENV !== "test") {
  console.log("⏭  跳过 T2-P1.5 财务 DB 测试（需 NODE_ENV=test）");
  process.exit(0);
}
// 测试内启用三闸（生产默认 OFF；隔离库显式开）。
// T3.5：producer 有效 = SCHEMA_READY && PRODUCERS_ENABLED（approveExpense 用 isLedgerProducerActive）。
process.env.T2_LEDGER_SCHEMA_READY = "true";
process.env.T2_LEDGER_PRODUCERS_ENABLED = "true";
process.env.TENDER_FINANCIAL_CONTROL_ENABLED = "true";

/** T3.5 双正交 ledger flag 显式控制（EXP-ACTIVE 用；镜像 p1-ledger-db setFlags） */
function setLedgerFlags(schemaReady: boolean, producersEnabled: boolean) {
  if (schemaReady) process.env.T2_LEDGER_SCHEMA_READY = "true";
  else delete process.env.T2_LEDGER_SCHEMA_READY;
  if (producersEnabled) process.env.T2_LEDGER_PRODUCERS_ENABLED = "true";
  else delete process.env.T2_LEDGER_PRODUCERS_ENABLED;
}

const P = "qy_t2p15_";
let pass = 0;
let fail = 0;
function ok(label: string, cond: boolean, detail?: unknown) {
  if (cond) { pass += 1; console.log(`  ✓ ${label}`); }
  else { fail += 1; console.log(`  ✗ ${label}`, detail ?? ""); }
}
function code(e: unknown): string | null {
  return typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : null;
}

async function main() {
  const { db } = await import("@/lib/db");
  const budgetSvc = await import("../budget-service");
  const expSvc = await import("../expense-service");
  const readModel = await import("../read-model");

  const submitter = { actorType: "user" as const, actorId: `${P}submitter` };
  const accountant = { actorType: "user" as const, actorId: `${P}accountant` };

  async function cleanup() {
    await db.projectExpenseAttachment.deleteMany({ where: { orgId: { startsWith: P } } });
    await db.projectExpenseSubmission.deleteMany({ where: { orgId: { startsWith: P } } });
    await db.projectBudgetLine.deleteMany({ where: { orgId: { startsWith: P } } });
    await db.projectBudgetVersion.deleteMany({ where: { orgId: { startsWith: P } } });
    await db.projectBudget.deleteMany({ where: { orgId: { startsWith: P } } });
    await db.projectEventActor.deleteMany({ where: { orgId: { startsWith: P } } });
    await db.projectEvent.deleteMany({ where: { orgId: { startsWith: P } } });
    await db.projectCost.deleteMany({ where: { orgId: { startsWith: P } } });
    await db.project.deleteMany({ where: { orgId: { startsWith: P } } });
    await db.organization.deleteMany({ where: { id: { startsWith: P } } });
    await db.user.deleteMany({ where: { id: { startsWith: P } } });
  }
  await cleanup();

  for (const s of ["submitter", "accountant", "admin"]) {
    await db.user.create({ data: { id: `${P}${s}`, email: `${P}${s}@t.local`, name: s, role: "user" } });
  }
  for (const o of ["a", "b"]) {
    await db.organization.create({ data: { id: `${P}org_${o}`, name: `${P}Org ${o}`, code: `${P}org-${o}`, ownerId: `${P}submitter` } });
  }
  // projA：中标态（bidPhaseStatus=AWARDED）→ 可冻结 AWARD_BASELINE（§BLOCKER2 资格）
  const projA = await db.project.create({ data: { id: `${P}proj_a`, name: "P15 A", orgId: `${P}org_a`, ownerId: `${P}submitter`, workDomain: "tender", bidPhaseStatus: "AWARDED" } });
  await db.project.create({ data: { id: `${P}proj_b`, name: "P15 B", orgId: `${P}org_b`, ownerId: `${P}submitter` } });
  const OA = `${P}org_a`;

  // ─────────────── BUDGET ───────────────
  console.log("━━ BUDGET 矩阵 ━━");

  // BUDGET-01：create budget/version（含行 + 事件）
  const { version: v1 } = await budgetSvc.createBudgetVersion({
    orgId: OA, projectId: projA.id, currency: "CAD", actor: submitter, createdById: `${P}submitter`,
    note: "初版", lines: [
      { category: "MATERIAL", amount: "80000.00", note: "Vendor ABC 报价", basis: "supplier_quote", supplierName: "ABC" },
      { category: "LABOUR", amount: "20000.00" },
      { category: "OVERHEAD", amount: "10000.00", percentage: "0.1000", basis: "percent_of_direct_cost", basisAmount: "100000.00" },
    ],
  });
  ok("BUDGET-01 版本 DRAFT + 总额", v1.status === "DRAFT" && v1.totalBudgetAmount.toString() === "110000");
  const v1Lines = await db.projectBudgetLine.count({ where: { budgetVersionId: v1.id } });
  ok("BUDGET-01 三条预算行落库", v1Lines === 3);
  ok("BUDGET-01 budget.created + version.created 事件",
    (await db.projectEvent.count({ where: { projectId: projA.id, eventType: { in: ["budget.created", "budget.version.created"] } } })) === 2);

  // 百分比行缺 basis → 拒
  let pctRejected = false;
  try {
    await budgetSvc.createBudgetVersion({ orgId: OA, projectId: projA.id, currency: "CAD", actor: submitter, createdById: `${P}submitter`, lines: [{ category: "PROFIT", amount: "5000" }] });
  } catch (e) { pctRejected = code(e) === "FINANCE_CONTRACT_VIOLATION"; }
  ok("BUDGET-01b 百分比型行缺 basis 被拒（禁只存最终金额）", pctRejected);

  // BUDGET-02：activate v1；create v2；activate v2 → v1 SUPERSEDED
  await budgetSvc.activateBudgetVersion({ orgId: OA, projectId: projA.id, versionId: v1.id, actor: submitter, actorUserId: `${P}submitter` });
  const { version: v2 } = await budgetSvc.createBudgetVersion({ orgId: OA, projectId: projA.id, currency: "CAD", actor: submitter, createdById: `${P}submitter`, lines: [{ category: "MATERIAL", amount: "90000" }, { category: "LABOUR", amount: "25000" }] });
  await budgetSvc.activateBudgetVersion({ orgId: OA, projectId: projA.id, versionId: v2.id, actor: submitter, actorUserId: `${P}submitter` });
  const v1After = await db.projectBudgetVersion.findUnique({ where: { id: v1.id } });
  const v2After = await db.projectBudgetVersion.findUnique({ where: { id: v2.id } });
  const budgetRow = await db.projectBudget.findUnique({ where: { orgId_projectId: { orgId: OA, projectId: projA.id } } });
  ok("BUDGET-02 激活新版 supersede 旧版", v1After?.status === "SUPERSEDED" && v2After?.status === "ACTIVE");
  ok("BUDGET-02 budget.currentVersionId 指向新版", budgetRow?.currentVersionId === v2.id);

  // BUDGET-03：freeze AWARD_BASELINE（§BLOCKER2：来源=当前 ACTIVE v2 的 115000，快照为新不可变 baseline，与 ACTIVE v2 并存）
  const frozen = await budgetSvc.freezeAwardBaseline({ orgId: OA, projectId: projA.id, actor: submitter, actorUserId: `${P}submitter`, sourceVersionId: v2.id });
  const budgetRow2 = await db.projectBudget.findUnique({ where: { orgId_projectId: { orgId: OA, projectId: projA.id } } });
  const v2StillActive = await db.projectBudgetVersion.findUnique({ where: { id: v2.id } });
  ok("BUDGET-03 baseline 快照为新 AWARD_BASELINE 版本（总额=当前 ACTIVE v2 的 115000，含冻结时间）",
    frozen.status === "AWARD_BASELINE" && frozen.totalBudgetAmount.toString() === "115000" && frozen.baselineFrozenAt !== null && frozen.id !== v2.id);
  ok("BUDGET-03 budget.awardBaselineVersionId 记录 + baseline_frozen 事件 + ACTIVE v2 不受影响",
    budgetRow2?.awardBaselineVersionId === frozen.id && v2StillActive?.status === "ACTIVE" &&
    (await db.projectEvent.count({ where: { projectId: projA.id, eventType: "budget.baseline_frozen" } })) === 1);

  // BUDGET-04：baseline 不可原地修改 + 二次冻结幂等
  let baselineImmutable = false;
  try {
    await db.$transaction((tx) => budgetSvc.assertVersionEditable(tx, OA, projA.id, frozen.id));
  } catch (e) { baselineImmutable = code(e) === "BUDGET_BASELINE_IMMUTABLE"; }
  ok("BUDGET-04 AWARD_BASELINE 版本原地编辑被拒", baselineImmutable);
  const reFreeze = await budgetSvc.freezeAwardBaseline({ orgId: OA, projectId: projA.id, actor: submitter, actorUserId: `${P}submitter` });
  ok("BUDGET-04b 二次冻结幂等（返回既有 baseline，不覆盖原始中标假设）", reFreeze.id === frozen.id);

  // BUDGET-05：租户隔离
  let budgetTenant = false;
  try {
    await budgetSvc.activateBudgetVersion({ orgId: `${P}org_b`, projectId: projA.id, versionId: v2.id, actor: submitter, actorUserId: `${P}submitter` });
  } catch (e) { budgetTenant = code(e) === "FINANCE_TENANT_MISMATCH"; }
  ok("BUDGET-05 跨 org 操作预算被拒", budgetTenant);

  // 取一个 v2 的 MATERIAL 预算行做后续 expense 链接
  const materialLine = await db.projectBudgetLine.findFirst({ where: { budgetVersionId: v2.id, category: "MATERIAL" } });

  // ─────────────── EXPENSE ───────────────
  console.log("━━ EXPENSE 矩阵 ━━");

  async function newExpense(amount: string, opts?: { costCategory?: string; budgetLineId?: string | null; submittedBy?: string }) {
    return expSvc.createExpenseDraft({
      orgId: OA, projectId: projA.id, actor: submitter, submittedById: opts?.submittedBy ?? `${P}submitter`,
      costCategory: opts?.costCategory ?? "SUPPLIER", budgetLineId: opts?.budgetLineId ?? materialLine?.id ?? null,
      expenseOccurredAt: new Date("2026-08-11T10:00:00Z"), vendorName: "ABC", description: "材料采购",
      totalAmount: amount, currency: "CAD",
    });
  }

  // EXP-01：draft
  const e1 = await newExpense("5000");
  ok("EXP-01 费用草稿 DRAFT + expense.created", e1.status === "DRAFT" &&
    (await db.projectEvent.count({ where: { eventKey: `expense.created:${e1.id}` } })) === 1);

  // EXP-02：submit → PENDING_REVIEW
  await expSvc.submitExpense({ orgId: OA, projectId: projA.id, expenseId: e1.id, actor: submitter, actorUserId: `${P}submitter` });
  const e1b = await db.projectExpenseSubmission.findUnique({ where: { id: e1.id } });
  ok("EXP-02 submit → PENDING_REVIEW + submittedAt", e1b?.status === "PENDING_REVIEW" && e1b?.submittedAt !== null);

  // EXP-03：request info
  await expSvc.requestExpenseInfo({ orgId: OA, projectId: projA.id, expenseId: e1.id, actor: accountant, reviewerUserId: `${P}accountant`, note: "请补票据" });
  ok("EXP-03 request info → NEEDS_INFO", (await db.projectExpenseSubmission.findUnique({ where: { id: e1.id } }))?.status === "NEEDS_INFO");

  // EXP-04：resubmit → PENDING_REVIEW
  await expSvc.resubmitExpense({ orgId: OA, projectId: projA.id, expenseId: e1.id, actor: submitter, actorUserId: `${P}submitter` });
  ok("EXP-04 resubmit → PENDING_REVIEW", (await db.projectExpenseSubmission.findUnique({ where: { id: e1.id } }))?.status === "PENDING_REVIEW");

  // EXP-05：reject
  const e5 = await newExpense("3000"); await expSvc.submitExpense({ orgId: OA, projectId: projA.id, expenseId: e5.id, actor: submitter, actorUserId: `${P}submitter` });
  await expSvc.rejectExpense({ orgId: OA, projectId: projA.id, expenseId: e5.id, actor: accountant, reviewerUserId: `${P}accountant`, note: "不符合政策" });
  ok("EXP-05 reject → REJECTED + expense.rejected 事件", (await db.projectExpenseSubmission.findUnique({ where: { id: e5.id } }))?.status === "REJECTED" &&
    (await db.projectEvent.count({ where: { eventKey: `expense.rejected:${e5.id}` } })) === 1);

  // EXP-06 + EXP-07：approve → APPROVED + 恰一条 ProjectCost.ACTUAL
  const appr = await expSvc.approveExpense({ orgId: OA, projectId: projA.id, expenseId: e1.id, actor: accountant, reviewerUserId: `${P}accountant` });
  ok("EXP-06 approve → APPROVED", appr.expense.status === "APPROVED" && appr.created === true);
  const costsForE1 = await db.projectCost.findMany({ where: { orgId: OA, projectId: projA.id, costStatus: "ACTUAL" } });
  const e1Cost = costsForE1.filter((c) => (c.refs as { expenseSubmissionId?: string } | null)?.expenseSubmissionId === e1.id);
  ok("EXP-07 审批产恰一条 ProjectCost.ACTUAL（金额/类别/refs 正确）",
    e1Cost.length === 1 && e1Cost[0]!.amountActual?.toString() === "5000" && e1Cost[0]!.category === "SUPPLIER" && appr.expense.approvedProjectCostId === e1Cost[0]!.id);

  // EXP-08：审批原子回滚（外层事务 abort → 无成本、费用保持 PENDING_REVIEW）
  const e8 = await newExpense("1234"); await expSvc.submitExpense({ orgId: OA, projectId: projA.id, expenseId: e8.id, actor: submitter, actorUserId: `${P}submitter` });
  let aborted = false;
  try {
    await db.$transaction(async (tx) => {
      await expSvc.approveExpense({ tx, orgId: OA, projectId: projA.id, expenseId: e8.id, actor: accountant, reviewerUserId: `${P}accountant` });
      throw new Error("abort");
    });
  } catch { aborted = true; }
  const e8After = await db.projectExpenseSubmission.findUnique({ where: { id: e8.id } });
  const e8Cost = await db.projectCost.count({ where: { orgId: OA, projectId: projA.id, costStatus: "ACTUAL", refs: { path: ["expenseSubmissionId"], equals: e8.id } } });
  ok("EXP-08 审批+成本+事件原子回滚（abort 后零残留）", aborted && e8After?.status === "PENDING_REVIEW" && e8Cost === 0);

  // EXP-09：self approval blocked（submittedById === reviewerUserId）
  const e9 = await newExpense("2000"); await expSvc.submitExpense({ orgId: OA, projectId: projA.id, expenseId: e9.id, actor: submitter, actorUserId: `${P}submitter` });
  let selfBlocked = false;
  try {
    await expSvc.approveExpense({ orgId: OA, projectId: projA.id, expenseId: e9.id, actor: submitter, reviewerUserId: `${P}submitter` });
  } catch (e) { selfBlocked = code(e) === "EXPENSE_SELF_APPROVAL_FORBIDDEN"; }
  ok("EXP-09 自审批被服务端拒绝 + 费用保持 PENDING_REVIEW", selfBlocked && (await db.projectExpenseSubmission.findUnique({ where: { id: e9.id } }))?.status === "PENDING_REVIEW");

  // EXP-11：cross-org blocked
  let crossOrg = false;
  try { await expSvc.approveExpense({ orgId: `${P}org_b`, projectId: projA.id, expenseId: e9.id, actor: accountant, reviewerUserId: `${P}accountant` }); }
  catch (e) { crossOrg = code(e) === "FINANCE_TENANT_MISMATCH"; }
  ok("EXP-11 跨 org 审批被拒", crossOrg);

  // EXP-12：cross-project blocked
  let crossProj = false;
  try { await expSvc.approveExpense({ orgId: OA, projectId: `${P}proj_b`, expenseId: e9.id, actor: accountant, reviewerUserId: `${P}accountant` }); }
  catch (e) { crossProj = code(e) === "FINANCE_TENANT_MISMATCH"; }
  ok("EXP-12 跨 project 审批被拒", crossProj);

  // EXP-13：attachment provenance + immutability（模型层；blob I/O 由 route/手工验证）
  const att = await db.projectExpenseAttachment.create({
    data: { orgId: OA, projectId: projA.id, expenseSubmissionId: e9.id, kind: "receipt", originalFilename: "r.jpg", mimeType: "image/jpeg", fileSize: 1000, contentHash: `${P}hash9`, storageKey: `k9`, blobUrl: "/api/files/k9", uploadedById: `${P}submitter`, capturedAt: new Date() },
  });
  let dupRejected = false;
  try {
    await db.projectExpenseAttachment.create({ data: { orgId: OA, projectId: projA.id, expenseSubmissionId: e9.id, kind: "receipt", originalFilename: "r2.jpg", mimeType: "image/jpeg", fileSize: 1000, contentHash: `${P}hash9`, storageKey: `k9b`, blobUrl: "/api/files/k9b", uploadedById: `${P}submitter`, capturedAt: new Date() } });
  } catch (e) { dupRejected = code(e) === "P2002"; }
  ok("EXP-13 票据 contentHash provenance 保留 + 同 hash 去重（不可变原件）", att.contentHash === `${P}hash9` && dupRejected);

  // EXP-14：approved expense 不可实质修改（其 ProjectCost.ACTUAL revise 抛错）
  const { revisePlannedCost } = await import("@/lib/project-ledger/cost-service");
  let actualImmutable = false;
  try { await revisePlannedCost({ orgId: OA, projectId: projA.id, costId: e1Cost[0]!.id, actor: accountant, changes: { amount: "9999" } }); }
  catch (e) { actualImmutable = code(e) === "COST_LIFECYCLE_VIOLATION"; }
  ok("EXP-14 已审批费用的 ProjectCost.ACTUAL 不可原地改（须 void+correction）", actualImmutable);

  // EXP-15：double approval idempotent
  const dup = await expSvc.approveExpense({ orgId: OA, projectId: projA.id, expenseId: e1.id, actor: accountant, reviewerUserId: `${P}accountant` });
  const e1CostCount = (await db.projectCost.count({ where: { orgId: OA, projectId: projA.id, refs: { path: ["expenseSubmissionId"], equals: e1.id } } }));
  const e1ApprovedEvents = (await db.projectEvent.count({ where: { eventKey: `expense.approved:${e1.id}` } }));
  ok("EXP-15 double approval 幂等（created=false，仍恰一条 ProjectCost + 一条 approved 事件）",
    dup.created === false && dup.cost?.id === e1Cost[0]!.id && e1CostCount === 1 && e1ApprovedEvents === 1);

  // EXP-16：concurrent approval no duplicate
  const e16 = await newExpense("7777"); await expSvc.submitExpense({ orgId: OA, projectId: projA.id, expenseId: e16.id, actor: submitter, actorUserId: `${P}submitter` });
  const results = await Promise.allSettled(
    Array.from({ length: 5 }, () => expSvc.approveExpense({ orgId: OA, projectId: projA.id, expenseId: e16.id, actor: accountant, reviewerUserId: `${P}accountant` })),
  );
  const created = results.filter((r) => r.status === "fulfilled" && r.value.created).length;
  const e16Costs = await db.projectCost.count({ where: { orgId: OA, projectId: projA.id, refs: { path: ["expenseSubmissionId"], equals: e16.id } } });
  const e16Events = await db.projectEvent.count({ where: { eventKey: `expense.approved:${e16.id}` } });
  ok("EXP-16 并发审批不产重复（恰一 created，恰一 ProjectCost，恰一 approved 事件）",
    created === 1 && e16Costs === 1 && e16Events === 1, { created, e16Costs, e16Events });

  // ─────────────── COST-READ ───────────────
  console.log("━━ COST-READ 矩阵 ━━");
  const bva = await readModel.getBudgetVsActual(OA, projA.id);
  // ACTIVE = v2（MATERIAL 90000 + LABOUR 25000 = 115000）；actual = e1(5000)+e16(7777) = 12777（均链 materialLine）
  ok("COST-READ-01 项目总额 budget vs actual 正确",
    bva.total.currentBudgetAmount === "115000" && bva.total.actualAmount === "12777" && bva.total.varianceAmount === "102223",
    bva.total);
  const materialCat = bva.byCategory.find((c) => c.category === "MATERIAL");
  ok("COST-READ-02 类别级 budget vs actual 正确（MATERIAL current 90000 / actual 12777）",
    materialCat?.currentBudgetAmount === "90000" && materialCat?.actualAmount === "12777", materialCat);
  ok("COST-READ baseline（AWARD_BASELINE 快照自 ACTIVE v2）总额保留 115000 且 pendingReview 计数",
    bva.total.baselineAmount === "115000" && typeof bva.pendingReviewCount === "number");

  // ─────────────── EVENT ───────────────
  console.log("━━ EVENT 矩阵 ━━");
  const budgetEvents = await db.projectEvent.findMany({ where: { projectId: projA.id, eventType: { startsWith: "budget." } }, select: { eventType: true, eventKey: true } });
  const budgetTypes = new Set(budgetEvents.map((e) => e.eventType));
  ok("EVENT-01 预算生命周期事件齐备且确定性键",
    budgetTypes.has("budget.created") && budgetTypes.has("budget.version.created") && budgetTypes.has("budget.activated") && budgetTypes.has("budget.baseline_frozen") &&
    budgetEvents.some((e) => e.eventKey === `budget.baseline_frozen:${frozen.id}`));
  const expTypes = new Set((await db.projectEvent.findMany({ where: { projectId: projA.id, eventType: { startsWith: "expense." } }, select: { eventType: true } })).map((e) => e.eventType));
  ok("EVENT-02 费用生命周期事件齐备",
    ["expense.created", "expense.submitted", "expense.info_requested", "expense.resubmitted", "expense.rejected", "expense.approved"].every((t) => expTypes.has(t)));
  const apprEvent = await db.projectEvent.findFirst({ where: { eventKey: `expense.approved:${e1.id}` }, select: { relatedCostId: true } });
  const costRecorded = await db.projectEvent.count({ where: { eventType: "cost.recorded", relatedCostId: e1Cost[0]!.id } });
  ok("EVENT-03 approval 事件 relatedCostId 与 ProjectCost 一致 + cost.recorded 存在",
    apprEvent?.relatedCostId === e1Cost[0]!.id && costRecorded === 1);

  // ─────────────── EXP-ACTIVE（§BLOCKER1：isLedgerProducerActive = SCHEMA_READY && PRODUCERS_ENABLED）───────────────
  // 置于 projA 全部读模型度量之后，approve 产生的额外成本不影响上文断言。
  console.log("━━ EXP-ACTIVE 矩阵（T3.5 双闸）━━");
  async function pendingExpense(amount: string) {
    const e = await newExpense(amount);
    await expSvc.submitExpense({ orgId: OA, projectId: projA.id, expenseId: e.id, actor: submitter, actorUserId: `${P}submitter` });
    return e;
  }
  async function approveOutcome(expenseId: string) {
    let threw = false;
    try { await expSvc.approveExpense({ orgId: OA, projectId: projA.id, expenseId, actor: accountant, reviewerUserId: `${P}accountant` }); }
    catch { threw = true; }
    const actualCosts = await db.projectCost.count({ where: { orgId: OA, projectId: projA.id, costStatus: "ACTUAL", refs: { path: ["expenseSubmissionId"], equals: expenseId } } });
    const row = await db.projectExpenseSubmission.findUnique({ where: { id: expenseId }, select: { status: true } });
    return { threw, actualCosts, status: row?.status ?? "?" };
  }
  const eA1 = await pendingExpense("111"); setLedgerFlags(false, true);
  const rA1 = await approveOutcome(eA1.id);
  ok("EXP-ACTIVE-01 SCHEMA_READY=false&PRODUCER=true → fail-closed：拒绝且零 ProjectCost.ACTUAL",
    rA1.threw && rA1.actualCosts === 0 && rA1.status === "PENDING_REVIEW", rA1);
  const eA2 = await pendingExpense("222"); setLedgerFlags(true, false);
  const rA2 = await approveOutcome(eA2.id);
  ok("EXP-ACTIVE-02 SCHEMA_READY=true&PRODUCER=false → 拒绝且零 ProjectCost.ACTUAL",
    rA2.threw && rA2.actualCosts === 0 && rA2.status === "PENDING_REVIEW", rA2);
  const eA3 = await pendingExpense("333"); setLedgerFlags(true, true);
  const rA3 = await approveOutcome(eA3.id);
  ok("EXP-ACTIVE-03 SCHEMA_READY=true&PRODUCER=true → 审批产恰一条 ProjectCost.ACTUAL",
    !rA3.threw && rA3.actualCosts === 1 && rA3.status === "APPROVED", rA3);
  setLedgerFlags(true, true); // 恢复双闸

  // ─────────────── BUDGET-AWARD（§BLOCKER2：中标资格 + 来源必须当前 ACTIVE）───────────────
  console.log("━━ BUDGET-AWARD 矩阵 ━━");
  async function mkProj(id: string, award: Record<string, unknown>) {
    return db.project.create({ data: { id: `${P}${id}`, name: id, orgId: OA, ownerId: `${P}submitter`, ...award } });
  }
  async function mkVersion(projectId: string, amount: string, activate: boolean) {
    const { version } = await budgetSvc.createBudgetVersion({ orgId: OA, projectId, currency: "CAD", actor: submitter, createdById: `${P}submitter`, lines: [{ category: "MATERIAL", amount }] });
    if (activate) await budgetSvc.activateBudgetVersion({ orgId: OA, projectId, versionId: version.id, actor: submitter, actorUserId: `${P}submitter` });
    return version;
  }
  const freezeArgs = (projectId: string, sourceVersionId?: string) => ({ orgId: OA, projectId, actor: submitter, actorUserId: `${P}submitter`, ...(sourceVersionId ? { sourceVersionId } : {}) });

  // BUDGET-AWARD-01：非中标项目（无任何 award 信号）→ 拒绝
  const pNA = await mkProj("proj_na", { workDomain: "tender" });
  await mkVersion(pNA.id, "50000", true);
  let awNa = false;
  try { await budgetSvc.freezeAwardBaseline(freezeArgs(pNA.id)); } catch (e) { awNa = code(e) === "PROJECT_NOT_AWARDED"; }
  ok("BUDGET-AWARD-01 非中标项目不能冻结 baseline（PROJECT_NOT_AWARDED）", awNa);

  // BUDGET-AWARD-01b：落标但已公布结果（tenderStatus=lost + awardDate 非空）→ 仍拒绝。
  // awardDate 是「结果公布时间」，won/lost 都可能有值，绝不是「我方中标」信号（Final Remediation 审计）。
  const pLost = await mkProj("proj_lost", { tenderStatus: "lost", awardDate: new Date("2026-07-01") });
  await mkVersion(pLost.id, "50000", true);
  let awLost = false;
  try { await budgetSvc.freezeAwardBaseline(freezeArgs(pLost.id)); } catch (e) { awLost = code(e) === "PROJECT_NOT_AWARDED"; }
  ok("BUDGET-AWARD-01b 落标+已公布结果（awardDate 非空）仍不能冻结（awardDate≠中标信号）", awLost);

  // BUDGET-AWARD-02：中标项目（tenderStatus=won）可冻结（默认 source=当前 ACTIVE）
  const pAw2 = await mkProj("proj_aw2", { tenderStatus: "won" });
  await mkVersion(pAw2.id, "60000", true);
  const aw2 = await budgetSvc.freezeAwardBaseline(freezeArgs(pAw2.id));
  ok("BUDGET-AWARD-02 中标/合同确认项目可冻结 baseline", aw2.status === "AWARD_BASELINE" && aw2.totalBudgetAmount.toString() === "60000");

  // proj_aw（workDomain=delivery，中标）：v1→active，v2→active（v1 superseded），v3 draft
  const pAw = await mkProj("proj_aw", { workDomain: "delivery" });
  const awV1 = await mkVersion(pAw.id, "70000", true);
  const awV2 = await mkVersion(pAw.id, "80000", true);
  const awV3Draft = await mkVersion(pAw.id, "90000", false);

  // BUDGET-AWARD-03：DRAFT source 被拒
  let awDraft = false;
  try { await budgetSvc.freezeAwardBaseline(freezeArgs(pAw.id, awV3Draft.id)); } catch (e) { awDraft = code(e) === "FINANCE_CONTRACT_VIOLATION"; }
  ok("BUDGET-AWARD-03 DRAFT source 冻结被拒（须当前 ACTIVE）", awDraft);

  // BUDGET-AWARD-04：SUPERSEDED source 被拒
  let awSup = false;
  try { await budgetSvc.freezeAwardBaseline(freezeArgs(pAw.id, awV1.id)); } catch (e) { awSup = code(e) === "FINANCE_CONTRACT_VIOLATION"; }
  ok("BUDGET-AWARD-04 SUPERSEDED source 冻结被拒（须当前 ACTIVE）", awSup);

  // BUDGET-AWARD-05：current ACTIVE source（v2）成功
  const aw5 = await budgetSvc.freezeAwardBaseline(freezeArgs(pAw.id, awV2.id));
  ok("BUDGET-AWARD-05 current ACTIVE source 冻结成功", aw5.status === "AWARD_BASELINE" && aw5.totalBudgetAmount.toString() === "80000");

  // ─────────────── BUDGET-CONC（§BLOCKER3：ProjectBudget 行 FOR UPDATE 并发闸）───────────────
  console.log("━━ BUDGET-CONC 矩阵 ━━");
  // CONC-01：两个不同 DRAFT 版本并发 activate → 恰一 ACTIVE + currentVersionId 指向它
  const pC1 = await mkProj("proj_conc1", { workDomain: "delivery" });
  const c1a = await mkVersion(pC1.id, "10000", false);
  const c1b = await mkVersion(pC1.id, "20000", false);
  await Promise.allSettled([
    budgetSvc.activateBudgetVersion({ orgId: OA, projectId: pC1.id, versionId: c1a.id, actor: submitter, actorUserId: `${P}submitter` }),
    budgetSvc.activateBudgetVersion({ orgId: OA, projectId: pC1.id, versionId: c1b.id, actor: submitter, actorUserId: `${P}submitter` }),
  ]);
  const c1Budget = await db.projectBudget.findUnique({ where: { orgId_projectId: { orgId: OA, projectId: pC1.id } } });
  const c1Actives = await db.projectBudgetVersion.findMany({ where: { budgetId: c1Budget!.id, status: "ACTIVE" }, select: { id: true } });
  ok("BUDGET-CONC-01 并发 activate → 恰一 ACTIVE + currentVersionId 指向它",
    c1Actives.length === 1 && c1Budget?.currentVersionId === c1Actives[0]!.id, { actives: c1Actives.length, current: c1Budget?.currentVersionId });

  // CONC-02：单 ACTIVE 版本，两并发 freeze → 恰一 AWARD_BASELINE，双方收敛同一 baseline
  const pC2 = await mkProj("proj_conc2", { workDomain: "delivery" });
  await mkVersion(pC2.id, "30000", true);
  const [f1, f2] = await Promise.allSettled([
    budgetSvc.freezeAwardBaseline(freezeArgs(pC2.id)),
    budgetSvc.freezeAwardBaseline(freezeArgs(pC2.id)),
  ]);
  const c2Budget = await db.projectBudget.findUnique({ where: { orgId_projectId: { orgId: OA, projectId: pC2.id } } });
  const c2Baselines = await db.projectBudgetVersion.count({ where: { budgetId: c2Budget!.id, status: "AWARD_BASELINE" } });
  const f1id = f1.status === "fulfilled" ? f1.value.id : "f1?";
  const f2id = f2.status === "fulfilled" ? f2.value.id : "f2?";
  ok("BUDGET-CONC-02 并发 freeze → 恰一 AWARD_BASELINE，双方收敛同一 baseline",
    c2Baselines === 1 && f1.status === "fulfilled" && f2.status === "fulfilled" && f1id === f2id && f1id === c2Budget?.awardBaselineVersionId,
    { baselines: c2Baselines, f1id, f2id });

  await cleanup();
  console.log(`\n结果: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error("[p15-finance-db] FAIL", e); process.exit(1); });
