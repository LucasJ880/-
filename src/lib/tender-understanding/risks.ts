/**
 * Risk 生成 — 零模板
 *
 * Risk 只来源于（spec §32）：verified LLM risk 候选（证据在案）+
 * 管线状态派生（矛盾 / 关键事实 UNKNOWN / mandatory uncertain / 证据缺口 /
 * 截止临近[仅提供 analysisDate 时]）。
 * CRITICAL 仅用于可能直接导致废标 / 非合规 / 提交无效 / 重大技术不可行 /
 * 重大商业敞口（spec §33）。
 */

import type {
  AnalysisMetadataV2,
  ClarificationV2,
  ConflictV2,
  CriticalFactSlotV2,
  CriticalFactType,
  DocumentFactV2,
  RiskCandidateV2,
  RiskV2,
  TenderRequirementV2,
} from "./contract";
import { extractDatesYmd } from "./normalize";

const CRITICAL_RISK_TYPES = new Set<RiskCandidateV2["riskType"]>([
  "SUBMISSION",
  "MANDATORY_MISSING",
  "COMPLIANCE",
  "ADDENDUM_CONFLICT",
]);

/** 提交阻断级槽位：UNKNOWN 即 CRITICAL */
const SUBMISSION_BLOCKER_SLOTS: CriticalFactType[] = [
  "closing_datetime",
  "submission_method",
];

/** 商业敞口槽位：UNKNOWN 记 IMPORTANT commercial unknown */
const COMMERCIAL_UNKNOWN_SLOTS: CriticalFactType[] = [
  "quantity",
  "warranty",
  "bond",
  "insurance",
  "pricing_method",
];

export type RiskDerivationInput = {
  verifiedRiskCandidates: RiskCandidateV2[];
  requirements: TenderRequirementV2[];
  facts: DocumentFactV2[];
  criticalFacts: Record<CriticalFactType, CriticalFactSlotV2>;
  conflicts: ConflictV2[];
  clarifications: ClarificationV2[];
  rejectedTally: AnalysisMetadataV2["rejectedCandidates"];
  analysisDate?: string | null;
};

