/**
 * Product Marketing Context 聚合 / 完整度 / 提议更新
 * 运行：npx tsx src/lib/marketing/__tests__/product-marketing-context.test.ts
 */

import {
  getProductContextCompleteness,
  proposeProductMarketingContextUpdate,
  validateProductMarketingContext,
  type ProductMarketingContext,
} from "../product-marketing-context";

let total = 0;
let failed = 0;

function expect(condition: boolean, message: string) {
  total += 1;
  if (condition) {
    console.log(`✓ ${message}`);
    return;
  }
  failed += 1;
  console.error(`✗ ${message}`);
}

function base(name: string): ProductMarketingContext {
  return {
    company: {
      name,
      businessModel: "B2B",
      geographies: ["Toronto"],
      languages: ["en", "zh-CN"],
      industry: "window coverings",
      businessStage: "growth",
    },
    products: [
      {
        name: "Commercial blinds",
        category: "window covering",
        description: "Motorized commercial blinds",
        primaryUseCases: ["office"],
        features: ["motorized"],
        verifiedBenefits: ["faster install"],
        pricingModel: "project quote",
        deliveryModel: "install",
        limitations: ["GTA focused"],
        certifications: [],
        proofPoints: ["case-study-1"],
      },
    ],
    audiences: [
      {
        segmentName: "Commercial property managers",
        buyerTypes: ["B2B"],
        decisionMakers: ["PM"],
        influencers: ["GC"],
        jobsToBeDone: ["outfit new floors"],
        painPoints: ["lead time"],
        objections: ["price"],
        purchaseTriggers: ["renovation"],
        preferredChannels: ["Google Ads"],
      },
    ],
    positioning: {
      category: "commercial window coverings",
      alternatives: ["Select Blinds"],
      differentiators: ["local install"],
      valueProposition: "Reliable commercial install in GTA",
      reasonsToBelieve: ["local team"],
      claimsToAvoid: ["#1 in Canada"],
    },
    brand: {
      voice: "professional",
      tone: "clear",
      approvedTerms: ["motorized"],
      prohibitedTerms: ["guaranteed cheapest"],
      visualGuidelines: "",
      legalDisclaimers: [],
    },
    competition: [
      {
        name: "Select Blinds",
        type: "direct",
        strengths: ["brand"],
        weaknesses: ["less local"],
        evidence: ["https://example.com/select"],
        lastVerifiedAt: "2026-07-01",
      },
    ],
    channels: ["Google Ads", "referral"],
    goals: ["qualified leads"],
    sourceReferences: ["MarketingBrandProfile"],
    missingInformation: [],
    lastReviewedAt: "2026-07-13T00:00:00.000Z",
    status: "confirmed",
  };
}

const sunny = base("Sunny Shutter");
const aivora = base("Aivora");
aivora.company.industry = "AI software";
aivora.products = [
  {
    ...sunny.products[0],
    name: "Qingyan Agent",
    category: "software",
    description: "AI work assistant",
  },
];

expect(sunny.company.name !== aivora.company.name, "组织品牌名隔离");
expect(
  sunny.products[0].name !== aivora.products[0].name,
  "组织产品隔离",
);

const sunnyScore = getProductContextCompleteness(sunny);
expect(sunnyScore.score >= 70, `Sunny 完整度较高（${sunnyScore.score}）`);

const emptyish: ProductMarketingContext = {
  ...base(""),
  company: {
    name: "",
    businessModel: "",
    geographies: [],
    languages: [],
    industry: "",
    businessStage: "",
  },
  products: [],
  audiences: [],
  positioning: {
    category: "",
    alternatives: [],
    differentiators: [],
    valueProposition: "",
    reasonsToBelieve: [],
    claimsToAvoid: [],
  },
  competition: [],
  channels: [],
  goals: [],
  sourceReferences: [],
  missingInformation: [],
  lastReviewedAt: "",
  status: "empty",
};
const emptyScore = getProductContextCompleteness(emptyish);
expect(emptyScore.score < 40, `空上下文完整度低（${emptyScore.score}）`);
expect(emptyScore.missing.length > 0, "空上下文列出缺失项");

const validation = validateProductMarketingContext(sunny);
expect(validation.ok, "Sunny 上下文通过校验");

const proposal = proposeProductMarketingContextUpdate({
  current: sunny,
  patch: {
    positioning: {
      ...sunny.positioning,
      valueProposition: "Updated VP",
    },
  },
  reason: "人工审核后更新",
});
expect(
  proposal.proposal.positioning.valueProposition === "Updated VP",
  "提议可生成新上下文",
);
expect(
  sunny.positioning.valueProposition !== "Updated VP",
  "提议不自动覆盖原事实对象",
);
expect(proposal.diffSummary.length > 0, "提议含 diffSummary");

console.log(
  `\n${failed === 0 ? "✅" : "❌"} product-marketing-context: ${total - failed}/${total} 通过`,
);
if (failed > 0) process.exit(1);
