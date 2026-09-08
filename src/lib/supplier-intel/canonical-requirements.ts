/**
 * B1：canonical 需求快照的**服务端**生产者（S2 Final Review Remediation）
 * R2（S2 Trust-Boundary Closure）：来源不可证完整时明确阻断，不再静默把 uncertain 读成 false。
 *
 * HTTP 边界不再接受客户端 requirements——本模块从服务端持久层读取，客户端只能提交
 * project 指针与检索提示。三值 mandatory（true|false|"uncertain"）的服务端真相现状
 *（2026-09-01 审计，见 PR 记录）：
 *
 *   - 逐条三值在 v2-map.ts `mandatory: r.mandatory === true` 处塌缩，
 *     TenderExtractedRequirement.mandatory Boolean **无法**区分 false 与 uncertain；
 *   - 但 Boolean=true 是忠实的（uncertain 永远塌缩为 false，不会伪装 true）；
 *   - uncertain 的聚合 id 表持久化在 TenderAnalysisSection(RISKS).structuredJson.risks[]
 *     （reasonCode=MANDATORY_UNCERTAIN → relatedRequirementIds），由 risks.ts
 *     `.slice(0, 12)` **封顶 12 条**。
 *
 * 因此本 loader 的口径是「可证无损，否则拒绝」：
 *   true      := row.mandatory === true（忠实）
 *   uncertain := code ∈ RISKS.MANDATORY_UNCERTAIN.relatedRequirementIds
 *   false     := 其余行——**仅当上面那张表可被证明完整时**才允许如此解释
 *
 * ── R2 的核心修正 ──────────────────────────────────────────
 * 旧实现对「RISKS 节缺失 / structuredJson 非法 / risks 不是数组 / relatedRequirementIds
 * 结构非法」一律返回 []，于是 Boolean=false 的行被默认解释成「可选」——这正是被禁止的
 * 静默塌缩，只是换了个入口。现在来源被显式分级（VALID / MISSING / MALFORMED /
 * POSSIBLY_TRUNCATED），非 VALID 一律抛 BLOCKED_BY_CANONICAL_REQUIREMENT_SOURCE。
 *
 * 「有效空集合」与「无效来源」的判定依据是 **既有 writer 契约**（本轮复核，非推测）：
 *   1. canonical V2 落库路径 v2-map.ts 把 `{ risks: RiskV2[], conflicts: ConflictV2[] }`
 *      写进 RISKS.structuredJson（persistV2CanonicalTx 对 SECTION_KEYS 全量 upsert，
 *      RISKS 必然存在）；RiskV2 逐条带 severity/description 字符串。
 *   2. risks.ts 的 deriveRisks **只要 uncertain.length > 0 就必定产出**一条
 *      reasonCode=MANDATORY_UNCERTAIN 的聚合风险。因此「结构合法的 canonical risks
 *      数组里没有该聚合」= 可证明本次分析零 uncertain（合法空集合，正常放行）。
 *   3. 反例形状必须拒收，不能当成「零 uncertain」：
 *      - legacy report.ts 写的 `{ kind: "risks", ... }`（**没有** risks 数组）；
 *      - workforce upsertWorkforceRiskSection 写的
 *        `{ version: "tender-workforce-risks/v1", risks: [{ statement }] }`
 *        （带 version 字符串 + 非 RiskV2 条目）——与 tender-workforce/tools.ts
 *        readCanonicalV2Risks 的既有判别口径一致，不新造第二套判别。
 *   4. review.ts 的人工编辑走 `{ ...prev, _edits }`，保留 risks/conflicts → 仍 VALID。
 *
 * 持久修法（SCHEMA_REQUIRED 上报，等 review）：在 tender 持久化点补
 * mandatoryState/mandatorySignal（additive），停止塌缩；届时本 loader 改读逐条列，
 * 聚合表与封顶分支自然消亡。workerCursor 重放（另一无损残留）被否决：指纹含当前 prompt
 * 版本，任何 prompt 升版/文档变动即全体失效，且需在 supplier-intel 内复刻
 * tender 流水线内部（第二实现，禁）。
 */

import { db } from "@/lib/db";
import { SupplierIntelError } from "./errors";
import type { RequirementSnapshotEntry } from "./requirement-snapshot";

/** risks.ts 的既有封顶；≥ 此值即视为可能截断 → fail-closed */
export const MANDATORY_UNCERTAIN_LIST_CAP = 12;

/** 与全库口径一致的「最新可用分析」状态集（bid-fit/route.ts 先例） */
const USABLE_ANALYSIS_STATUSES = ["REVIEW_REQUIRED", "APPROVED"] as const;

