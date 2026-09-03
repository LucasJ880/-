/**
 * B1：canonical 需求快照的**服务端**生产者（S2 Final Review Remediation）
 *
 * HTTP 边界不再接受客户端 requirements——本模块从服务端持久层读取，客户端只能提交
 * project 指针与检索提示。三值 mandatory（true|false|"uncertain"）的服务端真相现状
 *（2026-09-01 审计，见 PR 记录）：
 *
 *   - 逐条三值在 v2-map.ts:217 `mandatory: r.mandatory === true` 处塌缩，
 *     TenderExtractedRequirement.mandatory Boolean **无法**区分 false 与 uncertain；
 *   - 但 Boolean=true 是忠实的（uncertain 永远塌缩为 false，不会伪装 true）；
 *   - uncertain 的聚合 id 表持久化在 TenderAnalysisSection(RISKS).structuredJson.risks[]
 *     （reasonCode=MANDATORY_UNCERTAIN → relatedRequirementIds），由 risks.ts:151
 *     `.slice(0, 12)` **封顶 12 条**。
 *
 * 因此本 loader 的口径是「可证无损，封顶即拒」：
 *   true      := row.mandatory === true（忠实）
 *   uncertain := code ∈ RISKS.MANDATORY_UNCERTAIN.relatedRequirementIds
 *   false     := 其余行
 *   当 uncertain 表长度 ≥ 12（可能被截断，false/uncertain 不可区分）→
 *     抛 BLOCKED_BY_CANONICAL_REQUIREMENT_SOURCE（fail-closed，绝不静默把
 *     uncertain 读成 false——这正是被禁止的塌缩）。
 *
 * 持久修法（SCHEMA_REQUIRED 上报，等 review）：在 tender 持久化点补
 * mandatoryState/mandatorySignal（additive），停止塌缩；届时本 loader 改读逐条列，
 * 封顶分支自然消亡。workerCursor 重放（另一无损残留）被否决：指纹含当前 prompt
 * 版本，任何 prompt 升版/文档变动即全体失效，且需在 supplier-intel 内复刻
 * tender 流水线内部（第二实现，禁）。
 */

import { db } from "@/lib/db";
import { SupplierIntelError } from "./errors";
import type { RequirementSnapshotEntry } from "./requirement-snapshot";

/** risks.ts:151 的既有封顶；≥ 此值即视为可能截断 → fail-closed */
export const MANDATORY_UNCERTAIN_LIST_CAP = 12;

/** 与全库口径一致的「最新可用分析」状态集（bid-fit/route.ts 先例） */
const USABLE_ANALYSIS_STATUSES = ["REVIEW_REQUIRED", "APPROVED"] as const;

export interface CanonicalRequirementSnapshot {
  analysisRunId: string;
  analysisRunStatus: string;
  entries: RequirementSnapshotEntry[];
  uncertainCount: number;
}

function readUncertainIds(structuredJson: unknown): string[] {
  if (typeof structuredJson !== "object" || structuredJson === null) return [];
  const risks = (structuredJson as { risks?: unknown }).risks;
  if (!Array.isArray(risks)) return [];
  for (const risk of risks) {
    if (
      typeof risk === "object" &&
      risk !== null &&
      (risk as { reasonCode?: unknown }).reasonCode === "MANDATORY_UNCERTAIN"
    ) {
      const ids = (risk as { relatedRequirementIds?: unknown }).relatedRequirementIds;
      if (Array.isArray(ids)) {
        return ids.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
      }
    }
  }
  return [];
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

  const uncertainIds = readUncertainIds(risksSection?.structuredJson ?? null);
  if (uncertainIds.length >= MANDATORY_UNCERTAIN_LIST_CAP) {
    // 表可能被 .slice(0,12) 截断：溢出的 uncertain 与 false 不可区分。
    // fail-closed：宁可拒绝开搜，绝不把疑似强制静默读成可选（被禁止的塌缩）。
    throw new SupplierIntelError(
      "BLOCKED_BY_CANONICAL_REQUIREMENT_SOURCE",
      `uncertain 聚合表达到封顶（${uncertainIds.length}≥${MANDATORY_UNCERTAIN_LIST_CAP}），逐条三值不可证无损——需先落 tender 持久层三值修复（见 SCHEMA_REQUIRED 上报）`,
    );
  }
  const uncertainSet = new Set(uncertainIds);

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
  };
}
