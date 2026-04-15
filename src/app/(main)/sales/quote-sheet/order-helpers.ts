/**
 * Shared utilities for order form components (shades, shutters, drapes).
 */

// ── Row manipulation ──

export function updateLineField<T extends { id: string }>(
  lines: T[],
  id: string,
  field: keyof T,
  value: unknown,
): T[] {
  return lines.map((l) => (l.id === id ? { ...l, [field]: value } : l));
}

export function removeLineById<T extends { id: string }>(
  lines: T[],
  id: string,
  minCount = 1,
): T[] {
  if (lines.length <= minCount) return lines;
  return lines.filter((l) => l.id !== id);
}

// ── Shared constants ──

export const SIGNATURE_DISCLAIMER =
  "All above designs are clearly explained by our sales representative. I have read and acknowledged the Sunny Shutter Inc Policy & I agree to the terms and conditions set forth by Sunny Shutter Inc.";
