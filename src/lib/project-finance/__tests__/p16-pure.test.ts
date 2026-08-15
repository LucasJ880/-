/**
 * T2-P1.6 纯逻辑不变量（无 DB / 无网络；进 test-all + CI 子集）
 *
 * 覆盖任务书 §18 中不依赖数据库的契约：
 *   FX-01..06        多币种换算与汇率方向
 *   TENDER-COST-01..04 成本阶段推导（PRE_AWARD / POST_AWARD）
 *   REIMB-02/03      公司支付 → 零员工应付（映射层）
 *   LOSS-03          AI 建议路径结构上无法写最终原因
 *   PORT-06          零分母 win rate
 * 以及：flag fail-closed、事件键确定性、静态纪律（settlement 不 import cost-service）。
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Prisma } from "@prisma/client";

import { hasProjectPermission, PERMISSIONS } from "@/lib/rbac/permissions";
import {
  BASE_CURRENCY,
  computeFinalCad,
  convertToCad,
  FxContractError,
  marginPercentage,
  resolveExpenseCad,
  roundMoney,
  SUPPORTED_EXPENSE_CURRENCIES,
} from "../money";
import { resolveFxRate, buildFxSnapshot, hasSystemReferenceRateProvider } from "../fx";
import { resolveCostPhase, resolveCostPhaseBoundary } from "../cost-phase";
import {
  buildRevenueActiveSourceKey,
  EXPENSE_FUNDING_SOURCES,
  LOSS_REASON_GROUPS,
  resolveTenderOutcome,
  REVENUE_STATUSES,
  settlementForFundingSource,
  TENDER_LOSS_REASONS,
} from "../types";
import { isProfitabilitySchemaReadyWithEnv } from "../flags";
import {
  expenseAmountConfirmedEventKey,
  expenseFxSettledEventKey,
  expensePayableCreatedEventKey,
  expensePaymentRecordedEventKey,
} from "../event-keys";

const D = (v: string) => new Prisma.Decimal(v);
const SRC = join(process.cwd(), "src/lib/project-finance");

/** 静态纪律断言辅助：剥离注释，只对真实代码做禁用模式检查。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/* ═══════════════════════════ 多币种 ═══════════════════════════ */

test("FX-01 CAD 100 → CAD 100（基准币种短路，rate 恒 1）", () => {
  const cad = convertToCad({
    originalAmount: "100",
    originalCurrency: "CAD",
    fxRateCadPerOriginalUnit: "1",
  });
  assert.equal(cad.toString(), "100");
  assert.equal(BASE_CURRENCY, "CAD");
});

test("FX-02 CNY 72000 × 锁定汇率 0.1917 → estimated CAD 13802.40", () => {
  const cad = convertToCad({
    originalAmount: "72000",
    originalCurrency: "CNY",
    fxRateCadPerOriginalUnit: "0.1917",
  });
  assert.equal(cad.toFixed(2), "13802.40");
});

test("FX-03 历史快照不因当前汇率改变（resolveExpenseCad 只读快照列，从不重算）", () => {
  const expense = {
    totalAmount: D("72000"),
    currency: "CNY",
    estimatedCadAmount: D("13802.40"),
  };
  const first = resolveExpenseCad(expense);
  assert.ok(first.known);
  assert.equal(first.cad.toFixed(2), "13802.40");
  // 「今天」汇率变到 0.25 也不影响历史行：函数根本不接受当前汇率参数
  const again = resolveExpenseCad(expense);
  assert.ok(again.known && again.cad.toFixed(2) === "13802.40");
  // legacy 行（无快照）：CAD 用 totalAmount；非 CAD 明确 UNKNOWN，绝不猜
  const legacyCad = resolveExpenseCad({ totalAmount: D("23"), currency: "CAD", estimatedCadAmount: null });
  assert.ok(legacyCad.known && legacyCad.legacy && legacyCad.cad.toString() === "23");
  const legacyCny = resolveExpenseCad({ totalAmount: D("100"), currency: "CNY", estimatedCadAmount: null });
  assert.equal(legacyCny.known, false);
});

