/**
 * Revenue Spine — 企业商务事实（commercialFacts）：参考值原句、守卫剔除、润色篡改回退、禁用款号、
 * 展会 C 级只发目录、落款附加行、关闭培育回访。纯函数，无 DB。
 * 运行：npx tsx src/lib/revenue-spine/__tests__/commercial-facts.test.ts
 *
 * 公开仓库：只用虚构企业与数值，不写任何真实客户。
 */
import assert from "node:assert/strict";
import {
  DEFAULT_PRODUCT_KEYWORDS,
  DEFAULT_REVENUE_SPINE_POLICY,
  EMPTY_COMMERCIAL_FACTS,
  mergeCommercialFacts,
  mergeRevenueSpinePolicy,
  type RevenueSpinePolicy,
} from "../policy";
import {
  getCertification,
  getCostBasis,
  getLeadTime,
  getMOQ,
  getProductCapability,
  getSamplePolicy,
  type FactoryKnowledgeBundle,
} from "../factory-knowledge";
import {
  allowedStyles,
  buildReferenceLines,
  buildReplyDraft,
  checkDraftWithReferenceLines,
  polishReplyDraftWithLlm,
  signatureLines,
} from "../reply-draft";
import { buildNoReplyFollowUpDraft } from "../fde/no-reply-followup";
import { extractRfqHeuristic } from "../rfq/heuristic-extractor";
import { buildClarifyingQuestions, computeMissingFields } from "../rfq/missing-info";
import { computeNextAction } from "../next-action";
import { classifyInquiry } from "../research";
import { scoreOpportunity } from "../scoring";