export function deriveRisks(input: RiskDerivationInput): RiskV2[] {
  const risks: RiskV2[] = [];
  let seq = 0;
  const nextId = () => `RISK-${String(++seq).padStart(3, "0")}`;

  const factById = new Map(input.facts.map((f) => [f.id, f]));

  // 1. verified LLM 风险候选（严格限制 CRITICAL 的类型面）
  for (const c of input.verifiedRiskCandidates) {
    const severity: RiskV2["severity"] =
      c.confidence === "HIGH" && CRITICAL_RISK_TYPES.has(c.riskType)
        ? "CRITICAL"
        : "IMPORTANT";
    risks.push({
      id: nextId(),
      severity,
      riskType: c.riskType,
      description: c.description,
      relatedRequirementIds: [],
      relatedFactIds: [],
      evidence: [
        {
          documentId: c.sourceDocumentId,
          pageNumber: c.pageNumber,
          snippet: c.sourceSnippet.slice(0, 600),
        },
      ],
      reasonCode: `LLM_${c.riskType}`,
    });
  }

  // 2. 未解决矛盾 → CRITICAL（涉 mandatory/critical fact）或 IMPORTANT
  for (const conflict of input.conflicts) {
    if (conflict.resolution !== "UNRESOLVED") continue;
    const involvesMandatory = conflict.itemIds.some((id) =>
      input.requirements.some(
        (r) => r.id === id && r.mandatory === true,
      ),
    );
    const involvesFact = conflict.topic.startsWith("fact:");
    risks.push({
      id: nextId(),
      severity: involvesMandatory || involvesFact ? "CRITICAL" : "IMPORTANT",
      riskType: "CONTRADICTION",
      description: `未解决矛盾：${conflict.topic} — 取值/表述不一致（${conflict.values.join(" ⇄ ").slice(0, 160)}），投标前必须澄清。`,
      relatedRequirementIds: conflict.itemIds.filter((id) => id.startsWith("R-")),
      relatedFactIds: conflict.itemIds.filter((id) => id.startsWith("F-")),
      evidence: conflict.itemIds
        .map((id) => factById.get(id)?.evidence[0])
        .filter((e): e is NonNullable<typeof e> => Boolean(e))
        .slice(0, 2),
      reasonCode: "UNRESOLVED_CONFLICT",
    });
  }

  // 3. 提交阻断级 UNKNOWN
  for (const slot of SUBMISSION_BLOCKER_SLOTS) {
    if (input.criticalFacts[slot].status === "UNKNOWN") {
      risks.push({
        id: nextId(),
        severity: "CRITICAL",
        riskType: "SUBMISSION",
        description: `关键提交信息未在文档集中找到：${slot} = UNKNOWN，无法安全完成投标提交，需向业主确认。`,
        relatedRequirementIds: [],
        relatedFactIds: [],
        evidence: [],
        reasonCode: `UNKNOWN_${slot.toUpperCase()}`,
      });
    }
  }

  // 4. 商业未知 → IMPORTANT（聚合一条，避免风险噪音）
  const commercialUnknowns = COMMERCIAL_UNKNOWN_SLOTS.filter(
    (slot) => input.criticalFacts[slot].status === "UNKNOWN",
  );
  if (commercialUnknowns.length > 0) {
    risks.push({
      id: nextId(),
      severity: "IMPORTANT",
      riskType: "COMMERCIAL",
      description: `商业要素未在文档集中找到：${commercialUnknowns.join("、")} = UNKNOWN；报价与合规准备存在敞口。`,
      relatedRequirementIds: [],
      relatedFactIds: [],
      evidence: [],
      reasonCode: "COMMERCIAL_UNKNOWNS",
    });
  }

  // 5. mandatory uncertain → IMPORTANT（聚合）
  const uncertain = input.requirements.filter(
    (r) => r.status === "ACTIVE" && r.mandatory === "uncertain",
  );
  if (uncertain.length > 0) {
    risks.push({
      id: nextId(),
      severity: "IMPORTANT",
      riskType: "COMPLIANCE",
      description: `${uncertain.length} 条要求的强制性无法从文本确定（uncertain），需人工复核后纳入合规矩阵。`,
      relatedRequirementIds: uncertain.map((r) => r.id).slice(0, 12),
      relatedFactIds: [],
      evidence: uncertain[0]!.evidence.slice(0, 1),
      reasonCode: "MANDATORY_UNCERTAIN",
    });
  }

  // 6. 证据缺口（拒收统计可见性）
  const rejectedTotal = input.rejectedTally.reduce((a, r) => a + r.count, 0);
  if (rejectedTotal > 0) {
    risks.push({
      id: nextId(),
      severity: "IMPORTANT",
      riskType: "EVIDENCE_GAP",
      description: `${rejectedTotal} 条抽取候选因证据验证失败被拒收（${input.rejectedTally.map((r) => `${r.reasonCode}×${r.count}`).join("，")}）；对应内容可能存在但未被可靠定位，建议人工抽查。`,
      relatedRequirementIds: [],
      relatedFactIds: [],
      evidence: [],
      reasonCode: "EVIDENCE_REJECTIONS",
    });
  }

  // 7. 截止临近（仅显式提供 analysisDate 时；benchmark 不传 → 确定性）
  if (input.analysisDate) {
    const closing = slotFact(input, "closing_datetime");
    const closingDate =
      closing?.normalizedValue?.kind === "datetime"
        ? closing.normalizedValue.date
        : null;
    if (closingDate) {
      const days = daysBetweenYmd(input.analysisDate, closingDate);
      if (days !== null && days >= 0 && days <= 7) {
        risks.push({
          id: nextId(),
          severity: "CRITICAL",
          riskType: "DEADLINE",
          description: `距截标仅 ${days} 天（closing ${closingDate}），准备时间极紧。`,
          relatedRequirementIds: [],
          relatedFactIds: closing ? [closing.id] : [],
          evidence: closing?.evidence.slice(0, 1) ?? [],
          reasonCode: "CLOSING_PROXIMITY",
        });
      }
    }
  }

  return risks;
}

function slotFact(
  input: RiskDerivationInput,
  slot: CriticalFactType,
): DocumentFactV2 | null {
  const s = input.criticalFacts[slot];
  if (s.status !== "KNOWN") return null;
  return input.facts.find((f) => f.id === s.factId) ?? null;
}

function daysBetweenYmd(fromYmd: string, toYmd: string): number | null {
  const from = extractDatesYmd(fromYmd)[0];
  const to = extractDatesYmd(toYmd)[0];
  if (!from || !to) return null;
  const a = Date.UTC(
    Number(from.slice(0, 4)),
    Number(from.slice(5, 7)) - 1,
    Number(from.slice(8, 10)),
  );
  const b = Date.UTC(
    Number(to.slice(0, 4)),
    Number(to.slice(5, 7)) - 1,
    Number(to.slice(8, 10)),
  );
  return Math.round((b - a) / 86_400_000);
}
