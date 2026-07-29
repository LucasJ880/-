/**
 * 可解释合并：禁止不可追踪的浅合并
 */

import type { MergeMode } from "./types";

export function defaultMergeMode(field: string): MergeMode {
  if (
    field === "targetAudienceJson" ||
    field === "contentPillarsJson" ||
    field === "forbiddenTopicsJson" ||
    field === "exampleContentJson" ||
    field === "contentMixJson"
  ) {
    return "replace";
  }
  if (field === "kpiTargetsJson" || field === "visualStyleJson" || field === "postingRulesJson") {
    return "merge-by-key";
  }
  if (field === "ctaStrategyJson" || field === "conversionPathJson") {
    return "replace";
  }
  return "replace";
}

export function mergeField(input: {
  base: unknown;
  override: unknown;
  mode: MergeMode;
}): unknown {
  if (input.mode === "disabled") return input.base;
  if (input.override == null) return input.base;
  if (input.mode === "replace") return input.override;

  if (input.mode === "append") {
    const a = Array.isArray(input.base) ? input.base : input.base == null ? [] : [input.base];
    const b = Array.isArray(input.override)
      ? input.override
      : [input.override];
    return [...a, ...b];
  }

  if (input.mode === "merge-by-key") {
    const baseObj =
      input.base && typeof input.base === "object" && !Array.isArray(input.base)
        ? { ...(input.base as Record<string, unknown>) }
        : {};
    const overObj =
      input.override &&
      typeof input.override === "object" &&
      !Array.isArray(input.override)
        ? (input.override as Record<string, unknown>)
        : {};
    return { ...baseObj, ...overObj };
  }

  return input.override;
}

export function readOverrides(
  overridesJson: unknown,
): Record<string, MergeMode> {
  if (!overridesJson || typeof overridesJson !== "object") return {};
  const out: Record<string, MergeMode> = {};
  for (const [k, v] of Object.entries(overridesJson as Record<string, unknown>)) {
    if (
      v === "replace" ||
      v === "append" ||
      v === "merge-by-key" ||
      v === "disabled"
    ) {
      out[k] = v;
    }
  }
  return out;
}
