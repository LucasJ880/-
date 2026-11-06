/**
 * P1-6G 比价解读数字校验 — 纯逻辑测试
 * 运行：npx tsx src/lib/tender-rfq/__tests__/interpretation-guard.test.ts
 */
import assert from "node:assert/strict";
import { buildCompareMatrix, buildInterpretationPayload, buildMatrixInterpretationPrompt, type CompareInput } from "../compare";
import { normalizeQuote, type LandedCostSettings } from "../landed-cost";
import { checkInterpretationNumbers, collectAllowedNumbers, extractNumberTokens, UNVERIFIED_MARK } from "../interpretation-guard";

let passed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  assert.equal(cond, true, `${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("tender-rfq interpretation-guard");

/* ---------------------------- 取数 ---------------------------- */
{
  const t = extractNumberTokens("落地价 12,345.67 CAD，约 1.2万，交期 30 天，贵 8.5%，有效期 2026-12-31，截标 11月14日，另 12k");
  const kinds = t.map((x) => `${x.kind}:${x.value}`);
  ok("千分位与小数", kinds.includes("number:12345.67"), kinds);
  ok("「万」换算", kinds.includes("number:12000"), kinds);
  ok("百分比单独成类", kinds.includes("percent:8.5"), kinds);
  ok("ISO 日期整体取出（不拆成 2026 / 12 / 31）", kinds.includes("date:20261231") && !kinds.includes("number:2026"), kinds);
  ok("「M月D日」", kinds.includes("monthDay:1114"), kinds);
  ok("k 单位", kinds.includes("number:12000") && t.some((x) => x.raw === "12k"), t.map((x) => x.raw));
  ok("中文年月日", extractNumberTokens("2026年12月31日前有效").some((x) => x.kind === "date" && x.value === 20261231));
  ok("字母后的数字不取（供应商名 / 型号）", extractNumberTokens("ABC2000 型号 X12").length === 0);
  ok("「12 kg」的 k 不当单位", extractNumberTokens("12 kg").map((x) => x.value).join() === "12");
}

/* ---------------------------- 精度规则 ---------------------------- */
{
  const allowed = collectAllowedNumbers({ total: 12345.67, pct: "贵 8.5%", date: "2026-12-31" });
  const c = (s: string) => checkInterpretationNumbers({ a: s }, allowed);
  ok("按写法精度：12,346 对得上 12,345.67", c("约 12,346").ok);
  ok("按写法精度：12,345.7 对得上", c("12,345.7").ok);
  ok("按写法精度：1.2万 对得上（允许 ±500）", c("约 1.2万").ok);
  ok("凑整成 12,000 → 对不上（与矩阵不一致）", !c("约 12,000").ok);
  ok("百分比只与百分比比较", c("贵 8.5%").ok && !c("贵 8.6%").ok);
  ok("0.085 不当作 8.5%", !checkInterpretationNumbers({ a: "8.5%" }, collectAllowedNumbers({ r: 0.085 })).ok);
  ok("日期必须完全一致", c("有效期至 2026-12-31").ok && !c("有效期至 2026-12-30").ok);
  ok("月日与输入里的日期对得上", c("12月31日前有效").ok && !c("12月30日前有效").ok);
  ok("没有数字 → 通过", c("交期与有效期都满足要求。").ok);
}

/* ---------------------------- 真实矩阵 ---------------------------- */
{
  const NOW = new Date("2026-10-25T12:00:00Z");
  const EMAIL = new Date("2026-10-25T09:00:00Z");
  const SETTINGS: LandedCostSettings = {
    fxRates: { CNY: 0.19 }, fxAsOf: "2026-10-20", fxSource: "MANUAL",
    freightEstimate: { mode: "per_unit", value: 6 }, exportInlandEstimate: null, insurancePct: 1, clearanceFlatCad: 150, projects: {},
  };
  const TENDER = { closeDate: "2026-11-14", deliveryDeadline: "2026-11-14", firstTierQty: 1500, mandatoryCodes: ["R-01"], now: NOW };
  const q = (id: string, name: string, total: number, days: number): CompareInput => {
    const quoted = { unitPrice: null, totalPrice: total, currency: "CAD", incoterm: "DDP", moq: 500, deliveryDays: days, validUntil: "2026-12-31" };
    return {
      itemId: id, supplierId: `s-${id}`, supplierName: name, quoted, emailDate: EMAIL,
      mandatoryAnswers: [{ requirementCode: "R-01", answer: "满足" }],
      normalized: normalizeQuote(quoted, { settings: SETTINGS, dutyRatePct: 6.5, quantity: 1500, now: NOW }),
    };
  };
  const matrix = buildCompareMatrix([q("A", "甲公司", 61000, 15), q("B", "乙公司", 58000, 45), q("C", "丙公司", 64000, 10)], TENDER);
  const ctx = { projectName: "Pillow Forms 2027", roundNumber: 1, closeDate: "2026-11-14" };
  const payload = buildInterpretationPayload(matrix, ctx);
  ok("提示词的输入就是校验用的 payload（同一份数据）", buildMatrixInterpretationPrompt(matrix, ctx).userPrompt === JSON.stringify(payload, null, 1));
  const allowed = collectAllowedNumbers(payload);
  const rec = matrix.rows.find((r) => r.itemId === matrix.recommendedItemId)!;
  const recTotal = Math.round(rec.landedCad.total!).toLocaleString("en-US");

  const good = checkInterpretationNumbers(
    {
      priceAnalysis: `推荐 ${rec.supplierName}，落地价 ${recTotal} CAD。`,
      deliveryAnalysis: `${rec.supplierName} 交期 ${rec.quoted.deliveryDays} 天，有效期至 2026-12-31。`,
      risks: "最低价供应商交期超出交付截止。",
      recommendation: `截标日 11月14日 前确认。`,
    },
    allowed,
  );
  ok("引用矩阵里的金额 / 交期 / 日期 → 全部通过", good.ok, good.unverified);

  const bad = checkInterpretationNumbers(
    {
      priceAnalysis: `推荐 ${rec.supplierName}，落地价 ${recTotal} CAD，比乙公司贵 3,217 CAD。`,
      deliveryAnalysis: "预计 2026-12-02 到货。",
      risks: "汇率波动可能使成本上升 4%。",
      recommendation: "建议压价到 59,000。",
    },
    allowed,
  );
  const tokens = bad.unverified.map((u) => `${u.field}:${u.token}`);
  ok("自己算的差额被标出", tokens.includes("priceAnalysis:3,217"), tokens);
  ok("矩阵外的日期被标出", tokens.includes("deliveryAnalysis:2026-12-02"), tokens);
  ok("矩阵外的百分比被标出", tokens.includes("risks:4%"), tokens);
  ok("编造的目标价被标出", tokens.includes("recommendation:59,000"), tokens);
  ok("有出处的落地价不误报", !tokens.some((x) => x === `priceAnalysis:${recTotal}`), tokens);
  ok("正文就地标注（原文保留）", bad.annotated.priceAnalysis.includes(`3,217${UNVERIFIED_MARK} CAD`) && bad.annotated.recommendation.endsWith(`59,000${UNVERIFIED_MARK}。`), bad.annotated);
  ok("有出处的数字不加标注", bad.annotated.priceAnalysis.includes(`${recTotal} CAD`) && !bad.annotated.priceAnalysis.includes(`${recTotal}${UNVERIFIED_MARK}`));
  ok("同一字段多个可疑数字都标注", checkInterpretationNumbers({ a: "123 和 456" }, allowed).annotated.a === `123${UNVERIFIED_MARK} 和 456${UNVERIFIED_MARK}`);
  ok("结论里写过的百分比可以引用", (() => {
    const pct = matrix.summaryZh.match(/贵 (\d+\.\d)%/)?.[1];
    return pct === undefined || checkInterpretationNumbers({ a: `贵 ${pct}%` }, allowed).ok;
  })());
}

console.log(`\n${passed} passed`);
