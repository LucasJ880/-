/**
 * Requirement Snapshot（B.1 §10）
 *
 * Run 创建时把 canonical requirements 按值冻结进 SupplierSearchRun.requirementSnapshotJson。
 * 快照必须保留 mandatory 的三值语义 true | false | "uncertain"（V2 层口径）——
 * 不得只读 TenderExtractedRequirement.mandatory Boolean（"uncertain" 落库时会塌缩成 false，
 * PART A 审计已证实）。Gate 侧对 uncertain 按 fail-closed 处理：视同 mandatory，
 * 呈现「疑似强制，待澄清」，绝不静默当作 optional。
 */

import { SUPPLIER_INTEL_LIMITS } from "./constants";
import { SupplierIntelError } from "./errors";

export type MandatorySnapshotValue = true | false | "uncertain";

export interface RequirementSnapshotEntry {
  /** canonical requirement id（或稳定 code） */
  id: string;
  /** Run 内引用键（SupplierRequirementMatch.requirementKey 对齐此值） */
  code: string;
  text: string;
  category: string | null;
  mandatory: MandatorySnapshotValue;
  /** 触发原文短语（如 "must" / "will be rejected"），无则 null */
  mandatorySignal: string | null;
}

function isMandatoryValue(v: unknown): v is MandatorySnapshotValue {
  return v === true || v === false || v === "uncertain";
}

/**
 * 校验并归一 requirement 快照条目。fail-closed：
 * 形状不对 / mandatory 出现三值之外的任何东西（含字符串 "true"/"false"）一律拒收。
 */
export function validateRequirementSnapshot(entries: unknown): RequirementSnapshotEntry[] {
  if (!Array.isArray(entries)) {
    throw new SupplierIntelError("INVALID_REQUIREMENT_SNAPSHOT", "requirement 快照必须是数组");
  }
  if (entries.length > SUPPLIER_INTEL_LIMITS.REQUIREMENT_SNAPSHOT_MAX_ENTRIES) {
    throw new SupplierIntelError(
      "INVALID_REQUIREMENT_SNAPSHOT",
      `requirement 快照超出上限 ${SUPPLIER_INTEL_LIMITS.REQUIREMENT_SNAPSHOT_MAX_ENTRIES} 条`,
    );
  }
  const seen = new Set<string>();
  return entries.map((raw, i) => {
    const e = raw as Record<string, unknown>;
    const id = typeof e?.id === "string" ? e.id.trim() : "";
    const code = typeof e?.code === "string" ? e.code.trim() : "";
    const text = typeof e?.text === "string" ? e.text.trim() : "";
    if (!id || !code || !text) {
      throw new SupplierIntelError(
        "INVALID_REQUIREMENT_SNAPSHOT",
        `第 ${i + 1} 条 requirement 缺少 id/code/text`,
      );
    }
    if (seen.has(code)) {
      throw new SupplierIntelError(
        "INVALID_REQUIREMENT_SNAPSHOT",
        `requirement code 重复：${code}`,
      );
    }
    seen.add(code);
    if (!isMandatoryValue(e.mandatory)) {
      throw new SupplierIntelError(
        "INVALID_REQUIREMENT_SNAPSHOT",
        `第 ${i + 1} 条 requirement 的 mandatory 必须是 true | false | "uncertain"（收到 ${JSON.stringify(e.mandatory)}）`,
      );
    }
    return {
      id,
      code,
      text,
      category: typeof e.category === "string" && e.category.trim() ? e.category.trim() : null,
      mandatory: e.mandatory,
      mandatorySignal:
        typeof e.mandatorySignal === "string" && e.mandatorySignal.trim()
          ? e.mandatorySignal.trim().slice(0, SUPPLIER_INTEL_LIMITS.SHORT_TEXT_MAX_LENGTH)
          : null,
    };
  });
}

/** Gate 口径：uncertain 视同 mandatory（fail-closed，不得当 optional） */
export function isRequirementMandatoryForGate(entry: RequirementSnapshotEntry): boolean {
  return entry.mandatory === true || entry.mandatory === "uncertain";
}

/**
 * Match 行落库口径：uncertain → { mandatory: true, mandatoryUncertain: true }
 * （行为 fail-closed 折入 mandatory，同时保留 uncertain 溯源标记；快照本身保留原始三值）。
 */
export function collapseMandatoryForMatch(entry: RequirementSnapshotEntry): {
  mandatory: boolean;
  mandatoryUncertain: boolean;
} {
  if (entry.mandatory === "uncertain") return { mandatory: true, mandatoryUncertain: true };
  return { mandatory: entry.mandatory, mandatoryUncertain: false };
}

/** 从已校验快照建 code → entry 索引（Match 创建时校验 requirementKey 归属） */
export function indexRequirementSnapshot(
  entries: RequirementSnapshotEntry[],
): Map<string, RequirementSnapshotEntry> {
  return new Map(entries.map((e) => [e.code, e]));
}