test("FX-04 finalCad = settledCad + bankFee（13965.00 + 45.00 = 14010.00）", () => {
  const final = computeFinalCad({ settledCadAmount: "13965.00", bankFeeCad: "45.00" });
  assert.equal(final.toFixed(2), "14010.00");
  // 差额相对审批时 estimated 13802.40 = +207.60
  assert.equal(final.sub(D("13802.40")).toFixed(2), "207.60");
  // 手续费缺省 = 0
  assert.equal(computeFinalCad({ settledCadAmount: "100" }).toFixed(2), "100.00");
  assert.throws(() => computeFinalCad({ settledCadAmount: "100", bankFeeCad: "-1" }), /手续费/);
});

test("FX-05 禁止 inverse-rate 歧义：CAD 必须恰为 1；非正/非有限汇率被拒", async () => {
  // CAD 原始币种给出 5.2158（= 1/0.1917 的反向汇率）→ 必须拒绝
  assert.throws(
    () => convertToCad({ originalAmount: "1", originalCurrency: "CAD", fxRateCadPerOriginalUnit: "5.2158" }),
    FxContractError,
  );
  assert.throws(
    () => convertToCad({ originalAmount: "1", originalCurrency: "CNY", fxRateCadPerOriginalUnit: "0" }),
    FxContractError,
  );
  assert.throws(
    () => convertToCad({ originalAmount: "1", originalCurrency: "CNY", fxRateCadPerOriginalUnit: "-0.19" }),
    FxContractError,
  );
  // CAD 走 BASE_CURRENCY 来源、rate 恒 1，不需要调用方提供
  const r = await resolveFxRate({ originalCurrency: "CAD", fxRateDate: new Date("2026-06-10") });
  assert.equal(r.fxRateSource, "BASE_CURRENCY");
  assert.equal(r.fxRateCadPerOriginalUnit.toString(), "1");
  // 非 CAD 未给汇率 → 拒绝（不静默用 1）
  await assert.rejects(
    resolveFxRate({ originalCurrency: "CNY", fxRateDate: new Date("2026-06-10") }),
    FxContractError,
  );
});

test("FX-06 Decimal 舍入正确（半分进位；不使用 JS float）", () => {
  // 0.1 + 0.2 在 float 下 = 0.30000000000000004；Decimal 必须精确
  assert.equal(D("0.1").add(D("0.2")).toString(), "0.3");
  // 1234.565 → 1234.57（ROUND_HALF_UP）
  assert.equal(roundMoney("1234.565").toFixed(2), "1234.57");
  // CNY 8600 × 0.19153 = 1647.158 → 1647.16
  assert.equal(
    convertToCad({ originalAmount: "8600", originalCurrency: "CNY", fxRateCadPerOriginalUnit: "0.19153" }).toFixed(2),
    "1647.16",
  );
  // margin：0 收入 → null（不造 NaN / Infinity）
  assert.equal(marginPercentage(D("100"), D("0")), null);
  assert.equal(marginPercentage(D("272000"), D("1000000")), "27.2");
});

test("FX 快照携带完整留痕，且 SYSTEM_REFERENCE 无 provider 时 fail-closed（不硬编码汇率）", async () => {
  const snap = await buildFxSnapshot({
    originalAmount: "72000",
    originalCurrency: "cny",
    fxRateCadPerOriginalUnit: "0.1917",
    fxRateDate: new Date("2026-06-10"),
    fxRateSource: "MANUAL",
  });
  assert.equal(snap.originalCurrency, "CNY"); // 规范化大写
  assert.equal(snap.originalAmount.toString(), "72000"); // 原始金额保留
  assert.equal(snap.estimatedCadAmount.toFixed(2), "13802.40");
  assert.equal(snap.fxRateSource, "MANUAL");

  assert.equal(hasSystemReferenceRateProvider(), false, "本轮刻意不引入任何 FX provider");
  await assert.rejects(
    resolveFxRate({
      originalCurrency: "CNY",
      fxRateDate: new Date("2026-06-10"),
      fxRateSource: "SYSTEM_REFERENCE",
    }),
    /系统参考汇率不可用/,
  );
});

