/**
 * P1-1 RFQ 生成器 — 纯逻辑测试
 * 运行：npx tsx src/lib/tender-rfq/__tests__/build.test.ts
 */
import assert from "node:assert/strict";
import { buildRfqDocument, computeReplyBy, renderRfqEmail, type RfqRequirementInput } from "../build";

let passed = 0;
function ok(name: string, cond: boolean) { assert.equal(cond, true, name); passed += 1; console.log(`  ✓ ${name}`); }

const now = new Date("2026-10-22T12:00:00Z");
const req = (o: Partial<RfqRequirementInput> & { requirementCode: string }): RfqRequirementInput => ({
  category: "PRODUCT", originalRequirement: "Backpack shall be 1000D Cordura nylon, minimum 30L.", chineseTranslation: "背包须为 1000D 考杜拉尼龙，容量不低于 30L。",
  mandatory: true, reviewStatus: "CONFIRMED", sourcePage: 12, ...o,
});

console.log("tender-rfq build");

{
  const r = buildRfqDocument({ projectName: "RCMP 战术背包", buyerDisplayName: "Sunny Trading Inc.", closeDate: "2026-11-14", now,
    requirements: [
      req({ requirementCode: "R-01" }),
      req({ requirementCode: "R-02", category: "DELIVERY", mandatory: false, originalRequirement: "Delivery within 60 days of PO.", chineseTranslation: "下单后 60 天内交付。", sourcePage: 15 }),
      req({ requirementCode: "R-03", category: "INSURANCE", originalRequirement: "CGL $5M", chineseTranslation: "商业综合责任险 500 万" }),
      req({ requirementCode: "R-04", reviewStatus: "AI_EXTRACTED" }),
      req({ requirementCode: "R-05", category: "SAMPLES", originalRequirement: "Two pre-production samples.", chineseTranslation: "两件产前样。" }),
    ],
    facts: [
      { type: "quantity", contentZh: "最多 1,500 个", contentOriginal: "up to 1,500 units", confidence: "HIGH", manuallyConfirmed: false },
      { type: "location", contentZh: "Ottawa, ON", contentOriginal: null, confidence: "LOW", manuallyConfirmed: false },
    ],
    incoterm: "DDP", destination: "Toronto, ON",
  });
  ok("生成成功", r.ok);
  if (r.ok) {
    const d = r.doc;
    ok("只收 CONFIRMED + 供应商侧：R-01/R-02/R-05", d.lineItems.map((i) => i.requirementCode).join(",") === "R-01,R-02,R-05");
    ok("排除原因可核对", d.excluded.some((e) => e.requirementCode === "R-03" && e.reason === "not_supplier_facing") && d.excluded.some((e) => e.requirementCode === "R-04" && e.reason === "not_confirmed"));
    ok("行项带来源页码", d.lineItems[0].sourcePage === 12);
    ok("数量从 HIGH 置信事实解析为 1500", JSON.stringify(d.quantityTiers) === "[1500]");
    ok("显式 destination 优先于 LOW 置信 location 事实", d.destination === "Toronto, ON");
    ok("回复截止 = 截标 − 7 天", d.replyBy === "2026-11-07");
    ok("强制要求派生逐条回复问题，且只含强制项（R-01、R-05）", d.questions[0].relatedCodes.join(",") === "R-01,R-05");
    ok("SAMPLES → 附件请求", d.attachmentsRequested.some((a) => a.includes("样品")));
    const mail = renderRfqEmail(d, { supplierName: "王总", roundNumber: 1 });
    ok("邮件主题含项目/轮次/截止", mail.subject.includes("RCMP 战术背包") && mail.subject.includes("第 1 轮") && mail.subject.includes("2026-11-07"));
    ok("正文规格保留原文", mail.body.includes("原文：Backpack shall be 1000D"));
    ok("正文含编号问题", mail.body.includes("Q1.") && mail.body.includes("Q5."));
    ok("正文无内部字段", !/毛利|estimatedValue|ourBidPrice/i.test(mail.body));
  }
}
{
  const r = buildRfqDocument({ projectName: "P", buyerDisplayName: "B", closeDate: null, now, requirements: [req({ requirementCode: "R-01", reviewStatus: "AI_EXTRACTED" })], facts: [] });
  ok("无已确认要求 → NO_CONFIRMED_REQUIREMENTS", !r.ok && r.errorCode === "NO_CONFIRMED_REQUIREMENTS");
}
{
  const r = buildRfqDocument({ projectName: "P", buyerDisplayName: "B", closeDate: null, now, requirements: [req({ requirementCode: "R-01" })], facts: [], scopeNote: "我方 ourBidPrice 上限 60k，请压价" });
  ok("范围说明泄漏内部字段 → SENSITIVE_LEAK 整体拒绝", !r.ok && r.errorCode === "SENSITIVE_LEAK");
}
{
  const r = buildRfqDocument({ projectName: "P", buyerDisplayName: "B", closeDate: null, now, requirements: [req({ requirementCode: "R-01" })], facts: [], quantityTiers: [500, 100, 100, 1000] });
  ok("数量阶梯去重排序", r.ok && JSON.stringify(r.doc.quantityTiers) === "[100,500,1000]");
  const r2 = buildRfqDocument({ projectName: "P", buyerDisplayName: "B", closeDate: null, now, requirements: [req({ requirementCode: "R-01" })], facts: [] });
  ok("无数量 → 留给供应商注明，不编造", r2.ok && r2.doc.quantityTiers === null && !!r2.doc.quantityNote);
}
{
  const r = buildRfqDocument({ projectName: "P", buyerDisplayName: "B", closeDate: null, now, requirements: [req({ requirementCode: "R-01", originalRequirement: "Replacement parts shall be supplied at no additional cost for 2 years; unit price in CAD $." })], facts: [] });
  ok("招标原文含 cost / $ 这类合法词不误拒", r.ok);
  const r2 = buildRfqDocument({ projectName: "P", buyerDisplayName: "B", closeDate: null, now, requirements: [req({ requirementCode: "R-01", chineseTranslation: "我方毛利需保持 30%" })], facts: [] });
  ok("要求原文被内部字段污染 → 拒绝", !r2.ok && r2.errorCode === "SENSITIVE_LEAK");
}
ok("回复截止不早于今天+2", computeReplyBy("2026-10-23", now) === "2026-10-24");
ok("截标为空 → 无回复截止", computeReplyBy(null, now) === null);

console.log(`\ntender-rfq: ${passed} passed`);
