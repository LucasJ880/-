/**
 * Revenue Spine — 评分 / 回复草稿守卫 / Next Action / 策略合并 / 去重键 纯函数测试
 * 运行：npx tsx src/lib/revenue-spine/__tests__/scoring-draft.test.ts
 */
import assert from "node:assert/strict";
import { DEFAULT_REVENUE_SPINE_POLICY, DEFAULT_PRODUCT_KEYWORDS, MENGXIN_BUSINESS_PROFILE, mergeBusinessProfile, mergeRevenueSpinePolicy, gradeForScore } from "../policy";
import { extractRfqHeuristic } from "../rfq/heuristic-extractor";
import { buildClarifyingQuestions, computeMissingFields } from "../rfq/missing-info";
import { classifyInquiry } from "../research";
import { scoreOpportunity } from "../scoring";
import { buildReplyDraft, checkDraftGuardrails } from "../reply-draft";
import { computeNextAction } from "../next-action";
import { addBusinessDays, addBusinessHours } from "../business-days";
import { buildDedupeKeys } from "../customer-match";
import { normalizeCompanyName, normalizePhone } from "../normalize";
import { bucketOpportunities, type QueueOpportunity } from "../daily-actions";
import { roleCanAccessRevenueSpine } from "../access";
import type { FactoryKnowledgeBundle } from "../factory-knowledge";
import { getProductCapability, getMOQ, getLeadTime, getCertification, getSamplePolicy, getCostBasis } from "../factory-knowledge";

let pass = 0;
function ok(name: string, fn: () => void) {
  fn();
  pass++;
  console.log(`  ✓ ${name}`);
}
console.log("revenue-spine/scoring-draft");

const policy = DEFAULT_REVENUE_SPINE_POLICY;
const ACCEPTANCE =
  "We are a hotel supplier in Canada and are looking for 3,000 blackout curtains for an upcoming hotel project. Please advise MOQ, pricing and delivery time.";
const acceptanceInput = { name: "Cathy Li", email: "cathy@hotel-supply.ca", company: "Hotel Supply Inc", message: ACCEPTANCE };

function knowledgeFor(category: string | null): FactoryKnowledgeBundle {
  return {
    productCapability: getProductCapability(policy, category),
    moq: getMOQ(category),
    leadTime: getLeadTime(category),
    certification: getCertification(),
    samplePolicy: getSamplePolicy(policy),
    historicalQuote: { status: "unavailable", capability: "getHistoricalQuote", reason: "none" },
    costBasis: getCostBasis(category),
  };
}

ok("研究：企业邮箱域名、国家、买家类型、行业", () => {
  const r = classifyInquiry(acceptanceInput);
  assert.equal(r.emailDomain, "hotel-supply.ca");
  assert.equal(r.isFreeMail, false);
  assert.equal(r.country, "Canada");
  assert.equal(r.buyerType, "hotel_supplier");
  assert.equal(r.industry, "hospitality");
  assert.equal(r.companyName, "Hotel Supply Inc");
});

ok("验收评分：HIGH（70-89），维度可解释，建议先问缺失信息", () => {
  const ex = extractRfqHeuristic(ACCEPTANCE, { productKeywords: DEFAULT_PRODUCT_KEYWORDS });
  const research = classifyInquiry(acceptanceInput);
  const s = scoreOpportunity({ fields: ex.fields, research, message: ACCEPTANCE, policy });
  assert.ok(s.score >= 70 && s.score <= 89, `score=${s.score}`);
  assert.equal(s.grade, "HIGH");
  assert.equal(s.priority, "high");
  assert.equal(s.dimensions.length, 6);
  assert.equal(s.dimensions.reduce((a, d) => a + d.max, 0), 100);
  assert.equal(s.dimensions.find((d) => d.key === "productFit")!.score, 25);
  assert.equal(s.qualification, "needs_info");
  assert.equal(s.recommendedNextAction, "ask_missing_info");
  assert.match(s.recommendedNextActionLabel.en, /missing technical questions/i);
  assert.deepEqual(s.missingInformation.slice(0, 4), ["size", "material", "destinationCity", "requiredDeliveryDate"]);
});