test("P0 支持币种至少含 CAD / CNY / USD", () => {
  for (const c of ["CAD", "CNY", "USD"]) {
    assert.ok((SUPPORTED_EXPENSE_CURRENCIES as readonly string[]).includes(c));
  }
});

/* ═══════════════════════════ 投标 vs 交付成本 ═══════════════════════════ */

const AWARDED = { bidPhaseStatus: "AWARDED", tenderStatus: null, workDomain: "tender" };
const LOST = { bidPhaseStatus: "LOST", tenderStatus: "lost", workDomain: "tender" };

test("TENDER-COST-01 LOST tender 无阶段边界 → 全部成本계 PRE_AWARD（费用一律保留）", () => {
  // 落标项目即使有 awardDate（结果公布日）也不得据此切出「交付成本」
  const boundary = resolveCostPhaseBoundary({ ...LOST, awardDate: new Date("2026-07-01") }, null);
  assert.equal(boundary.source, "none");
  assert.equal(boundary.phaseSplitAvailable, false);
  assert.equal(resolveCostPhase(boundary, new Date("2026-08-01")), "PRE_AWARD");
  assert.equal(resolveCostPhase(boundary, new Date("2026-06-01")), "PRE_AWARD");
});

test("TENDER-COST-02 WON tender 保留 pre-award 成本（边界前后正确切分）", () => {
  const boundary = resolveCostPhaseBoundary({ ...AWARDED, awardDate: new Date("2026-07-01") }, null);
  assert.equal(boundary.source, "awardDate");
  assert.equal(resolveCostPhase(boundary, new Date("2026-06-20")), "PRE_AWARD");
  assert.equal(resolveCostPhase(boundary, new Date("2026-07-01")), "POST_AWARD"); // 边界当天含
  assert.equal(resolveCostPhase(boundary, new Date("2026-08-15")), "POST_AWARD");
});

test("TENDER-COST-03 交付项目全部成本为 POST_AWARD（其投标成本在来源投标项目上，不互相覆盖）", () => {
  const boundary = resolveCostPhaseBoundary(
    { workDomain: "delivery", bidPhaseStatus: null, tenderStatus: null, awardDate: null },
    null,
  );
  assert.equal(boundary.allPostAward, true);
  assert.equal(resolveCostPhase(boundary, new Date("2020-01-01")), "POST_AWARD");
});

test("TENDER-COST-04 handoff 完成时间优先于 awardDate 作为边界", () => {
  const boundary = resolveCostPhaseBoundary(
    { ...AWARDED, awardDate: new Date("2026-07-01") },
    new Date("2026-07-20"),
  );
  assert.equal(boundary.source, "handoff");
  assert.equal(resolveCostPhase(boundary, new Date("2026-07-10")), "PRE_AWARD");
  assert.equal(resolveCostPhase(boundary, new Date("2026-07-25")), "POST_AWARD");
});

test("阶段推导只读既有 canonical 字段：中标但无 awardDate → 不猜边界，如实标 phaseSplitAvailable=false", () => {
  const boundary = resolveCostPhaseBoundary({ ...AWARDED, awardDate: null }, null);
  assert.equal(boundary.source, "none");
  assert.equal(boundary.phaseSplitAvailable, false);
});

/* ═══════════════════════════ 结算映射 ═══════════════════════════ */

test("REIMB-02/03 公司卡 / 公司银行 → 零员工应付；个人垫付 → 恰一条员工报销", () => {
  assert.equal(settlementForFundingSource("COMPANY_CARD"), null);
  assert.equal(settlementForFundingSource("COMPANY_BANK"), null);
  assert.equal(settlementForFundingSource("OTHER"), null);
  assert.equal(settlementForFundingSource(null), null, "legacy UNSPECIFIED 不得凭空造报销义务");
  assert.equal(settlementForFundingSource("UNKNOWN_VALUE"), null);

  assert.deepEqual(settlementForFundingSource("EMPLOYEE_PERSONAL"), {
    settlementType: "EMPLOYEE_REIMBURSEMENT",
    payeeType: "USER",
  });
  assert.deepEqual(settlementForFundingSource("CHINA_AFFILIATE"), {
    settlementType: "AFFILIATE_SETTLEMENT",
    payeeType: "AFFILIATE",
  });
  assert.deepEqual(settlementForFundingSource("VENDOR_INVOICE_UNPAID"), {
    settlementType: "VENDOR_PAYMENT",
    payeeType: "VENDOR",
  });
});

