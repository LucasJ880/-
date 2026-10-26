/**
 * FDE 首封回复草稿金样本输入（B-3，openspec change fde-preferences-in-draft）。
 *
 * 用途：证明草稿偏好开关关闭时，草稿主题 / 正文 / 追问字段与 B-3 实施前逐字节一致。
 * draft-golden-pre-b3.json 是用 B-3 改动之前的代码、对这里每个用例跑 renderGoldenCase 生成的，只生成一次：
 *   npx tsx -e 'import("./src/lib/revenue-spine/__tests__/fixtures/draft-golden-cases").then((m) => m.writeGolden())'
 * 默认模板以后有意改动时才重新生成，并在 PR 里说明。
 *
 * 公开仓库：只用虚构企业、人名与域名。输入全部手写，不依赖 RFQ 抽取器（抽取器改动不该让金样本失效）。
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { getCertification, getCostBasis, getLeadTime, getMOQ, getProductCapability, getSamplePolicy, type FactoryKnowledgeBundle } from "../../factory-knowledge";
import { DEFAULT_REVENUE_SPINE_POLICY, mergeRevenueSpinePolicy, type RevenueSpinePolicy } from "../../policy";
import { buildReplyDraft, type ReplyDraftInput } from "../../reply-draft";
import { buildClarifyingQuestions, computeMissingFields } from "../../rfq/missing-info";
import type { RfqFields } from "../../rfq/types";

export const GOLDEN_FILE = join(__dirname, "draft-golden-pre-b3.json");

const EMPTY_FIELDS: RfqFields = {
  productCategory: null,
  productName: null,
  material: null,
  composition: null,
  size: null,
  quantity: null,
  unit: null,
  color: null,
  customLogo: null,
  customization: null,
  packaging: null,
  certification: null,
  sampleRequired: null,
  targetPrice: null,
  currency: null,
  destinationCountry: null,
  destinationCity: null,
  incoterm: null,
  requiredDeliveryDate: null,
  buyerType: null,
  application: null,
};

/** 配满商务事实的企业（虚构） */
export const CONFIGURED_POLICY: RevenueSpinePolicy = mergeRevenueSpinePolicy(DEFAULT_REVENUE_SPINE_POLICY, {
  followUp: { maxQuestionsPerReply: 4 },
  businessProfile: {
    productCategories: ["bathrobe", "blanket", "curtain"],
    samplePolicy: { available: true, note: "We can send stock samples within 3 days; custom samples take 7-10 days." },
    commercialFacts: {
      moq: { quantity: 500, unit: "pcs", per: "color" },
      productionLeadTime: { daysMin: 35, daysMax: 45, startsFrom: "pre-production sample approval" },
      loadingPorts: ["Ningbo", "Shanghai"],
      signature: { title: "Sales Manager", whatsapp: "+86 138 0013 8000", website: "www.example-home.example" },
      buyerFacingName: "Example Home Textile",
      gradeCCatalogOnly: true,
      catalogUrl: "https://www.example-home.example/catalog",
      referencePrograms: [
        {
          category: "bathrobe",
          summaryEn: "We have produced hotel bathrobes for a Canadian hotel group.",
          summaryZh: "我们为一家加拿大酒店集团做过酒店浴袍。",
          disclosure: "anonymized",
        },
      ],
    },
  },
});