ok("梦馨企业配置（浴袍/毯子，无窗帘）下同一询盘 productFit 减半、等级下降", () => {
  const mx = { ...policy, businessProfile: MENGXIN_BUSINESS_PROFILE };
  const ex = extractRfqHeuristic(ACCEPTANCE, { productKeywords: mx.businessProfile.productKeywords });
  const s = scoreOpportunity({ fields: ex.fields, research: classifyInquiry(acceptanceInput), message: ACCEPTANCE, policy: mx });
  assert.equal(s.dimensions.find((d) => d.key === "productFit")!.score, 13);
  assert.ok(s.score < 70);
});

ok("个人买家小数量 → 不合格 → nurture；免费邮箱扣分", () => {
  const msg = "Hi, I want 2 bathrobes for my home. Price?";
  const ex = extractRfqHeuristic(msg, { productKeywords: DEFAULT_PRODUCT_KEYWORDS });
  const research = classifyInquiry({ email: "john@gmail.com", message: msg });
  assert.equal(research.buyerType, "individual");
  const s = scoreOpportunity({ fields: ex.fields, research, message: msg, policy });
  assert.equal(s.qualification, "disqualified");
  assert.equal(s.recommendedNextAction, "nurture");
  assert.ok(s.grade === "LOW" || s.grade === "MEDIUM");
});

ok("完整 RFQ → rfq_ready + prepare_quote，estimatedValue = qty × 目标价", () => {
  const msg = "Distributor in Toronto, Canada. 5000 pcs coral fleece bathrobes 100% polyester 280GSM size 120x140cm, target price USD 8.5/pc, delivery by 2026-11-15.";
  const ex = extractRfqHeuristic(msg, { productKeywords: DEFAULT_PRODUCT_KEYWORDS, now: new Date("2026-09-06T00:00:00Z") });
  const s = scoreOpportunity({ fields: ex.fields, research: classifyInquiry({ email: "buyer@dist.ca", message: msg }), message: msg, policy });
  assert.equal(s.qualification, "rfq_ready");
  assert.equal(s.recommendedNextAction, "prepare_quote");
  assert.equal(s.estimatedValue, 42500);
});

ok("评分等级策略可配置", () => {
  const custom = mergeRevenueSpinePolicy(policy, { scoring: { grades: { hot: 80, high: 60, medium: 40 } } });
  assert.equal(gradeForScore(65, custom.scoring), "HIGH");
  assert.equal(gradeForScore(65, policy.scoring), "MEDIUM");
  assert.equal(custom.scoring.weights.productFit, 25);
});

ok("回复草稿：只陈述已知事实，缺失项转成问题，MOQ/价格/交期写明需内部确认，守卫通过", () => {
  const ex = extractRfqHeuristic(ACCEPTANCE, { productKeywords: DEFAULT_PRODUCT_KEYWORDS });
  const missing = computeMissingFields(ex.fields);
  const questions = buildClarifyingQuestions(missing, "en", policy.followUp.maxQuestionsPerReply);
  const d = buildReplyDraft({
    language: "en",
    contactName: "Cathy",
    companyName: "Hotel Supply Inc",
    orgName: "Mengxin Home Textile",
    senderName: "Lucas",
    fields: ex.fields,
    questions,
    knowledge: knowledgeFor("curtain"),
    policy,
  });
  assert.equal(d.guardrailViolations.length, 0);
  assert.match(d.subject, /blackout curtains/i);
  assert.match(d.body, /Quantity: 3000/);
  assert.match(d.body, /Destination country: Canada/);
  assert.match(d.body, /1\. What are the finished sizes/);
  assert.match(d.body, /confirm these internally/i);
  assert.ok(d.pendingInternalConfirmation.includes("MOQ"));
  assert.ok(!/MOQ (is|of) \d/i.test(d.body));
  assert.equal(d.templateOnly, true);
  assert.equal(d.factsUsed.length >= 3, true);
});

ok("中文草稿", () => {
  const msg = "我们是加拿大的酒店用品供应商，需要3000条遮光窗帘，请报价。";
  const ex = extractRfqHeuristic(msg, { productKeywords: DEFAULT_PRODUCT_KEYWORDS });
  const d = buildReplyDraft({
    language: "zh",
    contactName: "王经理",
    companyName: null,
    orgName: "梦馨家纺",
    senderName: "销售部",
    fields: ex.fields,
    questions: buildClarifyingQuestions(computeMissingFields(ex.fields), "zh", 4),
    knowledge: knowledgeFor("curtain"),
    policy,
  });
  assert.match(d.body, /数量：3000/);
  assert.match(d.body, /需内部/);
  assert.equal(d.guardrailViolations.length, 0);
});