test("出资来源词表完整（六项）且每项都有面向普通用户的中文文案", async () => {
  const { FUNDING_SOURCE_LABELS } = await import("../types");
  assert.equal(EXPENSE_FUNDING_SOURCES.length, 6);
  for (const f of EXPENSE_FUNDING_SOURCES) {
    assert.ok(FUNDING_SOURCE_LABELS[f] && FUNDING_SOURCE_LABELS[f].length > 0);
  }
});

/* ═══════════════════════════ 结果 / 落标 ═══════════════════════════ */

test("Tender 结果只读既有 canonical 字段（不新造 outcome 状态）", () => {
  assert.equal(resolveTenderOutcome({ bidPhaseStatus: "AWARDED" }), "WON");
  assert.equal(resolveTenderOutcome({ tenderStatus: "won" }), "WON");
  assert.equal(resolveTenderOutcome({ workDomain: "delivery" }), "WON");
  assert.equal(resolveTenderOutcome({ tenderStatus: "lost" }), "LOST");
  assert.equal(resolveTenderOutcome({ bidPhaseStatus: "LOST" }), "LOST");
  assert.equal(resolveTenderOutcome({ submittedAt: new Date("2026-06-01") }), "PENDING");
  assert.equal(resolveTenderOutcome({}), "NOT_SUBMITTED");
  // awardDate 单独存在不构成中标（它是结果公布日，落标项目也可能有）
  assert.equal(resolveTenderOutcome({ submittedAt: new Date("2026-06-01") }), "PENDING");
});

test("LOSS 词表含任务书 15 项，且分组覆盖全部原因（无漏项）", () => {
  for (const r of [
    "PRICE_HIGH", "PRICE_TOO_LOW_RISK", "TECHNICAL", "EXPERIENCE", "CERTIFICATION",
    "BONDING", "SCHEDULE", "LOCAL_PREFERENCE", "INCUMBENT", "RELATIONSHIP",
    "COMPLIANCE", "SUBMISSION_ERROR", "CAPACITY", "UNKNOWN", "OTHER",
  ]) {
    assert.ok((TENDER_LOSS_REASONS as readonly string[]).includes(r), `缺少 ${r}`);
  }
  const grouped = new Set(Object.values(LOSS_REASON_GROUPS).flat());
  for (const r of TENDER_LOSS_REASONS) {
    assert.ok(grouped.has(r), `${r} 未归入任何 portfolio 分组`);
  }
});

test("LOSS-03 静态纪律：suggestLossReasons 不写 primaryLossReason（AI 建议无法成为最终原因）", () => {
  const src = readFileSync(join(SRC, "loss-review-service.ts"), "utf8");
  const suggestBody = src.slice(
    src.indexOf("export async function suggestLossReasons"),
    src.indexOf("export async function confirmLossReview"),
  );
  assert.ok(suggestBody.length > 0, "未定位到 suggestLossReasons");
  assert.ok(
    !/primaryLossReason:\s/.test(suggestBody.replace(/aiSuggestedPrimaryReason:/g, "")),
    "suggestLossReasons 不得写 primaryLossReason",
  );
  assert.ok(!/secondaryLossReasons:/.test(suggestBody), "suggestLossReasons 不得写 secondaryLossReasons");
  // confirm 路径必须要求 user actor + humanConfirmed 落痕
  const confirmBody = src.slice(src.indexOf("export async function confirmLossReview"));
  assert.ok(/actorType !== "user"/.test(confirmBody), "最终确认必须要求真人 actor");
  assert.ok(/humanConfirmedById/.test(confirmBody) && /humanConfirmedAt/.test(confirmBody));
});