let pass = 0;
async function ok(name: string, fn: () => void | Promise<void>) {
  await fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

const FACTS_OVERRIDE = {
  businessProfile: {
    productCategories: ["blanket", "bathrobe", "towel"],
    commercialFacts: {
      moq: { quantity: 1000, unit: "pcs", per: "style" },
      sampleLeadTime: { stockDays: 3, customDaysMin: 10, customDaysMax: 15 },
      productionLeadTime: { daysMin: 35, daysMax: 45, startsFrom: "pre-production sample approval" },
      loadingPorts: ["Ningbo", "Shanghai"],
      signature: { title: "Sales Representative", whatsapp: "+86 100 0000 0000", website: "example-textiles.com" },
      blockedStyleCodes: ["xx-bl-005", "XX_CP_001"],
      referencePrograms: [
        { category: "towel", summaryEn: "We currently produce a 550 GSM terry towel line for a hotel supply company in Europe.", summaryZh: "我们目前为欧洲一家酒店用品公司生产 550 克毛圈毛巾系列。", disclosure: "anonymized" },
        { category: "blanket", summaryEn: "INTERNAL ONLY reference", summaryZh: "仅内部", disclosure: "internal" },
        { category: "blanket", summaryEn: "No disclosure level", summaryZh: "无披露级别" },
      ],
      gradeCCatalogOnly: true,
      catalogUrl: "https://example-textiles.com/catalog.pdf",
    },
  },
};

const withFacts: RevenueSpinePolicy = mergeRevenueSpinePolicy(DEFAULT_REVENUE_SPINE_POLICY, FACTS_OVERRIDE);
const plain = DEFAULT_REVENUE_SPINE_POLICY;

function knowledgeFor(policy: RevenueSpinePolicy, category: string | null): FactoryKnowledgeBundle {
  return {
    productCapability: getProductCapability(policy, category),
    moq: getMOQ(category, policy),
    leadTime: getLeadTime(category, policy),
    certification: getCertification(),
    samplePolicy: getSamplePolicy(policy),
    historicalQuote: { status: "unavailable", capability: "getHistoricalQuote", reason: "none" },
    costBasis: getCostBasis(category),
  };
}

const MSG = "We are a hotel supplier in Canada looking for 3,000 bath towels. Please advise MOQ, pricing and delivery time.";

function draftBase(policy: RevenueSpinePolicy, lang: "en" | "zh" = "en") {
  const ex = extractRfqHeuristic(MSG, { productKeywords: policy.businessProfile.productKeywords ?? DEFAULT_PRODUCT_KEYWORDS });
  const fields = ex.fields;
  return {
    language: lang,
    contactName: "Emma",
    companyName: "Maple Home Goods",
    orgName: "Example Textiles",
    senderName: "Lily",
    fields,
    questions: buildClarifyingQuestions(computeMissingFields(fields), lang, policy.followUp.maxQuestionsPerReply),
    knowledge: knowledgeFor(policy, fields.productCategory),
    policy,
  };
}

const REF_EN =
  "For reference, our MOQ is typically 1,000 pcs per style, and bulk production usually takes 35–45 days after pre-production sample approval. Both are confirmed for your project in our quotation.";

async function main() {
  console.log("revenue-spine/commercial-facts");

  await ok("默认策略：商务事实全空，MOQ / 交期 unavailable", () => {
    assert.deepEqual(plain.businessProfile.commercialFacts, EMPTY_COMMERCIAL_FACTS);
    assert.equal(getMOQ("towel", plain).status, "unavailable");
    assert.equal(getLeadTime("towel", plain).status, "unavailable");
    assert.equal(getMOQ("towel").status, "unavailable");
  });

  await ok("合并：字段校验、款号规范化、内部 / 未声明披露的参考项目被丢弃、目录链接只收 https", () => {
    const cf = withFacts.businessProfile.commercialFacts;
    assert.deepEqual(cf.moq, { quantity: 1000, unit: "pcs", per: "style" });
    assert.deepEqual(cf.productionLeadTime, { daysMin: 35, daysMax: 45, startsFrom: "pre-production sample approval" });
    assert.deepEqual(cf.blockedStyleCodes, ["XX-BL-005", "XX-CP-001"]);
    assert.equal(cf.referencePrograms.length, 1);
    assert.equal(cf.referencePrograms[0].disclosure, "anonymized");
    assert.equal(mergeCommercialFacts(cf, { catalogUrl: "http://insecure.example/c.pdf" }).catalogUrl, null);
    assert.equal(mergeCommercialFacts(cf, { moq: null }).moq, null);
    assert.equal(mergeCommercialFacts(cf, { moq: { quantity: -5 } }).moq, null);
    assert.equal(mergeCommercialFacts(cf, { productionLeadTime: { daysMin: 45, daysMax: 35 } }).productionLeadTime, null);
    // 未提及的字段保持不变
    assert.deepEqual(mergeCommercialFacts(cf, { loadingPorts: ["Ningbo"] }).moq, cf.moq);
  });

  await ok("未配置商务事实：草稿与原来一致，MOQ / 交期写需内部确认，无参考原句", () => {
    const d = buildReplyDraft(draftBase(plain));
    assert.deepEqual(d.referenceLines, []);
    assert.ok(d.pendingInternalConfirmation.includes("MOQ"));
    assert.doesNotMatch(d.body, /For reference/);
    assert.equal(d.guardrailViolations.length, 0);
  });

  await ok("配置后：写入参考原句，守卫通过，待确认只剩价格", () => {
    const d = buildReplyDraft(draftBase(withFacts));
    assert.ok(d.body.includes(REF_EN), d.body);
    assert.ok(d.body.includes("Loading ports: Ningbo or Shanghai."));
    assert.deepEqual(d.referenceLines, [REF_EN, "Loading ports: Ningbo or Shanghai."]);
    assert.deepEqual(d.pendingInternalConfirmation, ["pricing"]);
    assert.equal(d.guardrailViolations.length, 0);
    assert.match(d.body, /Regarding pricing: our team will confirm/);
  });

  await ok("守卫：原句以外出现的数字承诺照样拦截", () => {
    const d = buildReplyDraft(draftBase(withFacts));
    assert.deepEqual(checkDraftWithReferenceLines(d.body, d.referenceLines), []);
    const tampered = `${d.body}\nOur MOQ is 300 pcs.`;
    assert.ok(checkDraftWithReferenceLines(tampered, d.referenceLines).some((v) => v.startsWith("MOQ")));
    const lead = `${d.body}\nProduction takes 20 days.`;
    assert.ok(checkDraftWithReferenceLines(lead, d.referenceLines).length > 0);
    // 不带原句白名单时，参考原句本身就是违规（证明白名单在起作用）
    assert.ok(checkDraftWithReferenceLines(d.body, []).length > 0);
  });

  await ok("中文草稿：参考原句为中文，守卫通过", () => {
    const d = buildReplyDraft({ ...draftBase(withFacts, "zh"), orgName: "示例家纺" });
    assert.ok(d.body.includes("供参考：起订量一般为每款 1,000 件；大货生产一般在确认大货样后 35–45 天。具体以我们针对您项目的报价为准。"), d.body);
    assert.ok(d.body.includes("装运港可选：Ningbo、Shanghai。"));
    assert.equal(d.guardrailViolations.length, 0);
  });

  await ok("润色：保留原句 → 接受；改数字 / 删原句 / 加新承诺 → 回退模板", async () => {
    const d = buildReplyDraft(draftBase(withFacts));
    const keep = await polishReplyDraftWithLlm(d, { orgId: "o", userId: "u", complete: async (b) => b.replace("Dear Emma,", "Hi Emma,") });
    assert.equal(keep.templateOnly, false);
    assert.match(keep.body, /^Hi Emma,/);
    const changed = await polishReplyDraftWithLlm(d, { orgId: "o", userId: "u", complete: async (b) => b.replace("1,000", "500") });
    assert.equal(changed.body, d.body);
    assert.equal(changed.templateOnly, true);
    const dropped = await polishReplyDraftWithLlm(d, { orgId: "o", userId: "u", complete: async (b) => b.replace(REF_EN, "") });
    assert.equal(dropped.body, d.body);
    const added = await polishReplyDraftWithLlm(d, { orgId: "o", userId: "u", complete: async (b) => `${b}\nWe can also deliver within 15 days if needed.` });
    assert.equal(added.body, d.body);
    assert.equal(added.templateOnly, true);
  });

  await ok("参考项目：只在类目匹配时写入一句（匿名级别），内部级别不会出现", () => {
    const d = buildReplyDraft(draftBase(withFacts));
    assert.match(d.body, /We currently produce a 550 GSM terry towel line for a hotel supply company in Europe\./);
    assert.doesNotMatch(d.body, /INTERNAL ONLY|No disclosure level/);
    const plainDraft = buildReplyDraft(draftBase(plain));
    assert.doesNotMatch(plainDraft.body, /We currently produce/);
  });

  await ok("禁用款号：展会卡上记了也不写进邮件和主题", () => {
    const styles = [
      { code: "XX-BL-001", name: "Flannel Blanket" },
      { code: "xx-bl-005", name: "Blocked Blanket" },
      { code: "XX-CP-001", name: "Blocked Cushion" },
    ];
    assert.deepEqual(allowedStyles(styles, withFacts).map((s) => s.code), ["XX-BL-001"]);
    const d = buildReplyDraft({ ...draftBase(withFacts), tradeShow: { event: "the Example Fair", styles } });
    assert.match(d.body, /Flannel Blanket \(ref\. XX-BL-001\)/);
    assert.doesNotMatch(d.body, /Blocked|XX-BL-005|xx-bl-005|XX-CP-001/);
    assert.doesNotMatch(d.subject, /more/);
  });

  await ok("展会 C 级 + 只发目录：不确认需求、不追问、不列待确认，给目录链接", () => {
    const base = { ...draftBase(withFacts), tradeShow: { event: "the Example Fair", styles: [{ code: "XX-BL-001", name: "Flannel Blanket" }] } };
    const c = buildReplyDraft({ ...base, boothGrade: "C" });
    assert.equal(c.catalogOnly, true);
    assert.doesNotMatch(c.body, /please confirm|could you please let us know|Regarding pricing|For reference/);
    assert.match(c.body, /You can find our product catalogue here: https:\/\/example-textiles\.com\/catalog\.pdf/);
    assert.deepEqual(c.pendingInternalConfirmation, []);
    assert.equal(c.guardrailViolations.length, 0);
    // A 级照常
    const a = buildReplyDraft({ ...base, boothGrade: "A" });
    assert.equal(a.catalogOnly, false);
    assert.match(a.body, /could you please let us know/);
    // 企业未开启时，C 级也照常
    const off = mergeRevenueSpinePolicy(withFacts, { businessProfile: { commercialFacts: { gradeCCatalogOnly: false } } });
    const c2 = buildReplyDraft({ ...base, policy: off, knowledge: knowledgeFor(off, base.fields.productCategory), boothGrade: "C" });
    assert.equal(c2.catalogOnly, false);
    // 官网询盘（非展会）不受 C 级影响
    const web = buildReplyDraft({ ...draftBase(withFacts), boothGrade: "C" });
    assert.equal(web.catalogOnly, false);
  });

  await ok("落款：职位跟在姓名后，WhatsApp / 网站跟在公司名后；首封与无回复跟进一致", () => {
    const d = buildReplyDraft(draftBase(withFacts));
    assert.match(d.body, /Best regards,\nLily\nSales Representative\nExample Textiles\nWhatsApp \+86 100 0000 0000\nexample-textiles\.com$/);
    const plainDraft = buildReplyDraft(draftBase(plain));
    assert.match(plainDraft.body, /Best regards,\nLily\nExample Textiles$/);
    assert.deepEqual(signatureLines(plain, "en"), { afterName: [], afterOrg: [] });
    const f = buildNoReplyFollowUpDraft({
      step: 1,
      total: 2,
      language: "en",
      contactName: "Emma",
      orgName: "Example Textiles",
      senderName: "Lily",
      previousSubject: "Re: Your inquiry",
      previousSentAt: new Date("2026-10-01T00:00:00Z"),
      product: "bath towels",
      event: null,
      questions: [],
      signature: signatureLines(withFacts, "en"),
    });
    assert.match(f.body, /Lily\nSales Representative\nExample Textiles\nWhatsApp \+86 100 0000 0000\nexample-textiles\.com$/);
    assert.equal(f.guardrailViolations.length, 0);
  });

  await ok("参考原句只用企业配置的数字，不读买家来信", () => {
    const lines = buildReferenceLines(knowledgeFor(withFacts, "towel"), withFacts, "en");
    assert.equal(lines[0], REF_EN);
    assert.equal(buildReferenceLines(knowledgeFor(plain, "towel"), plain, "en").length, 0);
  });

  await ok("培育回访：nurtureCheckInDays = 0 关闭；默认 30 天照旧", () => {
    const opp = {
      stage: "nurture",
      createdAt: new Date("2026-09-01T00:00:00Z"),
      stageChangedAt: new Date("2026-09-01T00:00:00Z"),
      lastInteractionAt: null,
      lastCustomerReplyAt: null,
      lastOutboundAt: null,
      followUpCount: 0,
    };
    const off = mergeRevenueSpinePolicy(plain, { followUp: { nurtureCheckInDays: 0 } });
    assert.equal(off.followUp.nurtureCheckInDays, 0);
    assert.equal(computeNextAction(opp, off, new Date("2026-10-01T00:00:00Z")), null);
    const on = computeNextAction(opp, plain, new Date("2026-10-01T00:00:00Z"));
    assert.equal(on?.type, "nurture_check_in");
  });


  await ok("不做的类目：只问床品 → productFit 0、不判不合格、标 outOfRange（默认 review）", () => {
    const pol = mergeRevenueSpinePolicy(withFacts, { businessProfile: { excludedCategories: ["bedding", "slipper"] } });
    const msg = "We need 2,000 duvet covers and pillowcases for a hotel in Toronto.";
    const ex = extractRfqHeuristic(msg, { productKeywords: pol.businessProfile.productKeywords });
    assert.equal(ex.fields.productCategory, "bedding");
    const s = scoreOpportunity({ fields: ex.fields, research: classifyInquiry({ name: "A", email: "a@hotelco.ca", company: "HotelCo", message: msg }), message: msg, policy: pol });
    assert.equal(s.outOfRange, true);
    assert.equal(s.dimensions.find((d) => d.key === "productFit")!.score, 0);
    assert.equal(s.qualification, "needs_info");
    assert.equal(s.recommendedNextAction, "decline");
  });

  await ok("不做的类目 + decline 模式 → 不合格；混合询盘（浴巾 + 拖鞋）不按不做处理", () => {
    const pol = mergeRevenueSpinePolicy(withFacts, { businessProfile: { excludedCategories: ["bedding", "slipper"], excludedCategoryAction: "decline" } });
    const only = "Looking for 5,000 pairs of hotel slippers.";
    const ex1 = extractRfqHeuristic(only, { productKeywords: pol.businessProfile.productKeywords });
    const s1 = scoreOpportunity({ fields: ex1.fields, research: classifyInquiry({ name: "A", email: "a@spa.com", company: "Spa", message: only }), message: only, policy: pol });
    assert.equal(s1.outOfRange, true);
    assert.equal(s1.qualification, "disqualified");
    const mixed = "Looking for 5,000 pairs of slippers and 5,000 bath towels.";
    const ex2 = extractRfqHeuristic(mixed, { productKeywords: pol.businessProfile.productKeywords });
    const s2 = scoreOpportunity({ fields: ex2.fields, research: classifyInquiry({ name: "A", email: "a@spa.com", company: "Spa", message: mixed }), message: mixed, policy: pol });
    assert.equal(s2.outOfRange, false);
    assert.notEqual(s2.qualification, "disqualified");
  });

  await ok("未配置不做清单：行为与 V1 相同（不在范围扣一半分）", () => {
    const msg = "We need 2,000 duvet covers for a hotel.";
    const ex = extractRfqHeuristic(msg, { productKeywords: withFacts.businessProfile.productKeywords });
    const s = scoreOpportunity({ fields: ex.fields, research: classifyInquiry({ name: "A", email: "a@hotelco.ca", company: "HotelCo", message: msg }), message: msg, policy: withFacts });
    assert.equal(s.outOfRange, false);
    assert.equal(s.dimensions.find((d) => d.key === "productFit")!.score, Math.round(withFacts.scoring.weights.productFit * 0.5));
  });

  await ok("样品说明含天数：作为获准原句写入，守卫通过；润色不得改动", async () => {
    const pol = mergeRevenueSpinePolicy(withFacts, {
      businessProfile: { samplePolicy: { available: true, note: "Stock samples are dispatched within 3 days; custom samples take 10–15 days after the specification is confirmed." } },
    });
    const base = draftBase(pol);
    const d = buildReplyDraft({ ...base, fields: { ...base.fields, sampleRequired: true } });
    const sampleLine = "Regarding samples: Stock samples are dispatched within 3 days; custom samples take 10–15 days after the specification is confirmed.";
    assert.ok(d.body.includes(sampleLine));
    assert.equal(d.body.split(sampleLine).length - 1, 1, "sample line appears exactly once");
    assert.ok((d.referenceLines ?? []).includes(sampleLine));
    assert.equal(d.guardrailViolations.length, 0);
    const changed = await polishReplyDraftWithLlm(d, { orgId: "o", userId: "u", complete: async (b) => b.replace("10–15 days", "5 days") });
    assert.equal(changed.body, d.body);
  });

  await ok("润色稿不过守卫时回退模板原样：模板自身的守卫结果不被清零", async () => {
    const d = buildReplyDraft(draftBase(plain));
    const flagged = { ...d, guardrailViolations: ["示例违规"] };
    const r = await polishReplyDraftWithLlm(flagged, { orgId: "o", userId: "u", complete: async (b) => `${b}\nOur MOQ is 300 pcs.` });
    assert.deepEqual(r.guardrailViolations, ["示例违规"]);
    assert.equal(r.body, d.body);
  });

  await ok("对外英文公司名：英文草稿主题 / 正文 / 落款用它，中文草稿仍用组织名；未配置时用组织名", () => {
    const pol = mergeRevenueSpinePolicy(withFacts, { businessProfile: { commercialFacts: { buyerFacingName: "Example Textiles Co." } } });
    const en = buildReplyDraft({ ...draftBase(pol), orgName: "示例家纺" });
    assert.match(en.subject, /— Example Textiles Co\.$/);
    assert.match(en.body, /Thank you for contacting Example Textiles Co\./);
    assert.match(en.body, /\nExample Textiles Co\.\nWhatsApp/);
    assert.doesNotMatch(en.body, /示例家纺/);
    const zh = buildReplyDraft({ ...draftBase(pol, "zh"), orgName: "示例家纺" });
    assert.match(zh.body, /示例家纺/);
    const plainEn = buildReplyDraft({ ...draftBase(withFacts), orgName: "示例家纺" });
    assert.match(plainEn.body, /Thank you for contacting 示例家纺/);
    const f = buildNoReplyFollowUpDraft({
      step: 1, total: 2, language: "en", contactName: "Emma", orgName: "示例家纺", senderName: "Lily",
      previousSubject: null, previousSentAt: new Date("2026-10-01T00:00:00Z"), product: null, event: null, questions: [],
      buyerFacingName: "Example Textiles Co.",
    });
    assert.match(f.subject, /Example Textiles Co\.$/);
    assert.doesNotMatch(f.body, /示例家纺/);
  });

  await ok("只剩一项待确认时用单数（this / 不写「以上均」）", () => {
    const d = buildReplyDraft(draftBase(withFacts));
    assert.match(d.body, /Regarding pricing: our team will confirm this internally/);
    const zh = buildReplyDraft({ ...draftBase(withFacts, "zh"), orgName: "示例家纺" });
    assert.match(zh.body, /关于价格：需内部确认/);
    const many = buildReplyDraft(draftBase(plain));
    assert.match(many.body, /our team will confirm these internally/);
  });

  await ok("抽取片段在长句里不截在半个从句（退到逗号，去掉悬空的 and）", () => {
    const msg = "We need 3,000 coral fleece bathrobes with shawl collar and our logo embroidered on the chest, sizes S-XL, white and grey, for hotel clients.";
    const ex = extractRfqHeuristic(msg, { productKeywords: withFacts.businessProfile.productKeywords });
    const c = ex.fields.customization ?? "";
    assert.ok(c.length > 0, "customization extracted");
    assert.doesNotMatch(c, /\b(and|or|with)$/i);
    assert.doesNotMatch(c, /,$/);
  });

  await ok("表单标注行进草稿：数量照买家原话带千分位，只给月份的交期写成月底，待确认事项用 and 连接", () => {
    const msg = [
      "Notes: please quote OEKO-TEX certified blankets.",
      "— Form details —",
      "Estimated quantity: 3,000 pcs per colour, 2 colours",
      "Buyer type: Retail & Private Label",
      "Material: flannel fleece with sherpa back",
      "Branding: care label in EN/FR",
      "Packaging: polybag + belly band",
      "Required date: March 2027",
    ].join("\n");
    const ex = extractRfqHeuristic(msg, { productKeywords: withFacts.businessProfile.productKeywords });
    const base = draftBase(withFacts);
    const d = buildReplyDraft({ ...base, fields: ex.fields, knowledge: knowledgeFor(withFacts, ex.fields.productCategory) });
    assert.match(d.body, /- Quantity: 3000 pcs per colour\n/);
    assert.match(d.subject, /\(3000 pcs per colour\)/);
    assert.match(d.body, /- Material: flannel fleece with sherpa back\n/);
    assert.match(d.body, /- Customization: care label in EN\/FR\n/, "买家类型选项不当定制，用 Branding 答案");
    assert.match(d.body, /- Packaging: polybag \+ belly band\n/, "买家类型选项不当包装，用 Packaging 答案");
    assert.match(d.body, /- Required delivery date: end of March 2027 \(2027-03-31\)\n/);
    assert.match(d.body, /Regarding pricing and certification: our team will confirm these internally/);
    const zh = buildReplyDraft({ ...base, language: "zh", fields: ex.fields, knowledge: knowledgeFor(withFacts, ex.fields.productCategory) });
    assert.match(zh.body, /2027年3月底（2027-03-31）/);
    assert.match(zh.subject, /（3000 pcs per colour）/, "中文主题里数字和英文单位之间留空格");
    assert.equal(d.guardrailViolations.length, 0, d.guardrailViolations.join("; "));
  });

  await ok("主题里的数量只用过了护栏的确认事实：单位里夹着折扣字样时主题不写数量，草稿不被拦", () => {
    const base = draftBase(withFacts);
    const fields = { ...base.fields, quantity: 5000, unit: "pcs if you give 10% discount" };
    const d = buildReplyDraft({ ...base, fields });
    assert.doesNotMatch(d.subject, /discount|5000/);
    assert.doesNotMatch(d.body, /discount/);
    assert.equal(d.guardrailViolations.length, 0, d.guardrailViolations.join("; "));
  });

  console.log(`  ${pass} passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
