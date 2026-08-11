/**
 * Addendum Precedence + 跨文档矛盾检测
 *
 * - Addendum 明确 changes/replaces/revises/extends/deletes → 原要求 SUPERSEDED、
 *   新要求 ACTIVE，产出 AddendumChange 记录（保留版本关系，不丢历史）。
 * - 无修订语言但同主题值不同 → CONFLICT / NEEDS_REVIEW，绝不偷偷择一。
 * - Fact 层：同 factType 归一化值不同 → Addendum 有修订语义则 supersede，
 *   否则 UNRESOLVED conflict（两个值都不得单独当作 ACTIVE 唯一真相）。
 */

import type {
  AddendumChangeV2,
  AnalyzerInput,
  ConflictV2,
  DocumentFactV2,
  RequirementCandidateV2,
  TenderRequirementV2,
} from "./contract";
import type { MergedRequirement } from "./dedupe";
import { normalizeForMatch, tokenJaccard } from "./normalize";

const REVISION_LANGUAGE =
  /\b(revis\w*|replac\w*|amend\w*|delet\w*|supersed\w*|chang\w* to|now reads|is hereby)\b/i;

const TOPIC_SIMILARITY_MIN = 0.3;

function isAddendumDoc(input: AnalyzerInput, documentId: string): boolean {
  return (
    input.documents.find((d) => d.documentId === documentId)?.sourceRole ===
    "ADDENDUM"
  );
}

function hasRevisionSemantics(c: RequirementCandidateV2): boolean {
  return (
    c.revisionAction !== null ||
    REVISION_LANGUAGE.test(c.sourceSnippet) ||
    REVISION_LANGUAGE.test(c.statement)
  );
}

export type PrecedenceResult = {
  requirements: TenderRequirementV2[];
  addendumChanges: AddendumChangeV2[];
  conflicts: ConflictV2[];
};

/**
 * merged: dedupe 后的 requirement 组（组内已是"同一条"）。
 * 这里处理组间关系：addendum 组 vs base 组的同主题替代/冲突。
 */
export function applyAddendumPrecedence(
  input: AnalyzerInput,
  merged: MergedRequirement[],
): PrecedenceResult {
  const requirements = merged.map((m) => m.requirement);
  const addendumChanges: AddendumChangeV2[] = [];
  const conflicts: ConflictV2[] = [];

  const fromAddendum = (m: MergedRequirement): boolean =>
    m.members.some((mm) => isAddendumDoc(input, mm.sourceDocumentId));

  for (let i = 0; i < merged.length; i++) {
    const add = merged[i]!;
    if (!fromAddendum(add)) continue;
    const addReq = add.requirement;
    if (addReq.status !== "ACTIVE") continue;
    const revising = add.members.find(
      (mm) => isAddendumDoc(input, mm.sourceDocumentId) && hasRevisionSemantics(mm),
    );

    // 找 base 侧同主题组（相似但未并组 = 内容有实质差异）
    for (let j = 0; j < merged.length; j++) {
      if (i === j) continue;
      const base = merged[j]!;
      if (fromAddendum(base)) continue;
      const baseReq = base.requirement;
      if (baseReq.status !== "ACTIVE") continue;
      if (baseReq.category !== addReq.category) continue;
      const sim = tokenJaccard(baseReq.statement, addReq.statement);
      const targetHint = revising?.revisionTargetHint
        ? normalizeForMatch(revising.revisionTargetHint)
        : null;
      const hintHit =
        targetHint !== null &&
        normalizeForMatch(baseReq.statement).includes(targetHint);
      if (sim < TOPIC_SIMILARITY_MIN && !hintHit) continue;

      if (revising) {
        baseReq.status = "SUPERSEDED";
        baseReq.supersededById = addReq.id;
        addendumChanges.push({
          id: `AC-${String(addendumChanges.length + 1).padStart(3, "0")}`,
          addendumDocumentId: revising.sourceDocumentId,
          action: revising.revisionAction ?? "SUPERSEDES",
          supersededRequirementId: baseReq.id,
          activeRequirementId: addReq.id,
          note: `Addendum 修订：${baseReq.statement.slice(0, 80)} → ${addReq.statement.slice(0, 80)}`,
          evidence: addReq.evidence.slice(0, 2),
        });
      } else {
        // 同主题、实质差异、无修订语言 → 不得偷偷择一
        baseReq.status = "NEEDS_REVIEW";
        addReq.status = "NEEDS_REVIEW";
        conflicts.push({
          id: `C-${String(conflicts.length + 1).padStart(3, "0")}`,
          topic: `${addReq.category}: ${addReq.statement.slice(0, 60)}`,
          itemIds: [baseReq.id, addReq.id],
          values: [baseReq.statement.slice(0, 120), addReq.statement.slice(0, 120)],
          resolution: "UNRESOLVED",
          note: "Base 与 Addendum 同主题表述存在实质差异且无明确修订语言，需人工确认。",
        });
      }
      break;
    }
  }

  // ── 通用跨文档矛盾（不限于 Addendum；spec §29） ──
  detectRequirementContradictions(merged, conflicts);

  return { requirements, addendumChanges, conflicts };
}

