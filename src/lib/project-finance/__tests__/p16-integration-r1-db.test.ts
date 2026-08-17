/**
 * T2-P1.6 INTEGRATION CONVERGENCE R1 — 集成契约矩阵（隔离库；非隔离自动跳过）
 *
 * 只覆盖 R1 新增/更正的跨域契约：
 *   INT-AWARD-REV-01  历史 / 竞争对手 AwardRecord → 零项目收入
 *   INT-AWARD-REV-02  明确关联当前项目的自身中标 → 恰一条 CONTRACT_AWARD
 *   INT-AWARD-REV-03  重复物化 → 仍恰一条
 *   INT-AWARD-REV-04  award correction → 不原地改收入（VOID + replacement，provenance 保留）
 *   PROFIT-SETTLEMENT-01  未付报销**不阻塞** Final Profit
 *   REV-CASH-01       现金回款状态不重定义已确认收入
 *
 * 运行：DATABASE_URL=<隔离分支> DIRECT_URL=<同> NODE_ENV=test \
 *       DATABASE_ENVIRONMENT=isolated npx tsx <本文件>
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

if (!process.env.DATABASE_URL?.trim()) {
  console.log("⏭  跳过 T2-P1.6 R1 集成测试（未提供 DATABASE_URL）");
  process.exit(0);
}
assertSafeTestDatabase({ scriptName: "project-finance p16 R1 integration test" });
if (process.env.NODE_ENV !== "test") {
  console.log("⏭  跳过 T2-P1.6 R1 集成测试（需 NODE_ENV=test）");
  process.exit(0);
}
process.env.T2_LEDGER_SCHEMA_READY = "true";
process.env.T2_LEDGER_PRODUCERS_ENABLED = "true";
process.env.TENDER_FINANCIAL_CONTROL_ENABLED = "true";
process.env.TENDER_PROFITABILITY_SCHEMA_READY = "true";
process.env.T4_AWARD_INTELLIGENCE_SCHEMA_READY = "true";

const P = "qy_r1int_";
let pass = 0;
let fail = 0;
function ok(label: string, cond: boolean, detail?: unknown) {
  if (cond) { pass += 1; console.log(`  ✓ ${label}`); }
  else { fail += 1; console.log(`  ✗ ${label}`, detail ?? ""); }
}

async function main() {
  const { db } = await import("@/lib/db");
  const revenueSvc = await import("../revenue-service");
  const expSvc = await import("../expense-service");
  const settleSvc = await import("../settlement-service");
  const profit = await import("../profitability");

  const actor = { actorType: "user" as const, actorId: `${P}u` };
  const U = `${P}u`;
  const ACC = `${P}acc`;
  const accountant = { actorType: "user" as const, actorId: ACC };

  async function cleanup() {
    await db.projectExpensePayment.deleteMany({ where: { orgId: { startsWith: P } } });
    await db.projectExpensePayable.deleteMany({ where: { orgId: { startsWith: P } } });
    await db.projectRevenueEntry.deleteMany({ where: { orgId: { startsWith: P } } });
    await db.projectExpenseSubmission.deleteMany({ where: { orgId: { startsWith: P } } });
    await db.awardRecordSource.deleteMany({ where: { orgId: { startsWith: P } } });
    await db.awardRecord.deleteMany({ where: { orgId: { startsWith: P } } });
    await db.projectEventActor.deleteMany({ where: { orgId: { startsWith: P } } });
    await db.projectEvent.deleteMany({ where: { orgId: { startsWith: P } } });
    await db.projectCost.deleteMany({ where: { orgId: { startsWith: P } } });
    await db.project.deleteMany({ where: { orgId: { startsWith: P } } });
    await db.organization.deleteMany({ where: { id: { startsWith: P } } });
    await db.user.deleteMany({ where: { id: { startsWith: P } } });
  }
  await cleanup();

  for (const s of ["u", "acc"]) {
    await db.user.create({ data: { id: `${P}${s}`, email: `${P}${s}@t.local`, name: s, role: "user" } });
  }
  const OA = `${P}org_a`;
  await db.organization.create({ data: { id: OA, name: "R1 Org", code: `${P}org-a`, ownerId: U } });

  // 我方中标项目
  const won = await db.project.create({
    data: {
      id: `${P}proj_won`, name: "R1 WON", orgId: OA, ownerId: U, workDomain: "tender",
      bidPhaseStatus: "AWARDED", submittedAt: new Date("2026-06-10"), awardDate: new Date("2026-07-01"),
    },
  });
  // 我方落标项目（AwardRecord 会挂在它上面，记录「是竞争对手中的标」）
  const lost = await db.project.create({
    data: {
      id: `${P}proj_lost`, name: "R1 LOST", orgId: OA, ownerId: U, workDomain: "tender",
      bidPhaseStatus: "LOST", tenderStatus: "lost",
      submittedAt: new Date("2026-06-12"), awardDate: new Date("2026-07-02"),
    },
  });

  async function newAward(over: Record<string, unknown>) {
    return db.awardRecord.create({
      data: {
        orgId: OA,
        winnerName: "SomeVendor",
        winnerNameNormalized: "somevendor",
        confidence: "HIGH",
        verificationStatus: "HUMAN_CONFIRMED",
        status: "ACTIVE",
        createdByType: "user",
        createdById: U,
        contractAmount: "1000000",
        currency: "CAD",
        awardDate: new Date("2026-07-01"),
        ...over,
      },
    });
  }

  /* ═════════ INT-AWARD-REV-01：历史 / 竞对 / 外部情报 → 零收入 ═════════ */
  console.log("━━ INT-AWARD-REV-01 ━━");

  // (a) 外部市场情报：projectId = null
  const external = await newAward({ projectId: null, winnerName: "Competitor A", winnerNameNormalized: "competitor a" });
  const r1a = await revenueSvc.materializeAwardRevenue({
    orgId: OA, projectId: won.id, awardRecordId: external.id, actor, createdById: U,
  });
  ok("INT-AWARD-REV-01a 外部市场情报（projectId=null）拒绝物化",
    r1a.materialized === false && r1a.refusedReason === "AWARD_NOT_LINKED_TO_PROJECT", r1a);

  // (b) 历史买家授标：projectId 指向别的项目
  const historical = await newAward({ projectId: lost.id, winnerName: "Competitor B", winnerNameNormalized: "competitor b" });
  const r1b = await revenueSvc.materializeAwardRevenue({
    orgId: OA, projectId: won.id, awardRecordId: historical.id, actor, createdById: U,
  });
  ok("INT-AWARD-REV-01b 关联到别的项目的授标记录拒绝物化",
    r1b.materialized === false && r1b.refusedReason === "AWARD_NOT_LINKED_TO_PROJECT", r1b);

  // (c) 竞争对手中标我方落标项目 —— 关联正确但我方并未中标
  const r1c = await revenueSvc.materializeAwardRevenue({
    orgId: OA, projectId: lost.id, awardRecordId: historical.id, actor, createdById: U,
  });
  ok("INT-AWARD-REV-01c 竞对中标（我方落标项目）拒绝物化 —— 关联正确也不足以产生我方收入",
    r1c.materialized === false && r1c.refusedReason === "PROJECT_NOT_AWARDED_TO_US", r1c);

  // (d) 未经验证的 AI 抽取
  const aiOnly = await newAward({ projectId: won.id, verificationStatus: "AI_EXTRACTED" });
  const r1d = await revenueSvc.materializeAwardRevenue({
    orgId: OA, projectId: won.id, awardRecordId: aiOnly.id, actor, createdById: U,
  });
  ok("INT-AWARD-REV-01d AI_EXTRACTED（未经人工/系统验证）拒绝物化",
    r1d.materialized === false && r1d.refusedReason === "AWARD_NOT_VERIFIED", r1d);

  // (e) 已撤回
  const retracted = await newAward({ projectId: won.id, status: "RETRACTED" });
  const r1e = await revenueSvc.materializeAwardRevenue({
    orgId: OA, projectId: won.id, awardRecordId: retracted.id, actor, createdById: U,
  });
  ok("INT-AWARD-REV-01e RETRACTED 授标记录拒绝物化",
    r1e.materialized === false && r1e.refusedReason === "AWARD_NOT_ACTIVE", r1e);

  const zeroRevenue = await db.projectRevenueEntry.count({ where: { orgId: OA } });
  ok("INT-AWARD-REV-01 上述五种情形合计产生 0 条收入", zeroRevenue === 0, { zeroRevenue });

  // 静态纪律：AwardRecord 从不参与利润读模型
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const profSrc = readFileSync(join(process.cwd(), "src/lib/project-finance/profitability.ts"), "utf8");
  const portSrc = readFileSync(join(process.cwd(), "src/lib/project-finance/portfolio.ts"), "utf8");
  ok("INT-AWARD-REV-01f 利润/组合读模型从不查询 AwardRecord（AwardRecord 不进 profit 求和）",
    !/awardRecord/i.test(profSrc) && !/awardRecord/i.test(portSrc));

  /* ═════════ INT-AWARD-REV-02：本项目自身中标 → 恰一条 ═════════ */
  console.log("━━ INT-AWARD-REV-02 ━━");
  const ourAward = await newAward({
    projectId: won.id, winnerName: "Sunny Home & Deco", winnerNameNormalized: "sunny home deco",
    contractAmount: "1000000", solicitationNumber: "RFVQ-R1-001",
  });
  const r2 = await revenueSvc.materializeAwardRevenue({
    orgId: OA, projectId: won.id, awardRecordId: ourAward.id, actor, createdById: U,
  });
  const entries2 = await db.projectRevenueEntry.findMany({ where: { orgId: OA, projectId: won.id } });
  ok("INT-AWARD-REV-02 明确关联 + 已验证 + 我方中标 → 恰一条 CONTRACT_AWARD",
    r2.materialized === true && entries2.length === 1 &&
    entries2[0]!.entryType === "CONTRACT_AWARD" &&
    entries2[0]!.amountForecastCad?.toString() === "1000000", { r2, n: entries2.length });
  ok("INT-AWARD-REV-02b 结构化 provenance 落库（sourceType/sourceRefId/activeSourceKey）",
    entries2[0]!.sourceType === "AWARD_RECORD" && entries2[0]!.sourceRefId === ourAward.id &&
    entries2[0]!.activeSourceKey === `CONTRACT_AWARD:AWARD_RECORD:${ourAward.id}`,
    { st: entries2[0]!.sourceType, key: entries2[0]!.activeSourceKey });

  /* ═════════ INT-AWARD-REV-03：重复物化仍恰一条 ═════════ */
  console.log("━━ INT-AWARD-REV-03 ━━");
  const r3a = await revenueSvc.materializeAwardRevenue({
    orgId: OA, projectId: won.id, awardRecordId: ourAward.id, actor, createdById: U,
  });
  const r3b = await Promise.allSettled(
    Array.from({ length: 4 }, () =>
      revenueSvc.materializeAwardRevenue({
        orgId: OA, projectId: won.id, awardRecordId: ourAward.id, actor, createdById: U,
      }),
    ),
  );
  const created3 = r3b.filter((r) => r.status === "fulfilled" && r.value.materialized).length;
  const entries3 = await db.projectRevenueEntry.count({
    where: { orgId: OA, projectId: won.id, entryType: "CONTRACT_AWARD", revenueStatus: { not: "VOIDED" } },
  });
  ok("INT-AWARD-REV-03 重复 + 并发物化仍恰一条（幂等命中，非新建）",
    r3a.idempotentHit === true && r3a.entryId === entries2[0]!.id && created3 === 0 && entries3 === 1,
    { idem: r3a.idempotentHit, created3, entries3 });

  // DB 唯一约束是最后防线：直接绕过 service 插入同键行必须被拒
  let dbGuard = false;
  try {
    await db.projectRevenueEntry.create({
      data: {
        orgId: OA, projectId: won.id, entryType: "CONTRACT_AWARD", revenueStatus: "FORECAST",
        originalAmount: "1", originalCurrency: "CAD", fxRateCadPerOriginalUnit: "1",
        fxRateDate: new Date(), fxRateSource: "BASE_CURRENCY", amountForecastCad: "1",
        recognizedAt: new Date(), createdById: U,
        sourceType: "AWARD_RECORD", sourceRefId: ourAward.id,
        activeSourceKey: `CONTRACT_AWARD:AWARD_RECORD:${ourAward.id}`,
      },
    });
  } catch (e) {
    dbGuard = typeof e === "object" && e !== null && "code" in e && String((e as { code: unknown }).code) === "P2002";
  }
  ok("INT-AWARD-REV-03b DB unique 约束是最后防线（绕过 service 直插同键 → P2002）", dbGuard);

  /* ═════════ INT-AWARD-REV-04：award correction 不原地改收入 ═════════ */
  console.log("━━ INT-AWARD-REV-04 ━━");
  const originalEntryId = entries2[0]!.id;
  // 授标金额被更正（1,000,000 → 1,080,000）：收入侧必须 VOID + replacement，不得原地改
  const { correction } = await revenueSvc.voidRevenueEntry({
    orgId: OA, projectId: won.id, entryId: originalEntryId, actor, voidedById: U,
    reason: "授标记录金额更正",
    correction: {
      entryType: "CONTRACT_AWARD", originalAmount: "1080000", originalCurrency: "CAD",
      recognizedAt: new Date("2026-07-05"), createdById: U,
      sourceType: "AWARD_RECORD", sourceRefId: ourAward.id,
    },
  });
  const oldEntry = await db.projectRevenueEntry.findUnique({ where: { id: originalEntryId } });
  ok("INT-AWARD-REV-04a 旧收入行未被原地改额（仍 1,000,000）且状态转 VOIDED",
    oldEntry?.amountForecastCad?.toString() === "1000000" && oldEntry.revenueStatus === "VOIDED" &&
    oldEntry.voidReason !== null);
  ok("INT-AWARD-REV-04b 旧行 provenance 永久保留，仅 activeSourceKey 置空释放键位",
    oldEntry?.sourceType === "AWARD_RECORD" && oldEntry.sourceRefId === ourAward.id &&
    oldEntry.activeSourceKey === null);
  ok("INT-AWARD-REV-04c replacement 新行携带同一 provenance + 修正链指回旧行",
    correction?.amountForecastCad?.toString() === "1080000" &&
    correction?.sourceRefId === ourAward.id &&
    correction?.correctionOfEntryId === originalEntryId &&
    correction?.activeSourceKey === `CONTRACT_AWARD:AWARD_RECORD:${ourAward.id}`);
  const activeAfter = await db.projectRevenueEntry.count({
    where: { orgId: OA, projectId: won.id, revenueStatus: { not: "VOIDED" } },
  });
  ok("INT-AWARD-REV-04d 修正后仍恰一条有效收入行", activeAfter === 1, { activeAfter });

  /* ═════════ PROFIT-SETTLEMENT-01：未付报销不阻塞 Final Profit ═════════ */
  console.log("━━ PROFIT-SETTLEMENT-01 ━━");

  // 成本：一笔员工垫付费用，批准 → ProjectCost.ACTUAL + payable（PENDING_PAYMENT，故意不付）
  const exp = await expSvc.createExpenseDraft({
    orgId: OA, projectId: won.id, actor, submittedById: U, costCategory: "SUPPLIER",
    expenseOccurredAt: new Date("2026-06-20"), description: "员工垫付", totalAmount: "1280.00",
    currency: "CAD", fundingSource: "EMPLOYEE_PERSONAL",
  });
  await expSvc.submitExpense({ orgId: OA, projectId: won.id, expenseId: exp.id, actor, actorUserId: U });
  const appr = await expSvc.approveExpense({
    orgId: OA, projectId: won.id, expenseId: exp.id, actor: accountant, reviewerUserId: ACC,
  });
  ok("PROFIT-SETTLEMENT-01 前置：审批产生 ACTUAL 成本 + 一条未付 payable",
    appr.cost !== null && appr.payable !== null);

  // 收入定案：把有效收入行确认为 RECOGNIZED
  const activeEntry = await db.projectRevenueEntry.findFirst({
    where: { orgId: OA, projectId: won.id, revenueStatus: "FORECAST" },
  });
  await revenueSvc.recognizeRevenueEntry({
    orgId: OA, projectId: won.id, entryId: activeEntry!.id, actor, recognizedById: U,
  });
  // 项目完工
  await db.project.update({ where: { id: won.id }, data: { actualCompletionDate: new Date("2026-08-30") } });

  const sum = await profit.getTenderFinancialSummary(OA, won.id);
  const outstanding = Number(sum.outstandingReimbursementCad);
  ok("PROFIT-SETTLEMENT-01 未付报销**不阻塞** Final Profit（finalProfitCad != null）",
    sum.finalProfitCad !== null && sum.finalProfitEligible === true,
    { final: sum.finalProfitCad, blockers: sum.finalProfitBlockers });
  ok("PROFIT-SETTLEMENT-01 outstandingReimbursementCad > 0 且 settlementStatus = OPEN",
    outstanding > 0 && sum.settlementStatus === "OPEN",
    { outstanding, status: sum.settlementStatus });
  ok("PROFIT-SETTLEMENT-01 blockers 中不得出现 OUTSTANDING_REIMBURSEMENT / OUTSTANDING_PAYABLE / OPEN_PAYABLES",
    !sum.finalProfitBlockers.some((b) =>
      b.startsWith("OUTSTANDING_REIMBURSEMENT") || b.startsWith("OUTSTANDING_PAYABLE") || b.startsWith("OPEN_PAYABLES")),
    sum.finalProfitBlockers);
  ok("PROFIT-SETTLEMENT-01 最终利润 = 已确认收入 − 总成本（1,080,000 − 1,280 = 1,078,720）",
    sum.finalProfitCad === "1078720", sum.finalProfitCad);

  // 付清后利润不变、结算转 SETTLED
  const payable = await db.projectExpensePayable.findFirst({ where: { orgId: OA, projectId: won.id } });
  await settleSvc.recordPayment({
    orgId: OA, projectId: won.id, payableId: payable!.id, actor,
    amountCad: payable!.amountCad, paidAt: new Date("2026-09-01"), paymentMethod: "ETRANSFER",
    paidById: U, clientKey: "r1pay",
  });
  const sum2 = await profit.getTenderFinancialSummary(OA, won.id);
  ok("PROFIT-SETTLEMENT-01b 付清后利润**不变**，仅 settlementStatus 转 SETTLED",
    sum2.finalProfitCad === sum.finalProfitCad && sum2.settlementStatus === "SETTLED" &&
    Number(sum2.outstandingReimbursementCad) === 0,
    { final: sum2.finalProfitCad, status: sum2.settlementStatus });

  /* ═════════ REV-CASH-01：现金回款不重定义已确认收入 ═════════ */
  console.log("━━ REV-CASH-01 ━━");
  const recognized = await db.projectRevenueEntry.findFirst({
    where: { orgId: OA, projectId: won.id, revenueStatus: "RECOGNIZED" },
  });
  ok("REV-CASH-01 已确认收入存在，且模型中不存在任何客户回款/AR 概念",
    recognized !== null && recognized!.amountRecognizedCad?.toString() === "1080000");

  // 静态纪律：P1.6 收入域不得出现客户回款/AR 语义
  const revSrc = readFileSync(join(process.cwd(), "src/lib/project-finance/revenue-service.ts"), "utf8");
  const noArModel =
    !/customerPayment|accountsReceivable|cashCollect|collectionStatus/i.test(revSrc);
  ok("REV-CASH-01b 收入服务不含 customerPayment / accountsReceivable / cashCollection 模型",
    noArModel);
  ok("REV-CASH-01c 利润仍可基于已确认收入计算（与是否收到现金无关）",
    sum2.finalProfitCad === "1078720" && sum2.recognizedRevenueCad === "1080000",
    { profit: sum2.finalProfitCad, revenue: sum2.recognizedRevenueCad });

  await cleanup();
  console.log(`\nT2-P1.6 R1 集成矩阵：${pass} passed, ${fail} failed`);
  await db.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
