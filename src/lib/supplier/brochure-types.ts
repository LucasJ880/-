// ============================================================
// 供应商画册 PDF 解析 — 类型定义
// ============================================================

export interface BrochureSupplierFields {
  name: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  region: string | null;
  website: string | null;
}

export interface BrochureAnalysis {
  summary: string | null;
  categories: string[];
  mainProducts: string[];
  tags: string[];
  certifications: string[];
  targetMarkets: string[];
  notes: string | null;
}

export type ParseConfidence = "low" | "medium" | "high";
export type ParseStatus = "parsed" | "needs_manual_review" | "failed";

export interface BrochureParseMeta {
  confidence: ParseConfidence;
  missingFields: string[];
  parseStatus: ParseStatus;
  parseWarning: string | null;
}

export interface BrochureParseResult {
  supplier: BrochureSupplierFields;
  analysis: BrochureAnalysis;
  meta: BrochureParseMeta;
}

export interface BrochureParseResponse {
  success: boolean;
  brochureUrl: string | null;
  result: BrochureParseResult | null;
  error?: string;
}

export const MAX_BROCHURE_SIZE = 10 * 1024 * 1024; // 10MB
export const ALLOWED_BROCHURE_TYPE = "application/pdf";
export const TEMP_BLOB_PREFIX = "temp/brochures/";
