import { compareSourcePriority } from "@/lib/product-content/facts/priority";

function normalizeForCompare(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim().toLowerCase();
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(normalizeForCompare);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = normalizeForCompare(obj[key]);
    }
    return sorted;
  }
  return value;
}

export function detectConflict(
  currentValue: unknown,
  incomingValue: unknown,
): boolean {
  const a = JSON.stringify(normalizeForCompare(currentValue));
  const b = JSON.stringify(normalizeForCompare(incomingValue));
  return a !== b;
}

export function shouldOverwrite(
  currentSource: string,
  incomingSource: string,
  currentLocked: boolean,
): boolean {
  if (currentLocked) return false;
  if (incomingSource === "ai_inference") return false;
  return compareSourcePriority(incomingSource, currentSource) < 0;
}
