/**
 * validateTenderAnalystSynthesis（§26）— 纯函数校验 + 消毒
 *
 * 规则：
 *  - 所有 supporting ID 必须存在于 AnalysisResultV2；
 *  - 关键 item（keyRequirements/technicalRequirements/commercialAndDelivery/
 *    risksAndGaps/clarifications）supportingIds 合计 > 0；
 *  - BID_FATAL：至少关联一条带明确淘汰/不响应措辞的 requirement，或
 *    canonical 投标提交强制项（SUBMISSION/MANDATORY 且 mandatory===true）；
 *    general post-award / contract clause 绝不允许成为 BID_FATAL；
 *  - technicalRequirements：至少关联一条 TECHNICAL/PRODUCT/PERFORMANCE/
 *    INSTALLATION 类 requirement；COMMERCIAL 类不得进入 technical 区；
 *  - 校验失败的 item 被移除（不持久化 unsupported claim），问题写入 issues。
 */

import type { AnalysisResultV2 } from "@/lib/tender-understanding/contract";
import type { AnalystKeyItem, AnalystLlmOutput } from "./contract";

const REJECTION_SIGNAL =
  /reject|non-?responsive|not\s+be\s+considered|disqualif|condition\s+of\s+(the\s+)?bid|will\s+not\s+be\s+accepted|invalidat/i;

const TECHNICAL_CATEGORIES = new Set([
  "TECHNICAL",
  "PRODUCT",
  "PERFORMANCE",
  "INSTALLATION",
]);
const COMMERCIAL_CATEGORIES = new Set(["COMMERCIAL", "PRICING", "REPORTING"]);
const SUBMISSION_MANDATORY_CATEGORIES = new Set(["SUBMISSION", "MANDATORY"]);

export type AnalystValidationResult = {
  ok: boolean;
  issues: string[];
  /** 消毒后的输出（非法 item 已移除 / 降级） */
  sanitized: AnalystLlmOutput;
  removedCount: number;
};

type EntityIndex = {
  requirements: Map<string, AnalysisResultV2["requirements"][number]>;
  facts: Set<string>;
  risks: Set<string>;
  clarifications: Set<string>;
  all: Set<string>;
};

function indexEntities(result: AnalysisResultV2): EntityIndex {
  const requirements = new Map(result.requirements.map((r) => [r.id, r]));
  const facts = new Set(result.facts.map((f) => f.id));
  const risks = new Set(result.risks.map((r) => r.id));
  const clarifications = new Set(result.clarifications.map((c) => c.id));
  const all = new Set<string>([
    ...requirements.keys(),
    ...facts,
    ...risks,
    ...clarifications,
    ...result.conflicts.map((c) => c.id),
    ...result.addendumChanges.map((a) => a.id),
  ]);
  return { requirements, facts, risks, clarifications, all };
}

function supportingIdsOf(item: AnalystKeyItem): string[] {
  return [
    ...item.supportingRequirementIds,
    ...item.supportingFactIds,
    ...item.supportingRiskIds,
  ];
}

/** BID_FATAL 合法性：明确淘汰措辞 或 canonical 投标提交强制项 */
function bidFatalJustified(item: AnalystKeyItem, idx: EntityIndex): boolean {
  for (const rid of item.supportingRequirementIds) {
    const req = idx.requirements.get(rid);
    if (!req) continue;
    const signalText = `${req.mandatorySignal ?? ""} ${req.statement}`;
    if (REJECTION_SIGNAL.test(signalText)) return true;
    if (
      SUBMISSION_MANDATORY_CATEGORIES.has(req.category.toUpperCase()) &&
      req.mandatory === true
    ) {
      return true;
    }
  }
  return false;
}

function technicalJustified(item: AnalystKeyItem, idx: EntityIndex): boolean {
  let hasTechnical = false;
  for (const rid of item.supportingRequirementIds) {
    const req = idx.requirements.get(rid);
    if (!req) continue;
    const cat = req.category.toUpperCase();
    if (TECHNICAL_CATEGORIES.has(cat)) hasTechnical = true;
  }
  return hasTechnical;
}

function onlyCommercialSupport(item: AnalystKeyItem, idx: EntityIndex): boolean {
  let sawAny = false;
  for (const rid of item.supportingRequirementIds) {
    const req = idx.requirements.get(rid);
    if (!req) continue;
    sawAny = true;
    if (!COMMERCIAL_CATEGORIES.has(req.category.toUpperCase())) return false;
  }
  return sawAny;
}