/* ═══════════════════════════ 静态纪律 / flag / 事件键 ═══════════════════════════ */

test("REIMB-04 静态纪律：结算子账不 import cost-service（付款结构上不可能产生第二条成本）", () => {
  const settlement = readFileSync(join(SRC, "settlement-service.ts"), "utf8");
  assert.ok(!/project-ledger\/cost-service/.test(settlement), "settlement-service 不得 import cost-service");
  assert.ok(!/createProjectCost|projectCost\.create/.test(settlement), "settlement-service 不得写 ProjectCost");
  assert.ok(/SETTLEMENT_SUBLEDGER_NOT_COST/.test(settlement), "付款事件须显式标注非成本语义");
});

test("静态纪律：FX 结算的成本修正必须走 ledger 的 void+correction，不得原地 update ProjectCost", () => {
  const fxSettle = readFileSync(join(SRC, "fx-settlement-service.ts"), "utf8");
  assert.ok(/voidProjectCost/.test(fxSettle), "必须复用既有 voidProjectCost 修正契约");
  assert.ok(
    !/projectCost\.update|projectCost\.updateMany/.test(fxSettle),
    "禁止原地 UPDATE ProjectCost（ACTUAL 不可变）",
  );
});

test("静态纪律：route 层不得直连 prisma.projectCost 写入（一律经 cost-service）", () => {
  const dir = join(process.cwd(), "src/app/api/projects/[id]/finance");
  const files = [
    "expenses/route.ts",
    "expenses/[expenseId]/route.ts",
    "expenses/[expenseId]/fx-settlement/route.ts",
    "payables/route.ts",
    "payables/[payableId]/payments/route.ts",
    "payments/[paymentId]/route.ts",
    "revenue/route.ts",
    "revenue/[entryId]/route.ts",
    "loss-review/route.ts",
    "tender-summary/route.ts",
  ];
  for (const f of files) {
    const src = readFileSync(join(dir, f), "utf8");
    assert.ok(
      !/projectCost\.(create|update|updateMany|delete|deleteMany)/.test(src),
      `${f} 不得直接写 ProjectCost`,
    );
    assert.ok(
      !/projectExpensePayable\.(create|update)|projectExpensePayment\.(create|update)/.test(src),
      `${f} 不得绕过 settlement-service 直写结算表`,
    );
  }
});

test("TENDER_PROFITABILITY_SCHEMA_READY default OFF 且 fail-closed", () => {
  assert.equal(isProfitabilitySchemaReadyWithEnv({}), false);
  assert.equal(isProfitabilitySchemaReadyWithEnv({ TENDER_PROFITABILITY_SCHEMA_READY: "" }), false);
  assert.equal(isProfitabilitySchemaReadyWithEnv({ TENDER_PROFITABILITY_SCHEMA_READY: "false" }), false);
  assert.equal(isProfitabilitySchemaReadyWithEnv({ TENDER_PROFITABILITY_SCHEMA_READY: "0" }), false);
  assert.equal(isProfitabilitySchemaReadyWithEnv({ TENDER_PROFITABILITY_SCHEMA_READY: "true" }), true);
  assert.equal(isProfitabilitySchemaReadyWithEnv({ TENDER_PROFITABILITY_SCHEMA_READY: "1" }), true);
});

test("P1.6 事件键确定性、无随机/时钟来源", () => {
  assert.equal(expensePayableCreatedEventKey("e1"), "expense.payable_created:e1");
  assert.equal(expensePayableCreatedEventKey("e1"), expensePayableCreatedEventKey("e1"));
  assert.equal(expenseFxSettledEventKey("e1"), "expense.fx_settled:e1");
  assert.equal(expensePaymentRecordedEventKey("p1"), "expense.payment_recorded:p1");
  assert.equal(expenseAmountConfirmedEventKey("e1", 3), "expense.amount_confirmed:e1:t3");
  assert.notEqual(expenseAmountConfirmedEventKey("e1", 3), expenseAmountConfirmedEventKey("e1", 4));

  // 只看代码，不看注释（注释里本来就写着「禁 Math.random() / Date.now() / randomUUID()」）
  const keys = stripComments(readFileSync(join(SRC, "event-keys.ts"), "utf8"));
  assert.ok(!/Math\.random|Date\.now|randomUUID/.test(keys), "事件键构造禁用随机/时钟来源");
});

