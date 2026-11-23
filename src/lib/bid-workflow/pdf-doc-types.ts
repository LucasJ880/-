/** 与 generate-pdf 路由 ALLOWED 保持同步 */

export const PROJECT_PDF_DOC_TYPES = [
  "analyst_memo",
  "supplier_rfq",
  "internal_analysis",
  "teammate_tasks",
  "owner_clarification",
  "bid_draft",
] as const;

export type ProjectPdfDocType = (typeof PROJECT_PDF_DOC_TYPES)[number];

export function isProjectPdfDocType(v: string): v is ProjectPdfDocType {
  return (PROJECT_PDF_DOC_TYPES as readonly string[]).includes(v);
}

/**
 * RFQ-PDF-1：已停止生成的两类供应商文件（类型 → 名称）。之前生成的文件与记录保留，列表里照常打开、下载；
 * 只是不能再生成新的——发给供应商的文件收口到「供应商询价单 PDF」（supplier_rfq）。
 */
export const RETIRED_PROJECT_PDF_DOC_TYPES: Readonly<Record<string, string>> = {
  tech_confirm: "供应商技术确认表",
  china_supplier_brief: "国内供应商简报",
};

/** 已停用类型的说明；不是已停用类型时返回 null */
export function retiredDocTypeMessageZh(docType: string): string | null {
  const name = Object.prototype.hasOwnProperty.call(RETIRED_PROJECT_PDF_DOC_TYPES, docType) ? RETIRED_PROJECT_PDF_DOC_TYPES[docType] : null;
  return name ? `「${name}」已停用，请改用「供应商询价单 PDF」。之前生成的文件仍可在列表里打开、下载。` : null;
}
