/**
 * Revenue Spine — Inbound FDE Step 1：识别 company / contact / country / industry / buyer type
 * 确定性分类（邮箱域名、电话国码、文本词表）；LLM 仅可选补充，不在此文件。
 */

import { detectBuyerType, detectCountries, countryFromPhone, countryFromTld, APPLICATION_RULES } from "./lexicon";
import { detectLanguage, emailDomain, isFreeMailDomain, normalizeCompanyName, websiteHost, type InquiryLanguage } from "./normalize";

export interface ClassifyInput {
  name?: string | null;
  email?: string | null;
  company?: string | null;
  phone?: string | null;
  country?: string | null;
  website?: string | null;
  message: string;
}

export interface InquiryResearch {
  companyName: string | null;
  contactName: string | null;
  country: string | null;
  countrySource: "form" | "message" | "phone" | "domain" | null;
  industry: string | null;
  buyerType: string;
  buyerTypeConfidence: number;
  emailDomain: string | null;
  isFreeMail: boolean;
  website: string | null;
  language: InquiryLanguage;
  /** 可解释信号（写入 AgentRun 事件 / SalesAction.inputContext） */
  signals: string[];
}

const INDUSTRY_RULES: Array<{ key: string; keywords: string[] }> = [
  { key: "hospitality", keywords: ["hotel", "resort", "hospitality", "spa", "酒店", "民宿"] },
  { key: "healthcare", keywords: ["hospital", "clinic", "medical", "nursing", "医院", "医疗", "养老"] },
  { key: "retail", keywords: ["retail", "store", "boutique", "零售", "门店"] },
  { key: "ecommerce", keywords: ["amazon", "ecommerce", "e-commerce", "online", "电商", "跨境"] },
  { key: "home_textile", keywords: ["home textile", "linen", "bedding", "textile", "家纺", "纺织"] },
  { key: "construction", keywords: ["contractor", "construction", "fit-out", "interior", "装修", "工程"] },
  { key: "promotional", keywords: ["promotional", "corporate gift", "礼品"] },
];

export function classifyInquiry(input: ClassifyInput): InquiryResearch {
  const text = [input.company, input.message].filter(Boolean).join("\n");
  const lower = text.toLowerCase();
  const signals: string[] = [];
  const domain = emailDomain(input.email);
  const freeMail = isFreeMailDomain(domain);
  if (domain) signals.push(freeMail ? `free mailbox domain ${domain}` : `corporate mailbox domain ${domain}`);

  // company
  let companyName = (input.company ?? "").trim() || null;
  if (!companyName && domain && !freeMail) {
    companyName = domain.split(".")[0];
    signals.push("company inferred from email domain");
  }
  const contactName = (input.name ?? "").trim() || null;

  // country
  let country: string | null = null;
  let countrySource: InquiryResearch["countrySource"] = null;
  const formCountry = (input.country ?? "").trim();
  if (formCountry) {
    const hit = detectCountries(formCountry)[0];
    country = hit?.country ?? formCountry;
    countrySource = "form";
  } else {
    const hits = detectCountries(input.message ?? "");
    if (hits.length) {
      country = hits[0].country;
      countrySource = "message";
    } else {
      const fromPhone = countryFromPhone(input.phone);
      if (fromPhone) {
        country = fromPhone;
        countrySource = "phone";
      } else {
        const fromTld = countryFromTld(domain) ?? countryFromTld(websiteHost(input.website));
        if (fromTld) {
          country = fromTld;
          countrySource = "domain";
        }
      }
    }
  }
  if (country) signals.push(`country ${country} (${countrySource})`);

  // industry / buyer type
  let industry: string | null = null;
  for (const rule of INDUSTRY_RULES) {
    if (rule.keywords.some((k) => lower.includes(k))) {
      industry = rule.key;
      break;
    }
  }
  if (!industry) {
    for (const rule of APPLICATION_RULES) {
      if (rule.keywords.some((k) => lower.includes(k))) {
        industry = rule.key;
        break;
      }
    }
  }
  const buyer = detectBuyerType(text);
  if (buyer.matched) signals.push(`buyer type ${buyer.type} via "${buyer.matched}"`);
  let buyerType = buyer.type;
  let buyerTypeConfidence = buyer.confidence;
  if (buyerType === "unknown" && freeMail && !companyName) {
    buyerType = "individual";
    buyerTypeConfidence = 0.45;
    signals.push("no company + free mailbox → likely individual");
  } else if (buyerType === "unknown" && industry === "hospitality") {
    buyerType = "hotel_group";
    buyerTypeConfidence = 0.5;
    signals.push("hospitality context without explicit buyer type → hotel_group (low confidence)");
  }

  return {
    companyName,
    contactName,
    country,
    countrySource,
    industry,
    buyerType,
    buyerTypeConfidence,
    emailDomain: domain,
    isFreeMail: freeMail,
    website: websiteHost(input.website),
    language: detectLanguage(input.message),
    signals,
  };
}

export function researchDisplayName(r: InquiryResearch): string {
  return r.companyName ?? r.contactName ?? normalizeCompanyName(r.emailDomain) ?? "Unknown";
}