function checkIdsExist(
  ids: string[],
  pool: Set<string>,
  where: string,
  issues: string[],
): string[] {
  const valid: string[] = [];
  for (const id of ids) {
    if (pool.has(id)) valid.push(id);
    else issues.push(`${where}: 引用不存在的实体 ID「${id}」（已剔除）`);
  }
  return valid;
}

export function validateTenderAnalystSynthesis(
  synthesis: AnalystLlmOutput,
  result: AnalysisResultV2,
): AnalystValidationResult {
  const idx = indexEntities(result);
  const issues: string[] = [];
  let removedCount = 0;

  const cleanKeyItem = (
    item: AnalystKeyItem,
    where: string,
  ): AnalystKeyItem | null => {
    const cleaned: AnalystKeyItem = {
      ...item,
      supportingRequirementIds: checkIdsExist(
        item.supportingRequirementIds,
        new Set(idx.requirements.keys()),
        `${where}/${item.id}`,
        issues,
      ),
      supportingFactIds: checkIdsExist(
        item.supportingFactIds,
        idx.facts,
        `${where}/${item.id}`,
        issues,
      ),
      supportingRiskIds: checkIdsExist(
        item.supportingRiskIds,
        idx.risks,
        `${where}/${item.id}`,
        issues,
      ),
    };
    if (supportingIdsOf(cleaned).length === 0) {
      issues.push(`${where}/${item.id}: 无任何有效 supporting ID，关键结论不予持久化（已移除）`);
      removedCount += 1;
      return null;
    }
    if (cleaned.impact === "BID_FATAL" && !bidFatalJustified(cleaned, idx)) {
      issues.push(
        `${where}/${item.id}: BID_FATAL 缺少明确淘汰/不响应依据，已降级为 BID_REQUIRED`,
      );
      cleaned.impact = "BID_REQUIRED";
      if (cleaned.severity === "CRITICAL") cleaned.severity = "HIGH";
    }
    return cleaned;
  };

  const keyRequirements = synthesis.keyRequirements
    .map((i) => cleanKeyItem(i, "keyRequirements"))
    .filter((i): i is AnalystKeyItem => i !== null);

  const technicalRequirements = synthesis.technicalRequirements
    .map((i) => cleanKeyItem(i, "technicalRequirements"))
    .filter((i): i is AnalystKeyItem => i !== null)
    .filter((i) => {
      if (onlyCommercialSupport(i, idx) || !technicalJustified(i, idx)) {
        issues.push(
          `technicalRequirements/${i.id}: 支撑条款非技术类（invoice/商务/一般合同不得归入技术要求），已移出技术区`,
        );
        removedCount += 1;
        return false;
      }
      return true;
    });

  const commercialAndDelivery = synthesis.commercialAndDelivery
    .map((i) => cleanKeyItem(i, "commercialAndDelivery"))
    .filter((i): i is AnalystKeyItem => i !== null);

  const risksAndGaps = synthesis.risksAndGaps
    .map((r) => {
      const valid = checkIdsExist(r.supportingIds, idx.all, "risksAndGaps", issues);
      if (valid.length === 0) {
        issues.push(`risksAndGaps「${r.titleZh.slice(0, 30)}」: 无有效 supporting ID（已移除）`);
        removedCount += 1;
        return null;
      }
      return { ...r, supportingIds: valid };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const clarifications = synthesis.clarifications
    .map((c) => {
      const validClar = checkIdsExist(
        c.clarificationIds,
        idx.clarifications,
        "clarifications",
        issues,
      );
      const validSupport = checkIdsExist(c.supportingIds, idx.all, "clarifications", issues);
      if (validClar.length === 0 && validSupport.length === 0) {
        issues.push(
          `clarifications「${c.questionZh.slice(0, 30)}」: 无有效关联 ID（已移除）`,
        );
        removedCount += 1;
        return null;
      }
      return { ...c, clarificationIds: validClar, supportingIds: validSupport };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  const sanitized: AnalystLlmOutput = {
    ...synthesis,
    keyRequirements,
    technicalRequirements,
    commercialAndDelivery,
    risksAndGaps,
    clarifications,
  };

  return { ok: issues.length === 0, issues, sanitized, removedCount };
}
