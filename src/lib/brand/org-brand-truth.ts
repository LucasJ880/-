/**
 * Phase 2B：统一 Brand Truth 读取入口
 *
 * 事实主源：MarketingBrandProfile
 * 语料视图：BrandProfile
 * 禁止：把 BrandProfile 当事实；禁止跨 org 回退
 */

import { db } from "@/lib/db";

export type OrgBrandTruthStatus = "ok" | "facts_missing" | "voice_only" | "missing";

export type OrgBrandTruth = {
  orgId: string;
  status: OrgBrandTruthStatus;
  source: {
    facts: "MarketingBrandProfile" | null;
    voice: "BrandProfile" | null;
  };
  facts: {
    legalName: string | null;
    brandName: string | null;
    website: string | null;
    phone: string | null;
    addressLine: string | null;
    city: string | null;
    region: string | null;
    country: string | null;
    timezone: string | null;
    industry: string | null;
    products: unknown;
    serviceAreas: unknown;
    targetAudiences: unknown;
    forbiddenContexts: unknown;
    validationStatus: string | null;
  } | null;
  voice: {
    brandName: string | null;
    tagline: string | null;
    positioning: string | null;
    sellingPoints: string | null;
    toneOfVoice: string | null;
    forbiddenClaims: string | null;
  } | null;
  /** 对外展示名：事实 brandName → 语料 brandName → Organization.name */
  displayBrandName: string | null;
};

export async function getOrgBrandTruth(orgId: string): Promise<OrgBrandTruth> {
  const [org, facts, voice] = await Promise.all([
    db.organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true },
    }),
    db.marketingBrandProfile.findUnique({ where: { orgId } }),
    db.brandProfile.findUnique({ where: { orgId } }),
  ]);

  if (!org) {
    return {
      orgId,
      status: "missing",
      source: { facts: null, voice: null },
      facts: null,
      voice: null,
      displayBrandName: null,
    };
  }

  const factsView = facts
    ? {
        legalName: facts.legalName,
        brandName: facts.brandName,
        website: facts.website,
        phone: facts.phone,
        addressLine: facts.addressLine,
        city: facts.city,
        region: facts.region,
        country: facts.country,
        timezone: facts.timezone,
        industry: facts.industry,
        products: facts.productsJson,
        serviceAreas: facts.serviceAreasJson,
        targetAudiences: facts.targetAudiencesJson,
        forbiddenContexts: facts.forbiddenContextsJson,
        validationStatus: facts.validationStatus,
      }
    : null;

  const voiceView = voice
    ? {
        brandName: voice.brandName,
        tagline: voice.tagline,
        positioning: voice.positioning,
        sellingPoints: voice.sellingPoints,
        toneOfVoice: voice.toneOfVoice,
        forbiddenClaims: voice.forbiddenClaims,
      }
    : null;

  let status: OrgBrandTruthStatus = "missing";
  if (factsView && voiceView) status = "ok";
  else if (factsView) status = "ok";
  else if (voiceView) status = "voice_only";
  else status = "facts_missing";

  return {
    orgId,
    status,
    source: {
      facts: facts ? "MarketingBrandProfile" : null,
      voice: voice ? "BrandProfile" : null,
    },
    facts: factsView,
    voice: voiceView,
    displayBrandName:
      factsView?.brandName || voiceView?.brandName || org.name || null,
  };
}
