/**
 * S3-A：中文采购阅读视图（内部阅读用，**不是**对外发给工厂的 china-supplier-brief，
 * 也**不是**第二套 canonical requirements）。
 *
 * 数据来源全部是服务端已有事实：
 *   - `TenderExtractedRequirement`（英文原文 + 已有中文译文 + category + 逐条来源引文）
 *   - `classifyUncertainRequirementSource(RISKS)`——与 canonical loader **同一函数**还原
 *     mandatory 三值，保证阅读视图与开搜用的需求快照口径一致
 *   - `TenderAnalysisRun.summaryJson.criticalFacts`（截止时间/交付地/数量等关键槽位）
 *   - `TenderAnalysisRunDocument` → 文档标题，用于来源定位标签
 *
 * 诚实纪律（本文件的存在理由）：
 *   - 缺字段一律「未提取 / 待确认」，**绝不**按品类、常识或公司能力补出标书没有的
 *     认证、交期、安装责任或数量；
 *   - `quantity/unit` 在持久层**没有列**（V2 mapper 落库时丢弃），因此逐条需求不给数量，
 *     只呈现 criticalFacts.quantity 这一个有据可查的槽位；
 *   - 中文缺失时保留英文原文并标注「中文未生成」，不静默伪造中文，也不在此新增 LLM 调用；
 *   - 不自行换算单位、修改数值或弱化「必须/不得」；
 *   - mandatory=false 显示「非强制要求」而不是「可选」；uncertain 显示「强制性待确认」；
 *   - 来源无法定位时显示「来源未定位」，不编造页码（非 PDF 单元沿用 sectionLabel，不显示 p.N）。
 */

import { db } from "@/lib/db";
import { needsChineseTranslation } from "@/lib/tender-auto-analysis/requirement-lang";
import { serializeSourceRef } from "@/lib/tender-auto-analysis/serializers";
import type { SupplierIntelActor } from "./actor";
import { assertProjectAccessForActor } from "./access";
import {
  classifyUncertainRequirementSource,
  type CanonicalUncertainSourceStatus,
} from "./canonical-requirements";
import { SupplierIntelError } from "./errors";
import {
  PROCUREMENT_FACT_SLOTS,
  procurementGroupOf,
  type ProcurementGroupKey,
} from "./procurement-display";
import type { MandatorySnapshotValue } from "./requirement-snapshot";

// 展示层纯函数集中在 procurement-display（客户端可安全 import）；这里再导出，服务端调用方不变
export {
  PROCUREMENT_GROUPS,
  PROCUREMENT_FACT_SLOTS,
  procurementGroupOf,
  mandatoryDisplay,
} from "./procurement-display";
export type { ProcurementGroupKey, MandatoryTone } from "./procurement-display";

/* ───────────────── 视图类型 ───────────────── */

export interface ProcurementSourceRef {
  id: string;
  documentId: string;
  documentTitle: string | null;
  pageNumber: number | null;
  locationLabel: string | null;
  sectionLabel: string | null;
  snippet: string;
  confidence: string;
  methodLabel: string;
}

export interface ProcurementRequirementView {
  id: string;
  code: string;
  category: string | null;
  group: ProcurementGroupKey;
  /** 已有中文译文（可能仍是英文——见 textZhIsChinese） */
  textZh: string;
  /** 中文是否真的生成了；false 时前端必须显示「中文未生成」并保留英文 */
  textZhIsChinese: boolean;
  /** 英文原文，永不被译文覆盖 */
  textEn: string;
  mandatory: MandatorySnapshotValue;
  reviewStatus: string;
  sources: ProcurementSourceRef[];
}

export interface ProcurementFactView {
  key: string;
  label: string;
  status: "KNOWN" | "UNKNOWN";
  /** UNKNOWN 时为 null，前端显示「未提取」 */
  text: string | null;
}

export type ProcurementCanonicalState =
  | { state: "OK"; uncertainSourceStatus: CanonicalUncertainSourceStatus; uncertainCount: number }
  | { state: "BLOCKED"; code: string; reasonCode: string; message: string }
  | { state: "UNAVAILABLE"; code: string; message: string };

export interface ProcurementView {
  project: { id: string; name: string; clientOrganization: string | null; location: string | null };
  /**
   * 调用者对该项目的**有效写权限**（服务端裁决结果）。
   * 仅用于隐藏无意义的按钮——每个写操作仍在服务端独立鉴权，前端隐藏不构成保护。
   */
  canWrite: boolean;
  analysis: {
    runId: string;
    status: string;
    createdAt: string;
    /** 该分析是否就是 canonical loader 会选中的那一次（开搜用的同一版本） */
    isCanonicalSource: boolean;
  } | null;
  canonical: ProcurementCanonicalState;
  requirements: ProcurementRequirementView[];
  facts: ProcurementFactView[];
  documents: Array<{ documentId: string; title: string; role: string; pageCount: number | null }>;
  counts: { total: number; mandatory: number; uncertain: number; optional: number };
}

/* ───────────────── 服务 ───────────────── */

/** 与 canonical loader 同一口径的「最新可用分析」 */
const USABLE_ANALYSIS_STATUSES = ["REVIEW_REQUIRED", "APPROVED"] as const;