export function knowledgeFor(policy: RevenueSpinePolicy, category: string | null): FactoryKnowledgeBundle {
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

export interface GoldenCase {
  id: string;
  /** 不含 questions：questions 由 missing 与 policy 生成（偏好接入后由调用方传偏好） */
  input: Omit<ReplyDraftInput, "questions">;
}

const bathrobeFields: RfqFields = {
  ...EMPTY_FIELDS,
  productCategory: "bathrobe",
  productName: "hotel bathrobes",
  material: "cotton terry",
  quantity: 3000,
  unit: "pcs",
  destinationCountry: "Canada",
  sampleRequired: true,
};

const curtainFields: RfqFields = {
  ...EMPTY_FIELDS,
  productCategory: "curtain",
  productName: "blackout curtains",
  quantity: 1200,
  unit: "panels",
  color: "grey",
  requiredDeliveryDate: new Date("2027-03-31T00:00:00Z"),
};

export function goldenCases(): GoldenCase[] {
  const base = {
    orgName: "示例家纺",
    senderName: "Lucy",
    inquirySubject: null,
  };
  return [
    {
      id: "en-website-contact-default-policy",
      input: { ...base, language: "en", contactName: "Mark", companyName: "Northwind Hotels", fields: bathrobeFields, knowledge: knowledgeFor(DEFAULT_REVENUE_SPINE_POLICY, "bathrobe"), policy: DEFAULT_REVENUE_SPINE_POLICY },
    },
    {
      id: "en-website-no-contact-default-policy",
      input: { ...base, language: "en", contactName: null, companyName: null, fields: curtainFields, knowledge: knowledgeFor(DEFAULT_REVENUE_SPINE_POLICY, "curtain"), policy: DEFAULT_REVENUE_SPINE_POLICY },
    },
    {
      id: "zh-website-contact-default-policy",
      input: { ...base, language: "zh", contactName: "王先生", companyName: "北风酒店", fields: bathrobeFields, knowledge: knowledgeFor(DEFAULT_REVENUE_SPINE_POLICY, "bathrobe"), policy: DEFAULT_REVENUE_SPINE_POLICY },
    },
    {
      id: "zh-website-no-contact-default-policy",
      input: { ...base, language: "zh", contactName: null, companyName: null, fields: curtainFields, knowledge: knowledgeFor(DEFAULT_REVENUE_SPINE_POLICY, "curtain"), policy: DEFAULT_REVENUE_SPINE_POLICY },
    },
    {
      id: "en-website-configured-facts",
      input: { ...base, language: "en", contactName: "Mark", companyName: "Northwind Hotels", fields: bathrobeFields, knowledge: knowledgeFor(CONFIGURED_POLICY, "bathrobe"), policy: CONFIGURED_POLICY },
    },
    {
      id: "zh-website-configured-facts",
      input: { ...base, language: "zh", contactName: "王先生", companyName: "北风酒店", fields: bathrobeFields, knowledge: knowledgeFor(CONFIGURED_POLICY, "bathrobe"), policy: CONFIGURED_POLICY },
    },
    {
      id: "en-trade-show-styles-configured",
      input: {
        ...base,
        language: "en",
        contactName: "Mark",
        companyName: "Northwind Hotels",
        fields: { ...EMPTY_FIELDS, productCategory: "blanket", quantity: 800, unit: "pcs" },
        knowledge: knowledgeFor(CONFIGURED_POLICY, "blanket"),
        policy: CONFIGURED_POLICY,
        tradeShow: { event: "the Canton Fair (Booth 14.3E07)", styles: [{ code: "BL-2201", name: "Flannel Throw" }, { code: "BL-2207", name: null }] },
        boothGrade: "A",
      },
    },
    {
      id: "zh-trade-show-event-only-default",
      input: {
        ...base,
        language: "zh",
        contactName: "王先生",
        companyName: null,
        fields: curtainFields,
        knowledge: knowledgeFor(DEFAULT_REVENUE_SPINE_POLICY, "curtain"),
        policy: DEFAULT_REVENUE_SPINE_POLICY,
        tradeShow: { event: "广交会", styles: [] },
        boothGrade: "B",
      },
    },
    {
      id: "en-trade-show-grade-c-catalog-only",
      input: {
        ...base,
        language: "en",
        contactName: "Mark",
        companyName: null,
        fields: { ...EMPTY_FIELDS, productCategory: "blanket" },
        knowledge: knowledgeFor(CONFIGURED_POLICY, "blanket"),
        policy: CONFIGURED_POLICY,
        tradeShow: { event: "Heimtextil", styles: [{ code: "BL-2201", name: "Flannel Throw" }] },
        boothGrade: "C",
      },
    },
    {
      id: "zh-trade-show-grade-c-catalog-only",
      input: {
        ...base,
        language: "zh",
        contactName: null,
        companyName: null,
        fields: { ...EMPTY_FIELDS, productCategory: "blanket" },
        knowledge: knowledgeFor(CONFIGURED_POLICY, "blanket"),
        policy: CONFIGURED_POLICY,
        tradeShow: { event: "Heimtextil", styles: [] },
        boothGrade: "C",
      },
    },
  ];
}

export interface GoldenDraft {
  id: string;
  subject: string;
  body: string;
  questionFields: string[];
}

/** 实施前的调用方式：追问按缺失字段与上限生成，不传任何偏好 */
export function renderGoldenCase(c: GoldenCase): GoldenDraft {
  const lang = c.input.language === "zh" ? "zh" : "en";
  const questions = buildClarifyingQuestions(computeMissingFields(c.input.fields), lang, c.input.policy.followUp.maxQuestionsPerReply);
  const d = buildReplyDraft({ ...c.input, questions });
  return { id: c.id, subject: d.subject, body: d.body, questionFields: questions.map((q) => q.field) };
}

export function writeGolden(): void {
  writeFileSync(GOLDEN_FILE, `${JSON.stringify(goldenCases().map(renderGoldenCase), null, 2)}\n`);
}