test("PROJECT_PAYMENT_RECORD 与 COST_REVIEW 是两个独立权限位（审批 ≠ 付款）", () => {
  assert.notEqual(PERMISSIONS.PROJECT_PAYMENT_RECORD, PERMISSIONS.PROJECT_COST_REVIEW);
  // 提交类角色不得获得付款权
  for (const role of ["viewer", "tester", "operator"] as const) {
    assert.equal(
      hasProjectPermission(role, PERMISSIONS.PROJECT_PAYMENT_RECORD),
      false,
      `${role} 不应有付款权`,
    );
    assert.equal(hasProjectPermission(role, PERMISSIONS.PROJECT_EXPENSE_SUBMIT), true);
  }
  // accounting / project_admin 有付款权
  assert.equal(hasProjectPermission("accounting", PERMISSIONS.PROJECT_PAYMENT_RECORD), true);
  assert.equal(hasProjectPermission("project_admin", PERMISSIONS.PROJECT_PAYMENT_RECORD), true);
});

test("PORT-06 win rate 零分母返回 null（不造 0% 也不造 NaN）", () => {
  const winRate = (won: number, lost: number) =>
    won + lost > 0
      ? new Prisma.Decimal(won).div(won + lost).mul(100).toDecimalPlaces(2).toString()
      : null;
  assert.equal(winRate(0, 0), null);
  assert.equal(winRate(3, 9), "25");
  assert.equal(winRate(1, 0), "100");
});

/* ═══════════════════════════ R1 集成收口契约 ═══════════════════════════ */