/**
 * uncertain 来源的四级判定（R2）。只有 VALID 允许继续把 Boolean=false 解释为「可选」。
 *   VALID              有效来源；uncertainIds 可证完整（含可证的空集合）
 *   MISSING            来源不存在（无 RISKS 节 / structuredJson 为空）
 *   MALFORMED          来源存在但结构非法、或非 canonical writer 形状、或自相矛盾
 *   POSSIBLY_TRUNCATED 来源有效但列表可能被既有上限截断，溢出项与 false 不可区分
 */
export const CANONICAL_UNCERTAIN_SOURCE_STATUSES = [
  "VALID",
  "MISSING",
  "MALFORMED",
  "POSSIBLY_TRUNCATED",
] as const;
export type CanonicalUncertainSourceStatus = (typeof CANONICAL_UNCERTAIN_SOURCE_STATUSES)[number];

export interface CanonicalUncertainSource {
  status: CanonicalUncertainSourceStatus;
  /** 仅 status=VALID 有意义；VALID + 空数组 = 可证「零 uncertain」 */
  uncertainIds: string[];
  /** 机器可读细分原因（审计/报错用；不含任何文档正文） */
  reasonCode: string;
  detail: string;
}

function invalid(
  status: Exclude<CanonicalUncertainSourceStatus, "VALID">,
  reasonCode: string,
  detail: string,
): CanonicalUncertainSource {
  return { status, uncertainIds: [], reasonCode, detail };
}

/** canonical V2 RISKS 条目判别（tools.ts readCanonicalV2Risks 同口径）：逐条 severity/description 字符串 */
function isCanonicalRiskEntry(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  return typeof r.severity === "string" && typeof r.description === "string";
}

/**
 * 纯函数：判定 RISKS 章节能否作为 uncertain 的**可证完整**来源。
 * 绝不「过滤掉非法成员 / 只取第一条聚合 / 先去重缩短长度」来掩盖来源问题——
 * 这三种做法都会把不可证的来源伪装成可证的。
 */
export function classifyUncertainRequirementSource(
  section: { structuredJson: unknown } | null | undefined,
  opts?: { cap?: number },
): CanonicalUncertainSource {
  const cap = opts?.cap ?? MANDATORY_UNCERTAIN_LIST_CAP;

  if (!section) {
    return invalid("MISSING", "RISKS_SECTION_MISSING", "分析缺少 RISKS 章节，uncertain 聚合表无从读取");
  }
  const sj = section.structuredJson;
  if (sj === null || sj === undefined) {
    return invalid("MISSING", "STRUCTURED_JSON_NULL", "RISKS 章节存在但 structuredJson 为空");
  }
  if (typeof sj !== "object" || Array.isArray(sj)) {
    return invalid("MALFORMED", "STRUCTURED_JSON_NOT_OBJECT", "RISKS.structuredJson 不是对象");
  }
  const obj = sj as Record<string, unknown>;

  if (typeof obj.version === "string") {
    return invalid(
      "MALFORMED",
      "NON_CANONICAL_WRITER_SHAPE",
      `RISKS.structuredJson 是 ${obj.version} 形状（非 canonical V2 输出），uncertain 语义不可推断`,
    );
  }
  if (!Array.isArray(obj.risks)) {
    // legacy report.ts 的 { kind: "risks" } 落在这里：没有 risks 数组 ⇒ 无法证明零 uncertain
    return invalid("MALFORMED", "RISKS_NOT_ARRAY", "RISKS.structuredJson.risks 不是数组");
  }
  const risks = obj.risks as unknown[];
  for (const [i, raw] of risks.entries()) {
    if (!isCanonicalRiskEntry(raw)) {
      return invalid(
        "MALFORMED",
        "RISK_ENTRY_NOT_CANONICAL",
        `RISKS.risks 第 ${i + 1} 条不是 canonical V2 风险条目（缺 severity/description）`,
      );
    }
  }

  const aggregates = (risks as Array<Record<string, unknown>>).filter(
    (r) => r.reasonCode === "MANDATORY_UNCERTAIN",
  );
  if (aggregates.length === 0) {
    // writer 契约：uncertain > 0 必产聚合 ⇒ 结构合法且无聚合 = 可证零 uncertain
    return {
      status: "VALID",
      uncertainIds: [],
      reasonCode: "NO_UNCERTAIN_AGGREGATE",
      detail: `canonical RISKS 有效（${risks.length} 条风险），无 MANDATORY_UNCERTAIN 聚合 ⇒ 可证零 uncertain`,
    };
  }
  if (aggregates.length > 1) {
    return invalid(
      "MALFORMED",
      "MULTIPLE_UNCERTAIN_AGGREGATES",
      `出现 ${aggregates.length} 条 MANDATORY_UNCERTAIN 聚合，无法证明哪条完整（不取第一条）`,
    );
  }

  const ids = aggregates[0].relatedRequirementIds;
  if (!Array.isArray(ids)) {
    return invalid(
      "MALFORMED",
      "RELATED_IDS_NOT_ARRAY",
      "MANDATORY_UNCERTAIN 聚合的 relatedRequirementIds 缺失或不是数组",
    );
  }
  const rawIds = ids as unknown[];
  for (const [i, v] of rawIds.entries()) {
    if (typeof v !== "string" || v.trim().length === 0) {
      return invalid(
        "MALFORMED",
        "RELATED_IDS_MEMBER_INVALID",
        `relatedRequirementIds 第 ${i + 1} 项不是非空字符串（不过滤非法成员）`,
      );
    }
  }
  if (rawIds.length === 0) {
    // deriveRisks 只在 uncertain > 0 时产聚合 ⇒ 空列表与聚合存在自相矛盾
    return invalid(
      "MALFORMED",
      "EMPTY_UNCERTAIN_AGGREGATE",
      "MANDATORY_UNCERTAIN 聚合存在但关联 id 为空，与 writer 契约矛盾",
    );
  }
  if (rawIds.length >= cap) {
    // 列表可能被 .slice(0, cap) 截断：溢出的 uncertain 与 false 不可区分。
    // 长度按**原始**成员数判定，不先去重缩短（去重会把截断藏起来）。
    return invalid(
      "POSSIBLY_TRUNCATED",
      "UNCERTAIN_LIST_AT_CAP",
      `uncertain 聚合表达到封顶（${rawIds.length}≥${cap}），逐条三值不可证无损`,
    );
  }

  return {
    status: "VALID",
    uncertainIds: rawIds as string[],
    reasonCode: "UNCERTAIN_LIST_COMPLETE",
    detail: `canonical RISKS 有效，uncertain 聚合 ${rawIds.length} 条（< ${cap}，可证完整）`,
  };
}