function readCriticalFacts(summaryJson: unknown): ProcurementFactView[] {
  const slots =
    typeof summaryJson === "object" && summaryJson !== null
      ? (summaryJson as { criticalFacts?: unknown }).criticalFacts
      : null;
  const map =
    typeof slots === "object" && slots !== null && !Array.isArray(slots)
      ? (slots as Record<string, unknown>)
      : {};
  return PROCUREMENT_FACT_SLOTS.map(({ key, label }) => {
    const raw = map[key];
    const obj =
      typeof raw === "object" && raw !== null && !Array.isArray(raw)
        ? (raw as { status?: unknown; text?: unknown })
        : null;
    const text = typeof obj?.text === "string" && obj.text.trim() ? obj.text.trim() : null;
    const known = obj?.status === "KNOWN" && text !== null;
    return { key, label, status: known ? ("KNOWN" as const) : ("UNKNOWN" as const), text: known ? text : null };
  });
}

/**
 * 载入某项目的中文采购阅读视图。读操作：要求项目 **read** 权限。
 * canonical 来源不可证完整时不抛错——返回 BLOCKED 状态让页面显示原因与复核入口，
 * 但**不**回退旧分析、**不**把 uncertain 重新解释成 false（开搜仍会被服务端阻断）。
 */
export async function loadProcurementView(
  actor: SupplierIntelActor,
  projectId: string,
): Promise<ProcurementView> {
  await assertProjectAccessForActor(actor, projectId, "read");
  // 读门已过；再探一次写权限，供前端隐藏无意义按钮（服务端仍逐操作独立鉴权）
  let canWrite = false;
  try {
    await assertProjectAccessForActor(actor, projectId, "write");
    canWrite = true;
  } catch {
    canWrite = false;
  }

  const project = await db.project.findFirst({
    where: { id: projectId, orgId: actor.orgId },
    select: { id: true, name: true, clientOrganization: true, location: true },
  });
  if (!project) throw new SupplierIntelError("NOT_FOUND", "项目不存在");

  const run = await db.tenderAnalysisRun.findFirst({
    where: { orgId: actor.orgId, projectId, status: { in: [...USABLE_ANALYSIS_STATUSES] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, createdAt: true, summaryJson: true },
  });

  if (!run) {
    return {
      project,
      canWrite,
      analysis: null,
      canonical: {
        state: "UNAVAILABLE",
        code: "CANONICAL_REQUIREMENTS_UNAVAILABLE",
        message: "该项目尚无可用的招标分析（待复核 / 已批准），无法生成采购要求视图",
      },
      requirements: [],
      facts: PROCUREMENT_FACT_SLOTS.map(({ key, label }) => ({ key, label, status: "UNKNOWN" as const, text: null })),
      documents: [],
      counts: { total: 0, mandatory: 0, uncertain: 0, optional: 0 },
    };
  }

  const [rows, risksSection, runDocs] = await Promise.all([
    db.tenderExtractedRequirement.findMany({
      where: { analysisRunId: run.id, reviewStatus: { not: "REJECTED" } },
      orderBy: { requirementCode: "asc" },
      include: { sourceRefs: { orderBy: { createdAt: "asc" } } },
    }),
    db.tenderAnalysisSection.findFirst({
      where: { runId: run.id, sectionKey: "RISKS" },
      select: { structuredJson: true },
    }),
    db.tenderAnalysisRunDocument.findMany({
      where: { runId: run.id },
      select: { documentId: true, role: true, document: { select: { title: true, pageCount: true } } },
    }),
  ]);

  const documentTitleById = new Map(runDocs.map((d) => [d.documentId, d.document.title] as const));
  const analysis = {
    runId: run.id,
    status: run.status,
    createdAt: run.createdAt.toISOString(),
    isCanonicalSource: true,
  };
  const facts = readCriticalFacts(run.summaryJson);
  const documents = runDocs.map((d) => ({
    documentId: d.documentId,
    title: d.document.title,
    role: d.role,
    pageCount: d.document.pageCount,
  }));

  const source = classifyUncertainRequirementSource(risksSection);
  if (source.status !== "VALID") {
    // 与开搜阻断同因同源：页面显示原因 + 需求复核入口，不擅自改判三值
    return {
      project,
      canWrite,
      analysis,
      canonical: {
        state: "BLOCKED",
        code: "BLOCKED_BY_CANONICAL_REQUIREMENT_SOURCE",
        reasonCode: source.reasonCode,
        message: source.detail,
      },
      requirements: [],
      facts,
      documents,
      counts: { total: 0, mandatory: 0, uncertain: 0, optional: 0 },
    };
  }

  const uncertainSet = new Set(source.uncertainIds);
  const requirements: ProcurementRequirementView[] = rows.map((r) => {
    const mandatory: MandatorySnapshotValue =
      r.mandatory === true ? true : uncertainSet.has(r.requirementCode) ? "uncertain" : false;
    const zh = r.chineseTranslation?.trim() || "";
    return {
      id: r.id,
      code: r.requirementCode,
      category: r.category ?? null,
      group: procurementGroupOf(r.category),
      textZh: zh,
      textZhIsChinese: zh.length > 0 && !needsChineseTranslation(zh),
      textEn: r.originalRequirement,
      mandatory,
      reviewStatus: r.reviewStatus,
      sources: r.sourceRefs.map((s) => serializeSourceRef(s, { documentTitleById })),
    };
  });

  return {
    project,
    canWrite,
    analysis,
    canonical: {
      state: "OK",
      uncertainSourceStatus: source.status,
      uncertainCount: uncertainSet.size,
    },
    requirements,
    facts,
    documents,
    counts: {
      total: requirements.length,
      mandatory: requirements.filter((r) => r.mandatory === true).length,
      uncertain: requirements.filter((r) => r.mandatory === "uncertain").length,
      optional: requirements.filter((r) => r.mandatory === false).length,
    },
  };
}
