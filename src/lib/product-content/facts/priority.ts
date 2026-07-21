import type { FactSourceType } from "@/lib/product-content/types";

/** 来源优先级：索引越小优先级越高 */
export const SOURCE_PRIORITY: readonly FactSourceType[] = [
  "confirmed_human",
  "approved_product",
  "user_statement",
  "supplier_spec",
  "excel",
  "pdf",
  "website",
  "voice_transcript",
  "image_heuristic",
  "competitor",
  "ai_inference",
] as const;

const PRIORITY_INDEX = new Map<FactSourceType, number>(
  SOURCE_PRIORITY.map((s, i) => [s, i]),
);

export function getSourcePriority(sourceType: string): number {
  return PRIORITY_INDEX.get(sourceType as FactSourceType) ?? SOURCE_PRIORITY.length;
}

export function compareSourcePriority(a: string, b: string): number {
  return getSourcePriority(a) - getSourcePriority(b);
}

/** 是否可自动确认为 confirmed 状态 */
export function canAutoConfirm(sourceType: string): boolean {
  return (
    sourceType !== "ai_inference" &&
    sourceType !== "competitor" &&
    compareSourcePriority(sourceType, "ai_inference") < 0
  );
}