ok("守卫拦截：MOQ 数字 / 单价 / 交期天数 / 认证承诺 / 付款条款 / 折扣", () => {
  assert.ok(checkDraftGuardrails("Our MOQ is 500 pcs per color.").some((v) => v.includes("MOQ")));
  assert.ok(checkDraftGuardrails("The price is USD 8.5/pc.").some((v) => v.includes("价格")));
  assert.ok(checkDraftGuardrails("Production lead time is 35 days.").some((v) => v.includes("交期")));
  assert.ok(checkDraftGuardrails("We are certified by OEKO-TEX and BSCI.").some((v) => v.includes("认证")));
  assert.ok(checkDraftGuardrails("Payment terms: 30% T/T deposit.").some((v) => v.includes("付款")));
  assert.ok(checkDraftGuardrails("We can offer 10% discount.").some((v) => v.includes("折扣")));
  assert.deepEqual(checkDraftGuardrails("Our team will confirm MOQ, pricing and lead time internally."), []);
});

ok("Factory knowledge：无数据返回 structured unavailable，可产能力来自配置", () => {
  const k = knowledgeFor("curtain");
  assert.equal(k.moq.status, "unavailable");
  assert.equal(k.leadTime.status, "unavailable");
  assert.equal(k.costBasis.status, "unavailable");
  assert.equal(k.productCapability.status, "available");
  if (k.productCapability.status === "available") assert.equal(k.productCapability.value.canProduce, true);
  const mx = getProductCapability({ ...policy, businessProfile: MENGXIN_BUSINESS_PROFILE }, "curtain");
  if (mx.status === "available") assert.equal(mx.value.canProduce, false);
});

ok("Next action：新询盘 SLA 4 工作小时；已回复无回音 3 工作日；客户来信优先；报价 3/7/14 天", () => {
  const created = new Date("2026-09-07T08:00:00Z"); // Monday
  const a = computeNextAction({ stage: "new_inquiry", createdAt: created, stageChangedAt: created, lastInteractionAt: created, lastCustomerReplyAt: created, lastOutboundAt: null, followUpCount: 0 }, policy, created)!;
  assert.equal(a.type, "reply_inquiry");
  assert.equal(a.at.toISOString(), "2026-09-07T12:00:00.000Z");
  const out = new Date("2026-09-11T15:00:00Z"); // Friday
  const b = computeNextAction({ stage: "qualified", createdAt: created, stageChangedAt: created, lastInteractionAt: out, lastCustomerReplyAt: created, lastOutboundAt: out, followUpCount: 1 }, policy, out)!;
  assert.equal(b.type, "follow_up");
  assert.equal(b.at.toISOString().slice(0, 10), "2026-09-16");
  const reply = new Date("2026-09-14T09:00:00Z");
  const c = computeNextAction({ stage: "qualified", createdAt: created, stageChangedAt: created, lastInteractionAt: reply, lastCustomerReplyAt: reply, lastOutboundAt: out, followUpCount: 1 }, policy, reply)!;
  assert.equal(c.type, "reply_customer");
  const quotedAt = new Date("2026-09-15T09:00:00Z");
  const q0 = computeNextAction({ stage: "quoted", createdAt: created, stageChangedAt: quotedAt, lastInteractionAt: quotedAt, lastCustomerReplyAt: reply, lastOutboundAt: quotedAt, followUpCount: 0 }, policy, quotedAt)!;
  assert.equal(q0.type, "quote_follow_up");
  assert.equal(q0.at.toISOString().slice(0, 10), "2026-09-18");
  const q2 = computeNextAction({ stage: "follow_up", createdAt: created, stageChangedAt: quotedAt, lastInteractionAt: quotedAt, lastCustomerReplyAt: reply, lastOutboundAt: quotedAt, followUpCount: 2 }, policy, quotedAt)!;
  assert.equal(q2.at.toISOString().slice(0, 10), "2026-09-29");
  assert.equal(computeNextAction({ stage: "won", createdAt: created, stageChangedAt: created, lastInteractionAt: null, lastCustomerReplyAt: null, lastOutboundAt: null, followUpCount: 0 }, policy, created), null);
});