export interface CanonicalRequirementSnapshot {
  analysisRunId: string;
  analysisRunStatus: string;
  entries: RequirementSnapshotEntry[];
  uncertainCount: number;
  /** R2 审计：uncertain 来源判定（恒为 VALID——非 VALID 已在 loader 内抛错） */
  uncertainSourceStatus: CanonicalUncertainSourceStatus;
  uncertainSourceReason: string;
}

export async function loadCanonicalSupplierRequirementSnapshot(params: {
  orgId: string;
  projectId: string;
}): Promise<CanonicalRequirementSnapshot> {
  const run = await db.tenderAnalysisRun.findFirst({
    where: {
      orgId: params.orgId,
      projectId: params.projectId,
      status: { in: [...USABLE_ANALYSIS_STATUSES] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true },
  });
  if (!run) {
    throw new SupplierIntelError(
      "CANONICAL_REQUIREMENTS_UNAVAILABLE",
      "该项目尚无可用的招标分析（REVIEW_REQUIRED/APPROVED）——供应商搜索以 canonical 需求为真相源，不能凭空开搜",
    );
  }

  const [rows, risksSection] = await Promise.all([
    db.tenderExtractedRequirement.findMany({
      where: { analysisRunId: run.id, reviewStatus: { not: "REJECTED" } },
      select: {
        id: true,
        requirementCode: true,
        category: true,
        originalRequirement: true,
        mandatory: true,
      },
      orderBy: { requirementCode: "asc" },
    }),
    db.tenderAnalysisSection.findFirst({
      where: { runId: run.id, sectionKey: "RISKS" },
      select: { structuredJson: true },
    }),
  ]);
  if (rows.length === 0) {
    throw new SupplierIntelError(
      "CANONICAL_REQUIREMENTS_UNAVAILABLE",
      "最新分析没有可用的需求行（全部被人工拒绝或为空）",
    );
  }

  // R2：来源必须可证完整，否则拒绝开搜——绝不把疑似强制静默读成可选（被禁止的塌缩）
  const source = classifyUncertainRequirementSource(risksSection);
  if (source.status !== "VALID") {
    throw new SupplierIntelError(
      "BLOCKED_BY_CANONICAL_REQUIREMENT_SOURCE",
      `canonical uncertain 来源不可证完整（${source.status}/${source.reasonCode}）：${source.detail}——需先落 tender 持久层三值修复（见 SCHEMA_REQUIRED 上报）`,
    );
  }
  const uncertainSet = new Set(source.uncertainIds);

  const entries: RequirementSnapshotEntry[] = rows.map((r) => ({
    id: r.id, // DB 行 id：可直接作 requirementRefId 导航
    code: r.requirementCode,
    text: r.originalRequirement,
    category: r.category ?? null,
    mandatory: r.mandatory === true ? true : uncertainSet.has(r.requirementCode) ? "uncertain" : false,
    mandatorySignal: null, // 持久层未保留原文触发依据（同属 SCHEMA_REQUIRED 修法范围）
  }));

  return {
    analysisRunId: run.id,
    analysisRunStatus: run.status,
    entries,
    uncertainCount: uncertainSet.size,
    uncertainSourceStatus: source.status,
    uncertainSourceReason: source.reasonCode,
  };
}
