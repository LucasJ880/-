/**
 * Trade Intelligence — MVP JSON 形状（与 intelligence-service 一致）
 */

export type IntelligenceEvidenceType =
  | "product_page"
  | "upc_match"
  | "mpn_match"
  | "brand_match"
  | "address_match"
  | "search_result"
  | "customs_hint"
  | "manual";

export interface IntelligenceEvidenceItem {
  type: IntelligenceEvidenceType;
  title: string;
  url: string;
  snippet: string;
  matchedFields: string[];
}

export type IntelligenceCandidateRole =
  | "retailer"
  | "buyer"
  | "importer"
  | "distributor"
  | "brand_owner"
  | "supplier"
  | "marketplace"
  | "unknown";

export interface IntelligenceCandidateEvidence {
  type: IntelligenceEvidenceType;
  title: string;
  url: string;
  snippet: string;
  matchedFields: string[];
}

export interface IntelligenceCandidate {
  name: string;
  role: IntelligenceCandidateRole;
  website: string | null;
  country: string | null;
  confidence: number;
  evidence: IntelligenceCandidateEvidence[];
  reason: string;
  riskFlags: string[];
  nextVerificationStep: string;
}

export type IntelligenceContactType =
  | "supplier_portal"
  | "contact_page"
  | "linkedin_search"
  | "buyer_role_search"
  | "general_email"
  | "phone"
  | "unknown";

export interface IntelligenceContactCandidate {
  companyName: string;
  contactType: IntelligenceContactType;
  url: string;
  label: string;
  confidence: number;
  reason: string;
}

/** POST /api/trade/intelligence/[id]/convert-to-prospect 请求体 */
export type ConvertIntelligenceBody = {
  orgId?: string;
  candidateRole: "buyer" | "retailer" | "importer" | "distributor";
  candidateIndex: number;
  createCampaignId?: string | null;
};
