/** 与 generate-pdf 路由 ALLOWED 保持同步 */

export const PROJECT_PDF_DOC_TYPES = [
  "china_supplier_brief",
  "supplier_rfq",
  "internal_analysis",
  "teammate_tasks",
  "tech_confirm",
  "owner_clarification",
  "bid_draft",
] as const;

export type ProjectPdfDocType = (typeof PROJECT_PDF_DOC_TYPES)[number];

export function isProjectPdfDocType(v: string): v is ProjectPdfDocType {
  return (PROJECT_PDF_DOC_TYPES as readonly string[]).includes(v);
}