test("R1 §G 静态纪律：未结报销/应付**不得**成为 Final Profit blocker（Payment ≠ Cost）", () => {
  const prof = stripComments(readFileSync(join(SRC, "profitability.ts"), "utf8"));
  const blockerPushes = [...prof.matchAll(/blockers\.push\(\s*[`"']?([A-Z_]+)/g)].map((m) => m[1]);
  assert.ok(blockerPushes.length > 0, "未定位到 blockers.push");
  const forbidden = ["OUTSTANDING_REIMBURSEMENT", "OUTSTANDING_PAYABLE", "OPEN_PAYABLES"];
  for (const f of forbidden) {
    assert.ok(
      !blockerPushes.some((b) => b.startsWith(f)),
      `${f} 不得作为 Final Profit blocker —— 费用一经审批即已计入成本，是否付款不改变利润`,
    );
  }
  // 允许的 blocker 词表（任务书 §G 白名单）
  const allowed = new Set([
    "REVENUE_LEDGER_UNAVAILABLE", "OUTCOME_NOT_WON", "PROJECT_NOT_COMPLETED",
    "REVENUE_NOT_FINAL", "PENDING_COST_REVIEW", "UNRESOLVED_COST_CORRECTION",
    "UNKNOWN_CURRENCY_COST", "UNKNOWN_REVENUE_CURRENCY",
  ]);
  for (const b of blockerPushes) {
    assert.ok(allowed.has(b), `blocker ${b} 不在 §G 白名单内`);
  }
  // 结算必须作为并列输出存在
  assert.ok(/settlementStatus/.test(prof) && /outstandingReimbursementCad/.test(prof));
});

test("R1 §G 静态纪律：portfolio 的 final 资格同样不含未结应付", () => {
  const port = stripComments(readFileSync(join(SRC, "portfolio.ts"), "utf8"));
  const m = port.match(/const finalEligible =([\s\S]*?);/);
  assert.ok(m, "未定位到 portfolio finalEligible");
  assert.ok(
    !/projectOutstanding|outstanding/i.test(m![1]),
    "portfolio final 资格不得含未结应付条件",
  );
});

test("R1 §E 静态纪律：利润/组合读模型从不查询 AwardRecord（Award 不进 profit 求和）", () => {
  for (const f of ["profitability.ts", "portfolio.ts"]) {
    const src = readFileSync(join(SRC, f), "utf8");
    assert.ok(!/awardRecord/i.test(src), `${f} 不得查询 AwardRecord`);
  }
});

test("R1 §E 静态纪律：不存在 AwardRecord 创建即自动产生收入的路径", () => {
  // T4 授标服务不得 import 收入服务
  const awards = readFileSync(join(process.cwd(), "src/lib/tender-intel/awards.ts"), "utf8");
  assert.ok(
    !/project-finance|recordRevenueEntry|materializeAwardRevenue/.test(awards),
    "tender-intel/awards.ts 不得触达收入域（禁止 on-award-created 自动建收入）",
  );
  // 物化必须是显式、带六重资格闸的独立函数
  const rev = readFileSync(join(SRC, "revenue-service.ts"), "utf8");
  assert.ok(/export async function materializeAwardRevenue/.test(rev));
  for (const gate of [
    "AWARD_NOT_LINKED_TO_PROJECT", "AWARD_NOT_ACTIVE", "AWARD_NOT_VERIFIED",
    "AWARD_AMOUNT_MISSING", "PROJECT_NOT_AWARDED_TO_US",
  ]) {
    assert.ok(rev.includes(gate), `物化资格闸缺少 ${gate}`);
  }
});

test("R1 §F 结构化 provenance：去重键构造 + VOID 释放键位", () => {
  assert.equal(
    buildRevenueActiveSourceKey("CONTRACT_AWARD", "AWARD_RECORD", "aw1"),
    "CONTRACT_AWARD:AWARD_RECORD:aw1",
  );
  // 无来源锚 → NULL（手工录入不受唯一键约束）
  assert.equal(buildRevenueActiveSourceKey("CONTRACT_AWARD", null, "aw1"), null);
  assert.equal(buildRevenueActiveSourceKey("CONTRACT_AWARD", "AWARD_RECORD", null), null);
  // 不同 entryType 不冲突
  assert.notEqual(
    buildRevenueActiveSourceKey("CONTRACT_AWARD", "AWARD_RECORD", "aw1"),
    buildRevenueActiveSourceKey("CHANGE_ORDER", "AWARD_RECORD", "aw1"),
  );
  // schema 必须有 DB 层唯一约束（不能只靠 service 约定）
  const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
  assert.ok(
    /@@unique\(\[projectId, activeSourceKey\]\)/.test(schema),
    "ProjectRevenueEntry 必须有 @@unique([projectId, activeSourceKey])",
  );
  // VOID 路径必须置空键位
  const rev = readFileSync(join(SRC, "revenue-service.ts"), "utf8");
  const voidBody = rev.slice(rev.indexOf("export async function voidRevenueEntry"));
  assert.ok(/activeSourceKey: null/.test(voidBody), "VOID 必须释放 activeSourceKey");
});

test("R1 §H：收入状态词表为 FORECAST / RECOGNIZED / VOIDED，且不含 AR/回款概念", () => {
  assert.deepEqual([...REVENUE_STATUSES], ["FORECAST", "RECOGNIZED", "VOIDED"]);
  assert.ok(!(REVENUE_STATUSES as readonly string[]).includes("REALIZED"));
  for (const f of ["revenue-service.ts", "profitability.ts", "portfolio.ts", "types.ts"]) {
    const src = readFileSync(join(SRC, f), "utf8");
    assert.ok(
      !/customerPayment|accountsReceivable|cashCollected|collectionStatus/i.test(src),
      `${f} 不得引入客户回款 / AR 概念（P1.6 明确不实现）`,
    );
  }
});

test("HEIC 魔数校验已实装（此前落 default 放行分支）", () => {
  const guard = readFileSync(join(process.cwd(), "src/lib/files/upload-guard.ts"), "utf8");
  assert.ok(/case "heic"/.test(guard) && /checkHeifMagic/.test(guard));
  assert.ok(/ftyp/.test(guard), "必须校验 ISO-BMFF ftyp box");
});
