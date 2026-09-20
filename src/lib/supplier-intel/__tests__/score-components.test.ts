/**
 * S4-B §64–§68 — 四个评分组件 + 价格证据层 + 官方总分（纯核）。
 * T1–T4 / C1–C6 / R1–R5 / I1–I5 / P1–P3 + 冻结公式测试。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SUPPLIER_SCORE_V1, computeSupplierScore } from "../score-contract";
import { deriveCandidateRecommendation, RECOMMENDATION_CONTRACT_V1 } from "../recommendation-contract";
import {
  COMMERCIAL_V1, IMPORT_RISK_V1, RELIABILITY_V1, TECHNICAL_POINTS,
  buildOfficialScore, computeCommercialScore, computeImportRiskScore, computeReliabilityScore, computeTechnicalFit, derivePriceEvidenceTier, isOne688Url,
  type RfqRoundItemInput,
} from "../score-components";

const req = (key: string, category: string | null, mandatory: true | false | "uncertain" = true) => ({ key, category, mandatory });
const m = (requirementKey: string, verdict: string, evaluatedBy = "HUMAN") => ({ requirementKey, verdict, evaluatedBy });
const item = (o: Partial<RfqRoundItemInput> & { supplierId: string }): RfqRoundItemInput => ({ itemId: `it-${o.supplierId}`, status: "quoted", repliedAt: "2026-09-01T00:00:00.000Z", unitPrice: null, totalPrice: null, currency: "CAD", deliveryDays: null, validUntil: null, ...o });

async function main() {
  console.log("纯度：score-components.ts 只 import constants / score-contract；无 IO / 时钟 / 随机 / 手写权重");
  const src = readFileSync(join(__dirname, "..", "score-components.ts"), "utf8");
  const imports = [...src.matchAll(/from "([^"]+)"/g)].map((x) => x[1]);
  assert.deepEqual([...new Set(imports)].sort(), ["./constants", "./score-contract"]);
  assert.ok(!/fetch\(|prisma|\bdb\.|Date\.now|new Date\(|Math\.random/.test(src));
  assert.ok(!/\*\s*0\.4\b|\*\s*0\.25\b|0\.4\s*\*|0\.25\s*\*/.test(src), "不得手写 40/25/20/15 加权");

  console.log("T1：PASS / PARTIAL / FAIL = 100 / 50 / 0");
  const t1 = computeTechnicalFit([req("R1", "technical"), req("R2", "product"), req("R3", "safety")], [m("R1", "PASS"), m("R2", "PARTIAL"), m("R3", "FAIL")]);
  assert.equal(t1.score, 50); assert.deepEqual(t1.items.map((i) => i.points), [100, 50, 0]);
  assert.deepEqual(TECHNICAL_POINTS, { PASS: 100, PARTIAL: 50, FAIL: 0, UNKNOWN: 0, MISSING: 0 });

  console.log("T2：UNKNOWN / 缺 Match 进入分母按 0（资料越少不能分越高）");
  const t2 = computeTechnicalFit([req("R1", "technical"), req("R2", "technical"), req("R3", "technical"), req("R4", "technical")], [m("R1", "PASS"), m("R2", "UNKNOWN")]);
  assert.equal(t2.scorableCount, 4); assert.equal(t2.score, 25);
  assert.equal(t2.items.find((i) => i.key === "R3")?.verdict, "MISSING");

  console.log("T3：AI_ASSISTED 未确认 → 0，并记原因码");
  const t3 = computeTechnicalFit([req("R1", "technical"), req("R2", "technical")], [m("R1", "PASS", "AI_ASSISTED"), m("R2", "PASS", "DETERMINISTIC")]);
  assert.equal(t3.score, 50); assert.ok(t3.reasonCodes.includes("TECHNICAL_AI_ASSISTED_UNCONFIRMED"));

  console.log("T4：没有可计分技术项 → technical null（不造 50 / 100）；非技术类不进分母；词表外 category → UNMAPPED");
  const t4 = computeTechnicalFit([req("R1", "delivery"), req("R2", "warranty"), req("R3", "mystery_category")], [m("R1", "PASS"), m("R2", "PASS"), m("R3", "PASS")]);
  assert.equal(t4.score, null); assert.equal(t4.excluded.length, 2); assert.equal(t4.unmapped.length, 1);
  assert.ok(t4.reasonCodes.includes("TECHNICAL_NO_SCORABLE_REQUIREMENTS") && t4.reasonCodes.includes("UNMAPPED_REQUIREMENT_CATEGORY"));
  const t4b = computeTechnicalFit([req("R1", "technical"), req("R3", "mystery_category")], [m("R1", "PASS"), m("R3", "FAIL")]);
  assert.equal(t4b.score, 100, "UNMAPPED 不静默计分（也不静默扣分）");

  console.log("C1：同项目、同轮、同币种、两家已确认 → 可算；C2 最低价 = 100；C3 两倍最低价 = 50");
  const round = { inquiryId: "inq1", roundNumber: 2, scope: "chairs", items: [item({ supplierId: "A", totalPrice: 110, deliveryDays: 30, validUntil: "2026-12-01" }), item({ supplierId: "B", totalPrice: 220, deliveryDays: 60 })] };
  const cA = computeCommercialScore({ candidateSupplierId: "A", round, priceEvidenceTier: "RFQ_CONFIRMED" });
  const cB = computeCommercialScore({ candidateSupplierId: "B", round, priceEvidenceTier: "RFQ_CONFIRMED" });
  assert.equal(cA.sub.price, 100); assert.equal(cB.sub.price, 50); assert.equal(cA.priceBasis, "totalPrice");
  assert.equal(cA.sub.delivery, 100); assert.equal(cB.sub.delivery, 50);
  assert.equal(cA.sub.completeness, 100); assert.equal(cB.sub.completeness, 66.67);
  assert.equal(cA.score, 100); assert.equal(cB.score, 0.7 * 50 + 0.2 * 50 + 0.1 * 66.67 === 51.667 ? 51.67 : cB.score);
  assert.equal(cB.score, 51.67);
  assert.deepEqual(COMMERCIAL_V1, { price: 0.7, delivery: 0.2, completeness: 0.1 });

  console.log("C4：混币种 → commercial null（不实时查汇率）");
  const mixed = { ...round, items: [item({ supplierId: "A", totalPrice: 110, currency: "CAD" }), item({ supplierId: "B", totalPrice: 80, currency: "USD" })] };
  const c4 = computeCommercialScore({ candidateSupplierId: "A", round: mixed, priceEvidenceTier: "RFQ_CONFIRMED" });
  assert.equal(c4.score, null); assert.deepEqual(c4.reasonCodes, ["COMMERCIAL_NOT_COMPARABLE_CURRENCY"]);

  console.log("C5：只有一家正式报价 → null");
  const single = { ...round, items: [item({ supplierId: "A", totalPrice: 110 }), item({ supplierId: "B", repliedAt: null, totalPrice: null })] };
  assert.deepEqual(computeCommercialScore({ candidateSupplierId: "A", round: single, priceEvidenceTier: "RFQ_CONFIRMED" }).reasonCodes, ["COMMERCIAL_SINGLE_QUOTE"]);

  console.log("C6：只有 1688 挂牌价（无 RFQ）→ null + PLATFORM_LISTED_ONLY；即使挂牌价最低");
  const c6 = computeCommercialScore({ candidateSupplierId: "A", round: null, priceEvidenceTier: "PLATFORM_LISTED" });
  assert.equal(c6.score, null); assert.deepEqual(c6.reasonCodes, ["COMMERCIAL_NO_CONFIRMED_RFQ", "COMMERCIAL_PLATFORM_LISTED_ONLY"]);
  const c6b = computeCommercialScore({ candidateSupplierId: "A", round: { ...round, items: [item({ supplierId: "B", totalPrice: 110 }), item({ supplierId: "C", totalPrice: 120 })] }, priceEvidenceTier: "PLATFORM_LISTED" });
  assert.equal(c6b.score, null, "同轮别人有报价、自己没有 → 仍 null");

  console.log("价格口径不混用：A 只有 totalPrice、B 只有 unitPrice → 不可比");
  const basisMix = { ...round, items: [item({ supplierId: "A", totalPrice: 110 }), item({ supplierId: "B", unitPrice: 5 })] };
  assert.deepEqual(computeCommercialScore({ candidateSupplierId: "A", round: basisMix, priceEvidenceTier: "RFQ_CONFIRMED" }).reasonCodes, ["COMMERCIAL_NOT_COMPARABLE_PRICE_BASIS"]);
  const unitOnly = { ...round, items: [item({ supplierId: "A", unitPrice: 5 }), item({ supplierId: "B", unitPrice: 10 })] };
  assert.equal(computeCommercialScore({ candidateSupplierId: "B", round: unitOnly, priceEvidenceTier: "RFQ_CONFIRMED" }).sub.price, 50);
  const noDelivery = computeCommercialScore({ candidateSupplierId: "A", round: unitOnly, priceEvidenceTier: "RFQ_CONFIRMED" });
  assert.equal(noDelivery.sub.delivery, 0); assert.ok(noDelivery.reasonCodes.includes("DELIVERY_UNKNOWN"));

  console.log("R1：历史实际联系 < 2 → null（不给新供应商虚构 50）");
  const r1 = computeReliabilityScore({ currentProjectId: "P0", history: [{ itemId: "i1", projectId: "P1", status: "quoted", sentAt: "2025-01-01", repliedAt: "2025-01-02", isSelected: true }] });
  assert.equal(r1.score, null); assert.deepEqual(r1.reasonCodes, ["RELIABILITY_HISTORY_INSUFFICIENT"]);
  console.log("R1b：当前项目自己的询价不算历史");
  const r1b = computeReliabilityScore({ currentProjectId: "P0", history: [{ itemId: "i1", projectId: "P0", status: "quoted", sentAt: "x", repliedAt: "y", isSelected: true }, { itemId: "i2", projectId: "P0", status: "quoted", sentAt: "x", repliedAt: "y", isSelected: false }] });
  assert.equal(r1b.contacted, 0);

  console.log("R2：≥2 条历史 → 70% 回复率 + 30% 曾入选");
  const r2 = computeReliabilityScore({ currentProjectId: "P0", history: [
    { itemId: "i1", projectId: "P1", status: "quoted", sentAt: "x", repliedAt: "y", isSelected: true },
    { itemId: "i2", projectId: "P2", status: "no_response", sentAt: "x", repliedAt: null, isSelected: false },
    { itemId: "i3", projectId: "P3", status: "pending", sentAt: null, repliedAt: null, isSelected: false },
  ] });
  assert.equal(r2.contacted, 2); assert.equal(r2.sub.responseRate, 50); assert.equal(r2.sub.priorSelection, 50); assert.equal(r2.score, 50);
  assert.deepEqual(RELIABILITY_V1, { responseRate: 0.7, priorSelection: 0.3, minHistory: 2 });
  const r2b = computeReliabilityScore({ currentProjectId: "P0", history: [
    { itemId: "i1", projectId: "P1", status: "quoted", sentAt: "x", repliedAt: "y", isSelected: true },
    { itemId: "i2", projectId: "P2", status: "quoted", sentAt: "x", repliedAt: "y", isSelected: true },
  ] });
  assert.equal(r2b.score, 100);

  console.log("R3 / R4 / R5：输入里根本没有 Supplier.rating / originSource / 1688 店铺指标——类型层不接受");
  assert.ok(!/rating|originSource|HISTORICAL_SUCCESS|店龄|成交|回头率/.test(src.split("Reliability — 20")[1].split("Import / Delivery")[0]));

  console.log("I1：无 VERIFIED 出口能力 → null（不打 0）；I3 只有 CLAIMED → 仍 null + EXPORT_CLAIMED_ONLY");
  const i1 = computeImportRiskScore({ capabilities: [], offering: { incoterm: "FOB", leadTimeDays: 30 } });
  assert.equal(i1.score, null); assert.deepEqual(i1.reasonCodes, ["EXPORT_READINESS_UNVERIFIED"]);
  const i3 = computeImportRiskScore({ capabilities: [{ id: "c1", type: "CANADA_EXPORT", evidenceStatus: "CLAIMED" }, { id: "c2", type: "OVERSEAS_EXPORT", evidenceStatus: "OBSERVED" }], offering: null });
  assert.equal(i3.score, null); assert.deepEqual(i3.reasonCodes, ["EXPORT_READINESS_UNVERIFIED", "EXPORT_CLAIMED_ONLY"]); assert.equal(i3.unverified.length, 2);

  console.log("I2：CANADA_EXPORT VERIFIED → 可算；公式 50/20/15/15 冻结");
  const i2 = computeImportRiskScore({ capabilities: [{ id: "c1", type: "CANADA_EXPORT", evidenceStatus: "VERIFIED" }, { id: "c3", type: "EXPORT_PACKAGING", evidenceStatus: "VERIFIED" }], offering: { incoterm: "FOB", leadTimeDays: 30 } });
  assert.equal(i2.score, 100);
  const i2b = computeImportRiskScore({ capabilities: [{ id: "c1", type: "OVERSEAS_EXPORT", evidenceStatus: "VERIFIED" }], offering: { incoterm: "unknown-term", leadTimeDays: null } });
  assert.equal(i2b.score, 37.5); assert.deepEqual(i2b.sub, { readiness: 75, packaging: 0, incoterm: 0, leadTime: 0 });
  assert.deepEqual(IMPORT_RISK_V1, { readiness: 0.5, packaging: 0.2, incoterm: 0.15, leadTime: 0.15 });
  const both = computeImportRiskScore({ capabilities: [{ id: "c1", type: "OVERSEAS_EXPORT", evidenceStatus: "VERIFIED" }, { id: "c2", type: "CANADA_EXPORT", evidenceStatus: "VERIFIED" }], offering: null });
  assert.equal(both.sub.readiness, 100, "两者都有取高");

  console.log("I4：1688 文案「出口加拿大」不是能力证据——组件只接受 capability 行，且非 VERIFIED 不计");
  assert.equal(computeImportRiskScore({ capabilities: [{ id: "x", type: "CANADA_EXPORT", evidenceStatus: "CLAIMED" }], offering: null }).score, null);

  console.log("价格证据层：RFQ > INQUIRY > PLATFORM_LISTED(1688) > HUMAN_ENTERED > ESTIMATED > UNKNOWN；客户端无入口");
  assert.equal(derivePriceEvidenceTier({ rfqConfirmed: true, offering: null }), "RFQ_CONFIRMED");
  assert.equal(derivePriceEvidenceTier({ rfqConfirmed: false, offering: { sourceKind: "INQUIRY", priceStatus: "KNOWN", unitPrice: "80", sourceUrl: null, sourceSignalPlatform: null } }), "INQUIRY_CONFIRMED");
  assert.equal(derivePriceEvidenceTier({ rfqConfirmed: false, offering: { sourceKind: "DISCOVERY", priceStatus: "KNOWN", unitPrice: "80", sourceUrl: "https://detail.1688.com/offer/1.html", sourceSignalPlatform: null } }), "PLATFORM_LISTED");
  assert.equal(derivePriceEvidenceTier({ rfqConfirmed: false, offering: { sourceKind: "DISCOVERY", priceStatus: "KNOWN", unitPrice: "80", sourceUrl: null, sourceSignalPlatform: "ONE688" } }), "PLATFORM_LISTED");
  assert.equal(derivePriceEvidenceTier({ rfqConfirmed: false, offering: { sourceKind: "MANUAL", priceStatus: "KNOWN", unitPrice: 80, sourceUrl: null, sourceSignalPlatform: null } }), "HUMAN_ENTERED");
  assert.equal(derivePriceEvidenceTier({ rfqConfirmed: false, offering: { sourceKind: "BROCHURE", priceStatus: "ESTIMATED", unitPrice: 80, sourceUrl: null, sourceSignalPlatform: null } }), "ESTIMATED");
  assert.equal(derivePriceEvidenceTier({ rfqConfirmed: false, offering: { sourceKind: "MANUAL", priceStatus: "UNKNOWN", unitPrice: null, sourceUrl: null, sourceSignalPlatform: null } }), "UNKNOWN");
  assert.ok(isOne688Url("https://shop123.1688.com/x") && !isOne688Url("https://not1688.com/x"));

  console.log("P1：四维齐全 → officialTotal == computeSupplierScore().totalScore；P3 权重 40/25/20/15");
  const full = buildOfficialScore({ technical: 80, commercial: 60, reliability: 90, importRisk: 70 });
  assert.equal(full.officialTotalScore, computeSupplierScore({ technical: 80, commercial: 60, reliability: 90, importRisk: 70 }).totalScore);
  assert.equal(full.officialTotalScore, 80 * 0.4 + 60 * 0.25 + 90 * 0.2 + 70 * 0.15);
  assert.deepEqual(SUPPLIER_SCORE_V1.weights, { technical: 0.4, commercial: 0.25, reliability: 0.2, importRisk: 0.15 });

  console.log("P2：任一维 null → officialTotal null，即使 breakdown 有归一化 total");
  const partial = buildOfficialScore({ technical: 100, commercial: null, reliability: null, importRisk: null });
  assert.equal(partial.breakdown.totalScore, 100); assert.equal(partial.officialTotalScore, null);

  console.log("推荐契约：FAIL → NOT_ELIGIBLE；INCOMPLETE → NEEDS_VERIFICATION；PASS 缺维 → NEEDS_VERIFICATION；importRisk<50 或 reliability<40 → HIGH_RISK；否则 null（可排名）");
  assert.equal(deriveCandidateRecommendation({ gateResult: "FAIL", components: { technical: 100, commercial: 100, reliability: 100, importRisk: 100 }, officialTotalScore: 100 }).recommendation, "NOT_ELIGIBLE");
  assert.equal(deriveCandidateRecommendation({ gateResult: "INCOMPLETE", components: { technical: 100, commercial: 100, reliability: 100, importRisk: 100 }, officialTotalScore: 100 }).recommendation, "NEEDS_VERIFICATION");
  assert.equal(deriveCandidateRecommendation({ gateResult: "PASS", components: { technical: 100, commercial: null, reliability: 100, importRisk: 100 }, officialTotalScore: null }).recommendation, "NEEDS_VERIFICATION");
  assert.equal(deriveCandidateRecommendation({ gateResult: "PASS", components: { technical: 100, commercial: 100, reliability: 100, importRisk: 49 }, officialTotalScore: 90 }).recommendation, "HIGH_RISK");
  assert.equal(deriveCandidateRecommendation({ gateResult: "PASS", components: { technical: 100, commercial: 100, reliability: 39, importRisk: 100 }, officialTotalScore: 90 }).recommendation, "HIGH_RISK");
  const ok = deriveCandidateRecommendation({ gateResult: "PASS", components: { technical: 100, commercial: 100, reliability: 40, importRisk: 50 }, officialTotalScore: 90 });
  assert.equal(ok.recommendation, null); assert.equal(ok.rankable, true);
  assert.deepEqual(RECOMMENDATION_CONTRACT_V1.highRisk, { importRiskBelow: 50, reliabilityBelow: 40 });

  console.log("\nS4-B 评分组件纯核全部通过");
}
main().catch((e) => { console.error(e); process.exit(1); });