const NUMBER_RE = /\b\d+(?:[.,]\d+)?\b/g;

function numericSignature(r: TenderRequirementV2): string[] {
  const source = `${r.quantity ?? ""} ${r.statement}`;
  return Array.from(source.matchAll(NUMBER_RE)).map((m) =>
    m[0]!.replace(/,/g, ""),
  );
}

/**
 * 同类目、同主题、来自不同文档、数值信号不一致且互不包含的 ACTIVE 要求对：
 * → 双方 NEEDS_REVIEW + UNRESOLVED conflict（禁止偷偷择一）。
 */
function detectRequirementContradictions(
  merged: MergedRequirement[],
  conflicts: ConflictV2[],
): void {
  for (let i = 0; i < merged.length; i++) {
    const a = merged[i]!.requirement;
    if (a.status !== "ACTIVE") continue;
    for (let j = i + 1; j < merged.length; j++) {
      const b = merged[j]!.requirement;
      if (b.status !== "ACTIVE") continue;
      if (a.category !== b.category) continue;
      const docsA = new Set(a.evidence.map((e) => e.documentId));
      const sameDoc = b.evidence.every((e) => docsA.has(e.documentId));
      if (sameDoc) continue;
      const sim = tokenJaccard(a.statement, b.statement);
      if (sim < TOPIC_SIMILARITY_MIN) continue;
      const numsA = numericSignature(a);
      const numsB = numericSignature(b);
      if (numsA.length === 0 || numsB.length === 0) continue;
      const overlap = numsA.some((n) => numsB.includes(n));
      if (overlap) continue;
      a.status = "NEEDS_REVIEW";
      b.status = "NEEDS_REVIEW";
      conflicts.push({
        id: `C-${String(conflicts.length + 1).padStart(3, "0")}`,
        topic: `${a.category}: ${a.statement.slice(0, 60)}`,
        itemIds: [a.id, b.id],
        values: [a.statement.slice(0, 120), b.statement.slice(0, 120)],
        resolution: "UNRESOLVED",
        note: "跨文档同主题数值不一致且无修订语言，需人工确认有效版本。",
      });
    }
  }
}

/* ---------------------------------- Fact 层矛盾 ---------------------------------- */

export type FactConflictResult = {
  facts: DocumentFactV2[];
  conflicts: ConflictV2[];
};

export function detectFactConflicts(
  input: AnalyzerInput,
  facts: DocumentFactV2[],
  startIndex: number,
): FactConflictResult {
  const conflicts: ConflictV2[] = [];
  const byType = new Map<string, DocumentFactV2[]>();
  for (const f of facts) {
    if (f.factType === "other" || f.factType === "scope") continue;
    const list = byType.get(f.factType) ?? [];
    list.push(f);
    byType.set(f.factType, list);
  }

  for (const [factType, group] of byType) {
    if (group.length < 2) continue;
    // 只有"强类型"归一化值（日期/金额/数量/时长/百分比）不一致才构成矛盾；
    // text 措辞差异 = 同一事实的不同表述/侧面（buyer 全称 vs 简称、
    // submission 的多个方面），不得当成值冲突。
    const byKind = new Map<string, DocumentFactV2[]>();
    for (const f of group) {
      if (f.normalizedValue === null || f.normalizedValue.kind === "text") continue;
      const kind = f.normalizedValue.kind;
      const list = byKind.get(kind) ?? [];
      list.push(f);
      byKind.set(kind, list);
    }
    for (const [, kindGroup] of byKind) {
      const distinct = new Set(
        kindGroup.map((f) => JSON.stringify(f.normalizedValue)),
      );
      if (kindGroup.length < 2 || distinct.size <= 1) continue;

      // 值不同：ADDENDUM 来源且带修订语言的 fact 胜出，其余 SUPERSEDED
      const addendumFacts = kindGroup.filter(
        (f) =>
          f.sourceRole === "ADDENDUM" &&
          f.evidence.some((e) => REVISION_LANGUAGE.test(e.snippet)),
      );
      if (addendumFacts.length === 1) {
        for (const f of kindGroup) {
          if (f !== addendumFacts[0]) f.status = "SUPERSEDED";
        }
        continue;
      }
      for (const f of kindGroup) f.status = "CONFLICT";
      conflicts.push({
        id: `C-${String(startIndex + conflicts.length + 1).padStart(3, "0")}`,
        topic: `fact:${factType}`,
        itemIds: kindGroup.map((f) => f.id),
        values: kindGroup.map((f) => (f.rawValue ?? f.claim).slice(0, 120)),
        resolution: "UNRESOLVED",
        note: `同一事实（${factType}）在文档集中出现不一致取值，需人工确认。`,
      });
    }
  }

  return { facts, conflicts };
}
