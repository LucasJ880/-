/**
 * T2-P1.6 盈利 / 结算 / 多币种 — DB 集成矩阵（隔离库；非隔离自动跳过）
 *
 * 覆盖任务书 §18 中需要真实 Postgres 的契约：
 *   EXP-MOBILE-01..06 / REIMB-01..07 / EXP-APP-01..04 /
 *   FX-SETTLE-01..04 / TENDER-COST-01..04 / LOSS-01..03 / PORT-01..06
 *
 * 运行：DATABASE_URL=<隔离分支> DIRECT_URL=<同> NODE_ENV=test \
 *       DATABASE_ENVIRONMENT=isolated npx tsx <本文件>
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

if (!process.env.DATABASE_URL?.trim()) {
  console.log("⏭  跳过 T2-P1.6 盈利 DB 测试（未提供 DATABASE_URL）");
  process.exit(0);
}
assertSafeTestDatabase({ scriptName: "project-finance p16 db test" });
if (process.env.NODE_ENV !== "test") {
  console.log("⏭  跳过 T2-P1.6 盈利 DB 测试（需 NODE_ENV=test）");
  process.exit(0);
}
// 隔离库显式开四闸（生产默认全 OFF）
process.env.T2_LEDGER_SCHEMA_READY = "true";
process.env.T2_LEDGER_PRODUCERS_ENABLED = "true";
process.env.TENDER_FINANCIAL_CONTROL_ENABLED = "true";
process.env.TENDER_PROFITABILITY_SCHEMA_READY = "true";

const P = "qy_t2p16_";
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
  const expSvc = await import("../expense-service");
  const settleSvc = await import("../settlement-service");
  const fxSettleSvc = await import("../fx-settlement-service");
  const revenueSvc = await import("../revenue-service");
  const lossSvc = await import("../loss-review-service");
  const profit = await import("../profitability");
  const portfolio = await import("../portfolio");
  const flags = await import("../flags");

  const submitter = { actorType: "user" as const, actorId: `${P}submitter` };
  const accountant = { actorType: "user" as const, actorId: `${P}accountant` };
  const finance = { actorType: "user" as const, actorId: `${P}finance` };
  const SUB = `${P}submitter`;
  const ACC = `${P}accountant`;
  const FIN = `${P}finance`;

  async function cleanup() {
    await db.projectExpensePayment.deleteMany({ where: { orgId: { startsWith: P } } });
    await db.projectExpensePayable.deleteMany({ where: { orgId: { startsWith: P } } });
    await db.projectExpenseFxSettlement.deleteMany({ where: { orgId: { startsWith: P } } });
    await db.projectRevenueEntry.deleteMany({ where: { orgId: { startsWith: P } } });
    await db.projectTenderLossReview.deleteMany({ where: { orgId: { startsWith: P } } });
    await db.projectExpenseAttachment.deleteMany({ where: { orgId: { startsWith: P } } });
    await db.projectExpenseSubmission.deleteMany({ where: { orgId: { startsWith: P } } });
    await db.projectBudgetLine.deleteMany({ where: { orgId: { startsWith: P } } });
    await db.projectBudgetVersion.deleteMany({ where: { orgId: { startsWith: P } } });
    await db.projectBudget.deleteMany({ where: { orgId: { startsWith: P } } });
    await db.projectEventActor.deleteMany({ where: { orgId: { startsWith: P } } });
    await db.projectEvent.deleteMany({ where: { orgId: { startsWith: P } } });
    await db.projectCost.deleteMany({ where: { orgId: { startsWith: P } } });
    await db.projectHandoff.deleteMany({ where: { orgId: { startsWith: P } } });
    await db.project.deleteMany({ where: { orgId: { startsWith: P } } });
    await db.organization.deleteMany({ where: { id: { startsWith: P } } });
    await db.user.deleteMany({ where: { id: { startsWith: P } } });
  }
  await cleanup();

  for (const s of ["submitter", "accountant", "finance"]) {
    await db.user.create({ data: { id: `${P}${s}`, email: `${P}${s}@t.local`, name: s, role: "user" } });
  }
  for (const o of ["a", "b"]) {
    await db.organization.create({ data: { id: `${P}org_${o}`, name: `${P}Org ${o}`, code: `${P}org-${o}`, ownerId: SUB } });
  }
  const OA = `${P}org_a`;
  const OB = `${P}org_b`;

  // projA：中标 tender（awardDate 2026-07-01）→ 可切分 bid / delivery
  const projA = await db.project.create({
    data: {
      id: `${P}proj_a`, name: "P16 A", orgId: OA, ownerId: SUB,
      workDomain: "tender", bidPhaseStatus: "AWARDED",
      submittedAt: new Date("2026-06-15"), awardDate: new Date("2026-07-01"),
    },
  });
  // projB：另一 org（跨租户闸用）
  await db.project.create({ data: { id: `${P}proj_b`, name: "P16 B", orgId: OB, ownerId: SUB } });

  async function newExpense(opts: {
    project?: string; org?: string; amount: string; currency?: string;
    fxRate?: string | null; fundingSource?: string | null; occurredAt?: Date; submittedById?: string;
  }) {
    return expSvc.createExpenseDraft({
      orgId: opts.org ?? OA,
      projectId: opts.project ?? projA.id,
      actor: submitter,
      submittedById: opts.submittedById ?? SUB,
      costCategory: "SUPPLIER",
      expenseOccurredAt: opts.occurredAt ?? new Date("2026-06-20"),
      description: `expense ${opts.amount} ${opts.currency ?? "CAD"}`,
      totalAmount: opts.amount,
      currency: opts.currency ?? "CAD",
      fxRateCadPerOriginalUnit: opts.fxRate ?? null,
      fxRateSource: opts.fxRate ? "MANUAL" : null,
      fundingSource: opts.fundingSource ?? null,
    });
  }
  async function pending(opts: Parameters<typeof newExpense>[0]) {
    const e = await newExpense(opts);
    await expSvc.submitExpense({
      orgId: opts.org ?? OA, projectId: opts.project ?? projA.id,
      expenseId: e.id, actor: submitter, actorUserId: opts.submittedById ?? SUB,
    });
    return e;
  }
  const approve = (expenseId: string, projectId = projA.id, orgId = OA) =>
    expSvc.approveExpense({ orgId, projectId, expenseId, actor: accountant, reviewerUserId: ACC });

  /* ═══════════════ MOBILE EXPENSE ═══════════════ */
  console.log("━━ EXP-MOBILE 矩阵 ━━");

  const m1 = await newExpense({ amount: "23.00", fundingSource: "EMPLOYEE_PERSONAL" });
  ok("EXP-MOBILE-01 active member 可提交本人费用（含出资来源 + 垫资人）",
    m1.submittedById === SUB && m1.fundingSource === "EMPLOYEE_PERSONAL" && m1.paidByUserId === SUB);

  let forged = false;
  try {
    await expSvc.createExpenseDraft({
      orgId: OA, projectId: projA.id, actor: submitter, submittedById: SUB,
      costCategory: "SUPPLIER", expenseOccurredAt: new Date(), description: "forge",
      totalAmount: "50", currency: "CAD",
      fundingSource: "EMPLOYEE_PERSONAL", paidByUserId: ACC, // 声称别人垫付
    });
  } catch (e) { forged = code(e) === "FINANCE_CONTRACT_VIOLATION"; }
  ok("EXP-MOBILE-02 不得代他人申报个人垫付（服务端硬拒）", forged);

  let zeroAmount = false;
  try { await newExpense({ amount: "0" }); } catch (e) { zeroAmount = code(e) === "FINANCE_CONTRACT_VIOLATION"; }
  let negAmount = false;
  try { await newExpense({ amount: "-5" }); } catch (e) { negAmount = code(e) === "FINANCE_CONTRACT_VIOLATION"; }
  ok("EXP-MOBILE-03 金额必填且必须为正（0 / 负数均拒）", zeroAmount && negAmount);

  let noFx = false;
  try { await newExpense({ amount: "100", currency: "CNY", fxRate: null }); }
  catch (e) { noFx = code(e) === "FX_CONTRACT_VIOLATION"; }
  ok("EXP-MOBILE-04 币种必填 + 非 CAD 必须带汇率（否则拒绝，不静默按 1:1）", noFx);

  const att = await db.projectExpenseAttachment.create({
    data: {
      orgId: OA, projectId: projA.id, expenseSubmissionId: m1.id, kind: "receipt",
      originalFilename: "r.heic", mimeType: "image/heic", fileSize: 2048,
      contentHash: `${P}h1`, storageKey: "k1", blobUrl: "/api/files/k1",
      uploadedById: SUB, capturedAt: new Date(),
    },
  });
  const crossOrgAtt = await db.projectExpenseAttachment.findFirst({
    where: { id: att.id, orgId: OB },
  });
  ok("EXP-MOBILE-05 票据 org 隔离（跨 org 查询查不到）", crossOrgAtt === null);

  const confirmEvents = await db.projectEvent.count({
    where: { projectId: projA.id, eventType: "expense.amount_confirmed", eventKey: `expense.amount_confirmed:${m1.id}:t0` },
  });
  ok("EXP-MOBILE-06 金额人工确认留痕（列 + 事件都在）",
    m1.amountConfirmedAt !== null && m1.amountConfirmedById === SUB && confirmEvents === 1);

  // 金额修改：新事件 + 重新确认
  await expSvc.updateExpenseDraft({
    orgId: OA, projectId: projA.id, expenseId: m1.id, actor: submitter, actorUserId: SUB,
    changes: { totalAmount: "28.00" },
  });
  const m1After = await db.projectExpenseSubmission.findUnique({ where: { id: m1.id } });
  const changeEvents = await db.projectEvent.count({
    where: { projectId: projA.id, eventType: "expense.amount_confirmed" },
  });
  ok("EXP-MOBILE 金额改动（23 → 28）产生新的确认事件且金额落库",
    m1After?.totalAmount.toString() === "28" && changeEvents >= 2, { changeEvents });

  let othersEdit = false;
  try {
    await expSvc.updateExpenseDraft({
      orgId: OA, projectId: projA.id, expenseId: m1.id, actor: accountant, actorUserId: ACC,
      changes: { totalAmount: "9999" },
    });
  } catch (e) { othersEdit = code(e) === "FINANCE_CONTRACT_VIOLATION"; }
  ok("EXP-MOBILE 他人不得修改我的费用金额", othersEdit);

  /* ═══════════════ 多币种（FX-02 落库口径）═══════════════ */
  console.log("━━ FX 落库矩阵 ━━");

  const cny = await pending({ amount: "72000", currency: "CNY", fxRate: "0.1917", fundingSource: "CHINA_AFFILIATE" });
  const cnyRow = await db.projectExpenseSubmission.findUnique({ where: { id: cny.id } });
  ok("FX 原始币种与原始金额永久保留 + estimated CAD 快照落库",
    cnyRow?.currency === "CNY" && cnyRow.totalAmount.toString() === "72000" &&
    cnyRow.estimatedCadAmount?.toFixed(2) === "13802.40" &&
    cnyRow.fxRateCadPerOriginalUnit?.toString() === "0.1917" && cnyRow.fxRateSource === "MANUAL");
  const fxLocked = await db.projectEvent.count({
    where: { projectId: projA.id, eventType: "expense.fx_rate_locked" },
  });
  ok("FX 非 CAD 费用产生 fx_rate_locked 事件", fxLocked >= 1);

  const cnyApproved = await approve(cny.id);
  const cnyCost = await db.projectCost.findFirst({
    where: { orgId: OA, projectId: projA.id, refs: { path: ["expenseSubmissionId"], equals: cny.id } },
  });
  ok("FX 权威成本以 CAD 记账（13802.40）且 refs 保留原始币种事实",
    cnyCost?.currency === "CAD" && cnyCost.amountActual?.toFixed(2) === "13802.40" &&
    (cnyCost.refs as Record<string, unknown>)?.originalCurrency === "CNY" &&
    (cnyCost.refs as Record<string, unknown>)?.originalAmount === "72000", cnyCost?.refs);

  /* ═══════════════ REIMBURSEMENT ═══════════════ */
  console.log("━━ REIMB 矩阵 ━━");

  const personal = await pending({ amount: "1280.00", fundingSource: "EMPLOYEE_PERSONAL" });
  const personalRes = await approve(personal.id);
  const personalPayables = await db.projectExpensePayable.count({ where: { expenseSubmissionId: personal.id } });
  ok("REIMB-01 EMPLOYEE_PERSONAL 审批恰产生一条应付（收款人=垫资人）",
    personalPayables === 1 && personalRes.payable?.settlementType === "EMPLOYEE_REIMBURSEMENT" &&
    personalRes.payable.amountCad === "1280", personalRes.payable);

  const card = await pending({ amount: "500.00", fundingSource: "COMPANY_CARD" });
  const cardRes = await approve(card.id);
  ok("REIMB-02 COMPANY_CARD 审批产生零员工应付（成本照记）",
    cardRes.payable === null && (await db.projectExpensePayable.count({ where: { expenseSubmissionId: card.id } })) === 0 &&
    cardRes.cost !== null);

  const bank = await pending({ amount: "600.00", fundingSource: "COMPANY_BANK" });
  const bankRes = await approve(bank.id);
  ok("REIMB-03 COMPANY_BANK 审批产生零员工应付",
    bankRes.payable === null && (await db.projectExpensePayable.count({ where: { expenseSubmissionId: bank.id } })) === 0);

  const legacyFunding = await pending({ amount: "77.00", fundingSource: null });
  const legacyRes = await approve(legacyFunding.id);
  ok("REIMB legacy UNSPECIFIED 出资来源不凭空造应付（fail-closed）", legacyRes.payable === null);

  const payableId = personalRes.payable!.id;
  const costsBefore = await db.projectCost.count({ where: { orgId: OA, projectId: projA.id } });
  const pay1 = await settleSvc.recordPayment({
    orgId: OA, projectId: projA.id, payableId, actor: finance,
    amountCad: "500.00", paidAt: new Date("2026-08-20"), paymentMethod: "ETRANSFER",
    paymentReference: "REF-001", paidById: FIN, clientKey: "k1",
  });
  const costsAfter = await db.projectCost.count({ where: { orgId: OA, projectId: projA.id } });
  ok("REIMB-04 付款不产生第二条 ProjectCost（成本行数不变）", costsBefore === costsAfter, { costsBefore, costsAfter });
  ok("REIMB-05a 部分付款：状态 PARTIALLY_PAID，剩余 780",
    pay1.payable.status === "PARTIALLY_PAID" && pay1.payable.outstandingCad === "780", pay1.payable);

  const dupPay = await settleSvc.recordPayment({
    orgId: OA, projectId: projA.id, payableId, actor: finance,
    amountCad: "500.00", paidAt: new Date("2026-08-20"), paymentMethod: "ETRANSFER",
    paidById: FIN, clientKey: "k1",
  });
  const paymentRows = await db.projectExpensePayment.count({ where: { payableId } });
  ok("REIMB-05b 同 clientKey 重复提交幂等（仍恰一条付款、金额不重复扣减）",
    dupPay.created === false && paymentRows === 1 && dupPay.payable.paidAmountCad === "500");

  const pay2 = await settleSvc.recordPayment({
    orgId: OA, projectId: projA.id, payableId, actor: finance,
    amountCad: "780.00", paidAt: new Date("2026-08-25"), paymentMethod: "ETRANSFER",
    paidById: FIN, clientKey: "k2",
  });
  ok("REIMB-06 付清后状态 PAID 且剩余 0", pay2.payable.status === "PAID" && pay2.payable.outstandingCad === "0");

  let overpay = false;
  try {
    await settleSvc.recordPayment({
      orgId: OA, projectId: projA.id, payableId, actor: finance,
      amountCad: "1.00", paidAt: new Date(), paymentMethod: "CASH", paidById: FIN, clientKey: "k3",
    });
  } catch (e) { overpay = code(e) === "SETTLEMENT_CONTRACT_VIOLATION"; }
  ok("REIMB-07a 已结清不可再付（超付被拒）", overpay);

  // 并发付款：4 笔各 400，应付 1000 → 只能成功 2 笔，绝不超付
  const conc = await pending({ amount: "1000.00", fundingSource: "EMPLOYEE_PERSONAL" });
  const concRes = await approve(conc.id);
  const concPayable = concRes.payable!.id;
  const concResults = await Promise.allSettled(
    Array.from({ length: 4 }, (_, i) =>
      settleSvc.recordPayment({
        orgId: OA, projectId: projA.id, payableId: concPayable, actor: finance,
        amountCad: "400.00", paidAt: new Date(), paymentMethod: "BANK_TRANSFER",
        paidById: FIN, clientKey: `c${i}`,
      }),
    ),
  );
  const concOk = concResults.filter((r) => r.status === "fulfilled").length;
  const concRow = await db.projectExpensePayable.findUnique({ where: { id: concPayable } });
  ok("REIMB-07b 并发付款不可超付（已付 ≤ 应付）",
    concRow!.paidAmountCad.lte(concRow!.amountCad) && concOk === 2 && concRow!.paidAmountCad.toString() === "800",
    { concOk, paid: concRow!.paidAmountCad.toString() });

  const voidTarget = await db.projectExpensePayment.findFirst({ where: { payableId: concPayable } });
  await settleSvc.voidPayment({
    orgId: OA, projectId: projA.id, paymentId: voidTarget!.id, actor: finance,
    voidedById: FIN, reason: "打错账户",
  });
  const afterVoid = await db.projectExpensePayable.findUnique({ where: { id: concPayable } });
  const voidedRow = await db.projectExpensePayment.findUnique({ where: { id: voidTarget!.id } });
  ok("REIMB 付款冲销：append-only（旧行保留 + voidedAt）且已付回退",
    voidedRow?.voidedAt !== null && afterVoid?.paidAmountCad.toString() === "400" &&
    afterVoid.status === "PARTIALLY_PAID");

  /* ═══════════════ APPROVAL ═══════════════ */
  console.log("━━ EXP-APP 矩阵 ━━");

  const a1 = await pending({ amount: "300.00", fundingSource: "COMPANY_CARD" });
  const a1Res = await approve(a1.id);
  const a1Costs = await db.projectCost.count({
    where: { orgId: OA, projectId: projA.id, refs: { path: ["expenseSubmissionId"], equals: a1.id } },
  });
  ok("EXP-APP-01 审批仍恰产一条权威 ProjectCost.ACTUAL", a1Costs === 1 && a1Res.cost !== null);

  const a2 = await pending({ amount: "310.00" });
  let selfBlocked = false;
  try { await expSvc.approveExpense({ orgId: OA, projectId: projA.id, expenseId: a2.id, actor: submitter, reviewerUserId: SUB }); }
  catch (e) { selfBlocked = code(e) === "EXPENSE_SELF_APPROVAL_FORBIDDEN"; }
  const a2Payables = await db.projectExpensePayable.count({ where: { expenseSubmissionId: a2.id } });
  ok("EXP-APP-02 自审批被拒，且不产生任何应付", selfBlocked && a2Payables === 0);

  const a3 = await pending({ amount: "320.00", fundingSource: "EMPLOYEE_PERSONAL" });
  await approve(a3.id);
  const a3Dup = await approve(a3.id);
  const a3Costs = await db.projectCost.count({
    where: { orgId: OA, projectId: projA.id, refs: { path: ["expenseSubmissionId"], equals: a3.id } },
  });
  const a3Payables = await db.projectExpensePayable.count({ where: { expenseSubmissionId: a3.id } });
  ok("EXP-APP-03 double approval 幂等：仍恰一条 ProjectCost + 恰一条 payable（不重复报销）",
    a3Dup.created === false && a3Costs === 1 && a3Payables === 1);

  const a4 = await pending({ amount: "340.00", fundingSource: "EMPLOYEE_PERSONAL" });
  const conc4 = await Promise.allSettled(
    Array.from({ length: 5 }, () => approve(a4.id)),
  );
  const created4 = conc4.filter((r) => r.status === "fulfilled" && r.value.created).length;
  const a4Costs = await db.projectCost.count({
    where: { orgId: OA, projectId: projA.id, refs: { path: ["expenseSubmissionId"], equals: a4.id } },
  });
  const a4Payables = await db.projectExpensePayable.count({ where: { expenseSubmissionId: a4.id } });
  ok("EXP-APP-04a 并发审批：恰一 created、恰一成本、恰一应付",
    created4 === 1 && a4Costs === 1 && a4Payables === 1, { created4, a4Costs, a4Payables });

  // 事务回滚：payable 创建失败 → 成本与状态一并回滚
  const a5 = await pending({ amount: "350.00", fundingSource: "EMPLOYEE_PERSONAL" });
  let aborted = false;
  try {
    await db.$transaction(async (tx) => {
      await expSvc.approveExpense({ tx, orgId: OA, projectId: projA.id, expenseId: a5.id, actor: accountant, reviewerUserId: ACC });
      throw new Error("ABORT");
    });
  } catch { aborted = true; }
  const a5Row = await db.projectExpenseSubmission.findUnique({ where: { id: a5.id } });
  const a5Costs = await db.projectCost.count({
    where: { orgId: OA, projectId: projA.id, refs: { path: ["expenseSubmissionId"], equals: a5.id } },
  });
  const a5Payables = await db.projectExpensePayable.count({ where: { expenseSubmissionId: a5.id } });
  ok("EXP-APP-04b 审批事务回滚：状态/成本/应付零残留",
    aborted && a5Row?.status === "PENDING_REVIEW" && a5Costs === 0 && a5Payables === 0);

  /* ═══════════════ FX SETTLEMENT ═══════════════ */
  console.log("━━ FX-SETTLE 矩阵 ━━");

  const settleRes = await fxSettleSvc.settleExpenseFx({
    orgId: OA, projectId: projA.id, expenseId: cny.id, actor: finance, settledById: FIN,
    settledFxRateCadPerOriginalUnit: "0.19396", settlementDate: new Date("2026-08-10"),
    settledCadAmount: "13965.00", bankFeeCad: "45.00", fxRateSource: "BANK_SETTLEMENT",
  });
  ok("FX-SETTLE-01 差额可审计：final 14010.00 = 13965 + 45，variance +207.60",
    settleRes.settlement.finalCadAmount === "14010" && settleRes.settlement.varianceCad === "207.6",
    settleRes.settlement);

  const oldCost = await db.projectCost.findUnique({ where: { id: cnyCost!.id } });
  const newCost = settleRes.costCorrection
    ? await db.projectCost.findUnique({ where: { id: settleRes.costCorrection.correctedCostId } })
    : null;
  ok("FX-SETTLE-02 原 ACTUAL 从未被原地改额（金额仍 13802.40，状态转 VOIDED）",
    oldCost?.amountActual?.toFixed(2) === "13802.40" && oldCost.costStatus === "VOIDED" && oldCost.voidReason !== null);
  ok("FX-SETTLE-03 修正走既有 VOID + correction 语义（新行 correctionOfCostId 指回旧行，金额=最终 CAD）",
    newCost?.correctionOfCostId === cnyCost!.id && newCost.amountActual?.toFixed(2) === "14010.00" &&
    newCost.costStatus === "ACTUAL" && newCost.currency === "CAD");
  const correctedEvents = await db.projectEvent.count({
    where: { projectId: projA.id, eventKey: `expense.cost_corrected:${cny.id}` },
  });
  const settledEvents = await db.projectEvent.count({
    where: { projectId: projA.id, eventKey: `expense.fx_settled:${cny.id}` },
  });
  ok("FX-SETTLE 事件齐备（fx_settled + cost_corrected 各一条，确定性键）",
    correctedEvents === 1 && settledEvents === 1);

  const repeat = await fxSettleSvc.settleExpenseFx({
    orgId: OA, projectId: projA.id, expenseId: cny.id, actor: finance, settledById: FIN,
    settledFxRateCadPerOriginalUnit: "0.30000", settlementDate: new Date("2026-08-11"),
    settledCadAmount: "21600.00", bankFeeCad: "0",
  });
  const settlementRows = await db.projectExpenseFxSettlement.count({ where: { expenseSubmissionId: cny.id } });
  const voidedCosts = await db.projectCost.count({
    where: { orgId: OA, projectId: projA.id, costStatus: "VOIDED", refs: { path: ["expenseSubmissionId"], equals: cny.id } },
  });
  ok("FX-SETTLE-04 重复结算幂等（恰一条结算记录、不二次 void、返回既有）",
    repeat.created === false && settlementRows === 1 && voidedCosts === 1,
    { settlementRows, voidedCosts });

  const cadOnly = await pending({ amount: "50.00" });
  await approve(cadOnly.id);
  let cadSettleRejected = false;
  try {
    await fxSettleSvc.settleExpenseFx({
      orgId: OA, projectId: projA.id, expenseId: cadOnly.id, actor: finance, settledById: FIN,
      settledFxRateCadPerOriginalUnit: "1", settlementDate: new Date(), settledCadAmount: "50",
    });
  } catch (e) { cadSettleRejected = code(e) === "FINANCE_CONTRACT_VIOLATION"; }
  ok("FX-SETTLE CAD 费用无结算差额概念（拒绝多余 FX 流程）", cadSettleRejected);

  /* ═══════════════ TENDER COST（阶段切分）═══════════════ */
  console.log("━━ TENDER-COST 矩阵 ━━");

  // projA：awardDate 2026-07-01。已有成本 incurredAt 均为 2026-06-20 → PRE_AWARD。
  // 追加一条交付期成本（2026-08-05）
  const post = await pending({ amount: "10000.00", occurredAt: new Date("2026-08-05"), fundingSource: "COMPANY_BANK" });
  await approve(post.id);

  const sumA = await profit.getTenderFinancialSummary(OA, projA.id);
  const bid = Number(sumA.bidCostCad);
  const delivery = Number(sumA.deliveryCostCad);
  ok("TENDER-COST-02 WON tender 保留 pre-award 投标成本（bid > 0）", bid > 0, { bid });
  ok("TENDER-COST-03 交付期成本不抹掉投标成本（两者并存）", delivery === 10000 && bid > 0, { bid, delivery });
  ok("TENDER-COST-04 total = bid + delivery",
    Number(sumA.totalCostCad).toFixed(2) === (bid + delivery).toFixed(2), sumA.totalCostCad);
  ok("TENDER-COST 阶段边界来源可审计（awardDate）",
    sumA.phaseSplitAvailable === true && sumA.phaseBoundarySource === "awardDate");

  // 落标项目：全部成本留作投标成本
  const projLost = await db.project.create({
    data: {
      id: `${P}proj_lost`, name: "P16 LOST", orgId: OA, ownerId: SUB, workDomain: "tender",
      bidPhaseStatus: "LOST", tenderStatus: "lost",
      submittedAt: new Date("2026-07-10"), awardDate: new Date("2026-08-01"),
    },
  });
  const lostExp = await pending({ project: projLost.id, amount: "7850.00", occurredAt: new Date("2026-08-05"), fundingSource: "COMPANY_CARD" });
  await approve(lostExp.id, projLost.id);
  const sumLost = await profit.getTenderFinancialSummary(OA, projLost.id);
  ok("TENDER-COST-01 LOST tender 全部费用保留且计为投标成本（awardDate 不误当交付边界）",
    sumLost.outcome === "LOST" && sumLost.bidCostCad === "7850" && sumLost.deliveryCostCad === "0" &&
    sumLost.lostTenderSpendCad === "7850", { bid: sumLost.bidCostCad, delivery: sumLost.deliveryCostCad });

  /* ═══════════════ REVENUE / PROFIT ═══════════════ */
  console.log("━━ REVENUE / PROFIT 矩阵 ━━");

  await revenueSvc.recordRevenueEntry({
    orgId: OA, projectId: projA.id, actor: accountant, entryType: "CONTRACT_AWARD",
    originalAmount: "1000000", originalCurrency: "CAD", recognizedAt: new Date("2026-07-02"),
    createdById: ACC,
  });
  await revenueSvc.recordRevenueEntry({
    orgId: OA, projectId: projA.id, actor: accountant, entryType: "CHANGE_ORDER",
    originalAmount: "80000", originalCurrency: "CAD", recognizedAt: new Date("2026-08-01"),
    changeOrderReference: "CO-001", approvedById: ACC, createdById: ACC,
  });
  const sumA2 = await profit.getTenderFinancialSummary(OA, projA.id);
  ok("REVENUE 合同额与已批变更单分列，预测收入 = 1,080,000",
    sumA2.contractRevenueCad === "1000000" && sumA2.approvedChangeOrdersCad === "80000" &&
    sumA2.forecastRevenueCad === "1080000");
  ok("PROFIT forecast profit = 预测收入 − 总成本，且带毛利率",
    sumA2.forecastProfitCad === (1080000 - Number(sumA2.totalCostCad)).toString() &&
    sumA2.forecastMarginPercentage !== null, sumA2.forecastProfitCad);
  ok("PROFIT 施工未完成 → final profit 为 null 且列出 blockers（不无证据宣称最终利润）",
    sumA2.finalProfitCad === null && sumA2.finalProfitEligible === false &&
    sumA2.finalProfitBlockers.length > 0, sumA2.finalProfitBlockers);

  let coNoApprover = false;
  try {
    await revenueSvc.recordRevenueEntry({
      orgId: OA, projectId: projA.id, actor: accountant, entryType: "CHANGE_ORDER",
      originalAmount: "1000", originalCurrency: "CAD", recognizedAt: new Date(), createdById: ACC,
    });
  } catch (e) { coNoApprover = code(e) === "REVENUE_LIFECYCLE_VIOLATION"; }
  ok("REVENUE 变更单必须有人工批准人（AI 不得自动批准变更收入）", coNoApprover);

  /* ═══════════════ LOSS REVIEW ═══════════════ */
  console.log("━━ LOSS 矩阵 ━━");

  const suggested = await lossSvc.suggestLossReasons({
    orgId: OA, projectId: projLost.id, actor: { actorType: "ai", actorId: "ai:analysis" },
    suggestedPrimary: "PRICE_HIGH", suggestedSecondary: ["EXPERIENCE"],
    sourceRef: "analysisRun:x1", createdById: SUB,
  });
  ok("LOSS-03 AI 建议只写 aiSuggested*，最终原因仍为空（结构性保证）",
    suggested.aiSuggestedPrimaryReason === "PRICE_HIGH" && suggested.primaryLossReason === null &&
    suggested.status === "DRAFT" && suggested.humanConfirmedAt === null);

  let aiConfirmBlocked = false;
  try {
    await lossSvc.confirmLossReview({
      orgId: OA, projectId: projLost.id, actor: { actorType: "ai", actorId: "ai:analysis" },
      confirmedByUserId: SUB, primaryLossReason: "PRICE_HIGH",
    });
  } catch (e) { aiConfirmBlocked = code(e) === "LOSS_REVIEW_CONTRACT_VIOLATION"; }
  ok("LOSS-02 AI actor 不得确认最终原因（必须真人）", aiConfirmBlocked);

  const confirmed = await lossSvc.confirmLossReview({
    orgId: OA, projectId: projLost.id, actor: accountant, confirmedByUserId: ACC,
    primaryLossReason: "PRICE_HIGH", secondaryLossReasons: ["EXPERIENCE", "EXPERIENCE"],
    ourBidAmountCad: "980000", winningBidAmountCad: "910000", winnerName: "Competitor Inc",
    evidence: [{ kind: "award_notice", note: "公开中标公告" }],
  });
  ok("LOSS-01 落标项目可记录结构化原因（primary 单选 + secondary 去重 + 证据 + 人工确认留痕）",
    confirmed.status === "CONFIRMED" && confirmed.primaryLossReason === "PRICE_HIGH" &&
    confirmed.secondaryLossReasons.length === 1 && confirmed.humanConfirmedById === ACC &&
    confirmed.winningBidAmountCad?.toString() === "910000");

  let dupReason = false;
  try {
    await lossSvc.confirmLossReview({
      orgId: OA, projectId: projLost.id, actor: accountant, confirmedByUserId: ACC,
      primaryLossReason: "PRICE_HIGH", secondaryLossReasons: ["PRICE_HIGH"],
    });
  } catch (e) { dupReason = code(e) === "LOSS_REVIEW_CONTRACT_VIOLATION"; }
  ok("LOSS 次要原因不得与主要原因重复", dupReason);

  let wonLossBlocked = false;
  try {
    await lossSvc.ensureLossReview({ orgId: OA, projectId: projA.id, actor: accountant, createdById: ACC });
  } catch (e) { wonLossBlocked = code(e) === "LOSS_REVIEW_CONTRACT_VIOLATION"; }
  ok("LOSS 中标项目不得建落标复盘（结果读既有 canonical 字段）", wonLossBlocked);

  /* ═══════════════ PORTFOLIO（12 投 / 3 中 / 9 落）═══════════════ */
  console.log("━━ PORT 矩阵（6–8 月 cohort：12 投 / 3 中 / 9 落）━━");

  const orgP = `${P}org_p`;
  await db.organization.create({ data: { id: orgP, name: "P16 Portfolio", code: `${P}org-p`, ownerId: SUB } });

  // 3 中标 + 9 落标；每个 tender 一笔 CAD 投标成本
  const wonIds: string[] = [];
  const lostIds: string[] = [];
  for (let i = 0; i < 12; i += 1) {
    const isWon = i < 3;
    const id = `${P}pf_${i}`;
    await db.project.create({
      data: {
        id, name: `PF ${i}`, orgId: orgP, ownerId: SUB, workDomain: "tender",
        submittedAt: new Date(`2026-0${6 + (i % 3)}-1${i % 9}`),
        ...(isWon
          ? { bidPhaseStatus: "AWARDED", awardDate: new Date("2026-08-20") }
          : { bidPhaseStatus: "LOST", tenderStatus: "lost", awardDate: new Date("2026-08-25") }),
        estimatedValue: 500000,
        currency: "CAD",
      },
    });
    (isWon ? wonIds : lostIds).push(id);
    // 每个项目一笔投标成本（中标 1000 / 落标 500）；发生日早于 awardDate → PRE_AWARD
    const e = await pending({
      project: id, org: orgP, amount: isWon ? "1000.00" : "500.00",
      occurredAt: new Date("2026-06-25"), fundingSource: "COMPANY_CARD",
    });
    await approve(e.id, id, orgP);
  }
  // 中标项目收入：每个 200,000 合同额；其中 1 个已完工 + 已实现 → 具备 final 资格
  for (const [idx, id] of wonIds.entries()) {
    await revenueSvc.recordRevenueEntry({
      orgId: orgP, projectId: id, actor: accountant, entryType: "CONTRACT_AWARD",
      originalAmount: "200000", originalCurrency: "CAD", recognizedAt: new Date("2026-08-21"),
      createdById: ACC, asRecognized: idx === 0,
    });
    if (idx === 0) {
      await db.project.update({ where: { id }, data: { actualCompletionDate: new Date("2026-08-30") } });
    }
  }
  // 落标复盘：5 个 PRICE_HIGH、2 个 TECHNICAL（其余未复盘）
  for (const [idx, id] of lostIds.entries()) {
    if (idx >= 7) continue;
    await lossSvc.confirmLossReview({
      orgId: orgP, projectId: id, actor: accountant, confirmedByUserId: ACC,
      primaryLossReason: idx < 5 ? "PRICE_HIGH" : "TECHNICAL",
    });
  }

  const pf = await portfolio.getTenderPortfolioSummary(orgP, {
    from: new Date("2026-06-01T00:00:00.000Z"),
    to: new Date("2026-08-31T23:59:59.999Z"),
  });
  ok("PORT-01 cohort 用 canonical submitted date（submittedAt 落在窗口内的 12 个项目）",
    pf.tenderSubmittedCount === 12, pf.tenderSubmittedCount);
  ok("PORT-02 12 投 / 3 中 / 9 落 + win rate 25%",
    pf.wonCount === 3 && pf.lostCount === 9 && pf.winRatePercentage === "25",
    { won: pf.wonCount, lost: pf.lostCount, rate: pf.winRatePercentage });
  ok("PORT-03 落标投入正确聚合（9 × 500 = 4500）",
    pf.lostTenderBidCostCad === "4500" && pf.lostTenderTotalSpendCad === "4500",
    { bid: pf.lostTenderBidCostCad, spend: pf.lostTenderTotalSpendCad });
  ok("PORT-04 中标投标成本正确聚合（3 × 1000 = 3000）+ 总投标成本 7500",
    pf.wonTenderBidCostCad === "3000" && pf.totalBidCostCad === "7500");
  ok("PORT-04b 获客成本口径分离（含失败 2500/中标；仅中标 1000/中标；每标均 625）",
    pf.averageCostPerWinCad === "2500" && pf.awardAcquisitionCostPerWinCad === "1000" &&
    pf.averageBidCostPerTenderCad === "625",
    { perWin: pf.averageCostPerWinCad, acq: pf.awardAcquisitionCostPerWinCad, perTender: pf.averageBidCostPerTenderCad });
  ok("PORT-05 forecast 与 final 利润分列且不相加（1 个已终结 / 2 个在建）",
    pf.wonProjects.finalizedProjectCount === 1 && pf.wonProjects.currentForecastProjectCount === 2 &&
    pf.wonProjects.finalizedProfitCad === "199000" && pf.wonProjects.currentForecastProfitCad === "398000",
    pf.wonProjects);
  ok("PORT 失败原因 Top-N + 分组统计正确（PRICE_HIGH 5 / TECHNICAL 2；2 个未复盘如实暴露）",
    pf.lossReasons.topReasons[0]?.reason === "PRICE_HIGH" && pf.lossReasons.topReasons[0]?.count === 5 &&
    pf.lossReasons.topReasons[1]?.count === 2 && pf.lossReasons.unreviewedLostCount === 2 &&
    pf.lossReasons.byGroup.find((g) => g.group === "PRICE")?.count === 5,
    pf.lossReasons);
  ok("PORT 标的额显式标注为非权威 indicative（Float 字段），权威中标额来自收入账",
    pf.indicativeTenderValue.note === "INDICATIVE_ONLY_NON_AUTHORITATIVE_FLOAT_FIELD" &&
    pf.indicativeTenderValue.totalCad === "6000000" && pf.awardedValueCad === "600000",
    { indicative: pf.indicativeTenderValue, awarded: pf.awardedValueCad });

  const emptyWindow = await portfolio.getTenderPortfolioSummary(orgP, {
    from: new Date("2020-01-01"), to: new Date("2020-12-31"),
  });
  ok("PORT-06 空 cohort：win rate = null（零分母不造 0% 也不造 NaN）",
    emptyWindow.tenderSubmittedCount === 0 && emptyWindow.winRatePercentage === null &&
    emptyWindow.averageCostPerWinCad === null);

  /* ═══════════════ FLAG FAIL-CLOSED ═══════════════ */
  console.log("━━ FLAG fail-closed 矩阵 ━━");

  delete process.env.TENDER_PROFITABILITY_SCHEMA_READY;
  ok("FLAG default OFF", flags.isProfitabilitySchemaReady() === false);
  const darkExp = await pending({ amount: "60.00", fundingSource: "EMPLOYEE_PERSONAL" });
  const darkRes = await approve(darkExp.id);
  const darkPayables = await db.projectExpensePayable.count({ where: { expenseSubmissionId: darkExp.id } });
  ok("FLAG OFF 时审批退化为 P1.5 语义（仍产成本，但不产应付；零回归）",
    darkRes.cost !== null && darkRes.payable === null && darkPayables === 0);
  const darkSummary = await profit.getTenderFinancialSummary(OA, projA.id);
  ok("FLAG OFF 时读模型 fail-closed（收入/结算 unavailable，利润为 null，不抛缺表）",
    darkSummary.revenueAvailable === false && darkSummary.settlementAvailable === false &&
    darkSummary.forecastProfitCad === null && darkSummary.finalProfitCad === null &&
    Number(darkSummary.totalCostCad) > 0);
  process.env.TENDER_PROFITABILITY_SCHEMA_READY = "true";

  /* ═══════════════ 跨租户 ═══════════════ */
  console.log("━━ 租户隔离 ━━");
  let crossOrgSettle = false;
  try {
    await settleSvc.recordPayment({
      orgId: OB, projectId: projA.id, payableId: concPayable, actor: finance,
      amountCad: "1", paidAt: new Date(), paymentMethod: "CASH", paidById: FIN, clientKey: "x1",
    });
  } catch (e) { crossOrgSettle = code(e) === "FINANCE_TENANT_MISMATCH"; }
  ok("跨 org 付款被拒（payable 租户闸）", crossOrgSettle);

  let crossOrgRevenue = false;
  try {
    await revenueSvc.recordRevenueEntry({
      orgId: OB, projectId: projA.id, actor: accountant, entryType: "ADJUSTMENT",
      originalAmount: "1", originalCurrency: "CAD", recognizedAt: new Date(), createdById: ACC,
    });
  } catch (e) { crossOrgRevenue = code(e) === "FINANCE_TENANT_MISMATCH"; }
  ok("跨 org 记收入被拒", crossOrgRevenue);

  await cleanup();
  console.log(`\nT2-P1.6 DB 矩阵：${pass} passed, ${fail} failed`);
  await db.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