ok("工作日计算跨周末", () => {
  const fri = new Date("2026-09-11T20:00:00Z");
  assert.equal(addBusinessDays(fri, 1).toISOString().slice(0, 10), "2026-09-14");
  assert.equal(addBusinessHours(fri, 8).toISOString(), "2026-09-14T04:00:00.000Z");
});

ok("去重键：企业域名 / 规范化公司名 / 电话；免费邮箱不产生域名键", () => {
  const k = buildDedupeKeys({ email: "Lucas@ABC.com", company: "ABC Trading Co., Ltd.", phone: "+1 (416) 555-0199" });
  assert.equal(k.email, "lucas@abc.com");
  assert.equal(k.domain, "abc.com");
  assert.equal(k.normalizedName, "abc");
  assert.equal(k.phone, "4165550199");
  assert.equal(buildDedupeKeys({ email: "x@gmail.com" }).domain, null);
  assert.equal(normalizeCompanyName("梦馨家纺有限公司"), "梦馨家纺");
  assert.equal(normalizePhone("123"), null);
});

ok("策略合并：非法值回退默认，企业类目覆盖", () => {
  const merged = mergeBusinessProfile(policy.businessProfile, { productCategories: ["bathrobe"], defaultIncoterm: "cif", businessType: "NOPE" });
  assert.deepEqual(merged.productCategories, ["bathrobe"]);
  assert.equal(merged.defaultIncoterm, "CIF");
  assert.equal(merged.businessType, "OEM_MANUFACTURER");
  const p2 = mergeRevenueSpinePolicy(policy, { followUp: { quoteFollowUpDays: [2, 5], maxQuestionsPerReply: 99 } });
  assert.deepEqual(p2.followUp.quoteFollowUpDays, [2, 5]);
  assert.equal(p2.followUp.maxQuestionsPerReply, 8);
});

ok("队列分桶：hot leads / need reply / quote follow-up / stale", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  const base: QueueOpportunity = {
    id: "", title: "", stage: "qualified", customerId: "c", customerName: "C", customerEmail: null, score: 80, scoreGrade: "HIGH", estimatedValue: null,
    market: null, buyerType: null, assignedToId: null, createdAt: now, updatedAt: now, stageChangedAt: now, lastInteractionAt: now, lastCustomerReplyAt: now,
    lastOutboundAt: null, nextFollowupAt: null, nextActionType: null, nextActionReason: null, followUpCount: 0, fdeInfluenced: true, fdeSourced: false,
  };
  const hot = { ...base, id: "hot" };
  const need = { ...base, id: "need", scoreGrade: "MEDIUM", lastOutboundAt: new Date("2026-09-30T00:00:00Z"), lastCustomerReplyAt: new Date("2026-09-30T12:00:00Z") };
  const quote = { ...base, id: "quote", stage: "quoted", scoreGrade: "MEDIUM", lastCustomerReplyAt: null, lastOutboundAt: new Date("2026-09-20T00:00:00Z"), nextFollowupAt: new Date("2026-09-25T00:00:00Z") };
  const stale = { ...base, id: "stale", stage: "negotiation", scoreGrade: "LOW", lastCustomerReplyAt: null, lastOutboundAt: new Date("2026-08-01T00:00:00Z"), lastInteractionAt: new Date("2026-08-01T00:00:00Z") };
  const b = bucketOpportunities([hot, need, quote, stale], policy, now);
  assert.deepEqual(b.hotLeads.map((o) => o.id), ["hot"]);
  assert.deepEqual(b.needReply.map((o) => o.id), ["need"]);
  assert.deepEqual(b.quoteFollowUp.map((o) => o.id), ["quote"]);
  assert.deepEqual(b.stale.map((o) => o.id), ["stale"]);
});

ok("角色矩阵：trade/sales/boss/manager/admin 可进；user/operations 不可", () => {
  for (const r of ["trade", "sales", "boss", "manager", "admin", "super_admin"]) assert.ok(roleCanAccessRevenueSpine(r), r);
  for (const r of ["user", "operations", null, undefined, ""]) assert.equal(roleCanAccessRevenueSpine(r), false, String(r));
});

console.log(`\n${pass} passed`);
