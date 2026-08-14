/**
 * Phase I — 「30 秒看懂项目」Executive Brief
 *
 * 单一事实源：最新有效 TenderAnalysisRun 的结构化结果（package 分析）。
 * 30 秒看懂 = 对该分析的 deterministic projection（不再独立 summary 系统、不再额外 LLM）。
 *
 * 核心修复（任务书 §27）：Missing ≠ Processing。
 *   - 只有真正存在活跃 run（PENDING/EXTRACTING/ANALYZING）才显示 PROCESSING；
 *   - 缺数据显示 UNKNOWN（不是"调查中"）；
 *   - 外部情报字段显示 NEEDS_EXTERNAL_RESEARCH（留待 T4），绝不"调查中"；
 *   - fingerprint 变化显示 STALE；run FAILED 显示 FAILED。
 *
 * 纯函数 buildExecutiveBrief 便于单测；getExecutiveBrief 负责取数装配。
 */

import { db } from "@/lib/db";
import { computePackageFingerprint, getTenderPackageDocuments } from "./package";
import { getPackageCoverage, type PackageCoverage } from "./package-coverage";

export type BriefFieldState =
  | "READY"
  | "UNKNOWN"
  | "PROCESSING"
  | "STALE"
  | "CONFLICT"
  | "FAILED"
  | "NEEDS_EXTERNAL_RESEARCH"
  | "NOT_STARTED";

export type BriefField = { state: BriefFieldState; value: string | null };

export type AnalysisStatusView =
  | "NONE"
  | "PROCESSING"
  | "FAILED"
  | "READY"
  | "STALE";

/** run.summaryJson.brief 的就绪块（V2 写入；V1/room 由 loader 兜底映射） */
export type BriefSource = {
  oneLiner: string | null;
  buyer: string | null;
  product: string | null;
  recommendation: string | null;
  nextActions: string[];
  blockers: string[];
  unresolvedConflictCount: number;
};

export type BuildBriefInput = {
  run: {
    status: string;
    fingerprint: string | null;
    source: BriefSource | null;
  } | null;
  currentFingerprint: string | null;
  projectType: string | null;
  /** M1 外部情报：人工确认后的外部结论（room.summaryJson.externalConfirmed） */
  externalConfirmed?: {
    previousWinner?: string | null;
    historicalContractValue?: string | null;
    possiblyRecurring?: string | null;
  } | null;
};

export type ExecutiveBriefFields = {
  oneLiner: BriefField;
  buyer: BriefField;
  product: BriefField;
  projectType: BriefField;
  recommendation: BriefField;
  majorBlockers: BriefField;
  nextActions: BriefField;
};

export type ExecutiveBriefExternal = {
  previousWinner: BriefField;
  historicalContractValue: BriefField;
  possiblyRecurring: BriefField;
};

export type ExecutiveBrief = {
  analysisStatus: AnalysisStatusView;
  runId: string | null;
  stale: boolean;
  fields: ExecutiveBriefFields;
  external: ExecutiveBriefExternal;
};

const ACTIVE_STATUSES = new Set(["PENDING", "EXTRACTING", "ANALYZING"]);
const READY_STATUSES = new Set(["REVIEW_REQUIRED", "APPROVED"]);

/** 外部情报字段：无活跃外部调查 runtime（T4 未启用）→ 一律待外部调查，绝不"调查中"。 */
function externalField(): BriefField {
  return { state: "NEEDS_EXTERNAL_RESEARCH", value: null };
}

/** 由分析就绪度推导 AI 建议（非人工 GO/HOLD/NO_GO）。 */
function deriveRecommendation(src: BriefSource): string {
  if (src.recommendation) return src.recommendation;
  const blocked = src.blockers.length > 0 || src.unresolvedConflictCount > 0;
  if (blocked) return "存在阻塞/缺失，建议先澄清（AI 建议，非最终决定）";
  return "信息较完整，可进一步评估报价（AI 建议，非最终决定）";
}

/** 纯函数：装配 30 秒看懂各字段状态。 */
export function buildExecutiveBrief(input: BuildBriefInput): ExecutiveBrief {
  const { run, currentFingerprint, projectType } = input;

  const projectTypeField: BriefField = projectType
    ? { state: "READY", value: projectType }
    : { state: "UNKNOWN", value: null };

  // M1：人工确认过的外部结论 → READY；否则保持「需外部调查」（绝不自动当事实）
  const ext = input.externalConfirmed ?? null;
  const extField = (v: string | null | undefined): BriefField =>
    v && v.trim() ? { state: "READY", value: v } : externalField();
  const external: ExecutiveBriefExternal = {
    previousWinner: extField(ext?.previousWinner),
    historicalContractValue: extField(ext?.historicalContractValue),
    possiblyRecurring: extField(ext?.possiblyRecurring),
  };

  // 无任何分析 run → NOT_STARTED（不是"调查中"）
  if (!run) {
    const na: BriefField = { state: "NOT_STARTED", value: null };
    return {
      analysisStatus: "NONE",
      runId: null,
      stale: false,
      fields: {
        oneLiner: na,
        buyer: na,
        product: na,
        projectType: projectTypeField,
        recommendation: na,
        majorBlockers: na,
        nextActions: na,
      },
      external,
    };
  }

  // 活跃 run → PROCESSING（唯一允许"分析中"的情形，且确有活跃 run 背书）
  if (ACTIVE_STATUSES.has(run.status)) {
    const proc: BriefField = { state: "PROCESSING", value: null };
    return {
      analysisStatus: "PROCESSING",
      runId: null,
      stale: false,
      fields: {
        oneLiner: proc,
        buyer: proc,
        product: proc,
        projectType: projectTypeField,
        recommendation: proc,
        majorBlockers: proc,
        nextActions: proc,
      },
      external,
    };
  }

  // FAILED
  if (run.status === "FAILED") {
    const failed: BriefField = { state: "FAILED", value: null };
    return {
      analysisStatus: "FAILED",
      runId: null,
      stale: false,
      fields: {
        oneLiner: failed,
        buyer: failed,
        product: failed,
        projectType: projectTypeField,
        recommendation: failed,
        majorBlockers: failed,
        nextActions: failed,
      },
      external,
    };
  }

  // READY（REVIEW_REQUIRED / APPROVED / 其它终态）
  const ready = READY_STATUSES.has(run.status);
  const stale =
    !!currentFingerprint &&
    !!run.fingerprint &&
    currentFingerprint !== run.fingerprint;
  const src: BriefSource =
    run.source ?? {
      oneLiner: null,
      buyer: null,
      product: null,
      recommendation: null,
      nextActions: [],
      blockers: [],
      unresolvedConflictCount: 0,
    };

  const valueField = (value: string | null): BriefField => {
    if (value == null || value === "") return { state: "UNKNOWN", value: null };
    return { state: stale ? "STALE" : "READY", value };
  };

  // FB-12：blockers 原文来自 PDF 提取，可能带损坏字形/控制符（用户侧显示为乱码）。
  // 展示前净化：去控制符/替换符/私有区字符；净化后信息量过低的条目丢弃。
  const cleanBlockers = src.blockers
    .map((b) =>
      b
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f-\u009f\ufffd\ue000-\uf8ff]/g, "")
        .replace(/\s{2,}/g, " ")
        .trim(),
    )
    .filter((b) => {
      if (b.length < 4) return false;
      const readable = (b.match(/[一-鿿A-Za-z0-9]/g) ?? []).length;
      return readable / b.length > 0.5;
    })
    .slice(0, 5);
  const blockersValue =
    cleanBlockers.length > 0 ? cleanBlockers.join("；") : ready ? "无" : null;
  const majorBlockers: BriefField =
    src.unresolvedConflictCount > 0
      ? { state: "CONFLICT", value: blockersValue ?? "存在未解决冲突" }
      : blockersValue == null
        ? { state: "UNKNOWN", value: null }
        : { state: stale ? "STALE" : "READY", value: blockersValue };

  const nextActionsValue =
    src.nextActions.length > 0 ? src.nextActions.slice(0, 3).join("；") : null;

  return {
    analysisStatus: stale ? "STALE" : "READY",
    runId: null,
    stale,
    fields: {
      oneLiner: valueField(src.oneLiner),
      buyer: valueField(src.buyer),
      product: valueField(src.product),
      projectType: projectTypeField,
      recommendation: valueField(deriveRecommendation(src)),
      majorBlockers,
      nextActions: valueField(nextActionsValue),
    },
    external,
  };
}

/* --------------------------------- 取数装配 --------------------------------- */

type SummaryJson = Record<string, unknown> | null;

function asStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}
function asStrArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** 从 run.summaryJson（V2 brief 块）或 V1/room 兜底映射出 BriefSource。 */
function extractBriefSource(
  summaryJson: SummaryJson,
  summaryText: string | null,
  roomSummary: SummaryJson,
): BriefSource {
  const brief = (summaryJson?.brief ?? null) as Record<string, unknown> | null;
  if (brief) {
    return {
      oneLiner: asStr(brief.oneLiner) ?? asStr(summaryText),
      buyer: asStr(brief.buyer),
      product: asStr(brief.product),
      recommendation: null, // 由就绪度推导
      nextActions: asStrArray(brief.nextActions),
      blockers: asStrArray(brief.blockers),
      unresolvedConflictCount:
        typeof brief.unresolvedConflictCount === "number"
          ? brief.unresolvedConflictCount
          : 0,
    };
  }
  // V1 / room 兜底（生产 V2 off 时；缺失即 UNKNOWN，绝不编造）
  return {
    oneLiner:
      asStr(summaryText) ??
      asStr(summaryJson?.projectName) ??
      asStr(roomSummary?.product),
    buyer: asStr(summaryJson?.buyer) ?? asStr(roomSummary?.procuringAgency),
    product: asStr(roomSummary?.product),
    recommendation:
      asStr(summaryJson?.aiRecommendation) ?? asStr(roomSummary?.recommendation),
    nextActions: asStrArray(roomSummary?.nextActions),
    blockers: Array.isArray(roomSummary?.majorBlockers)
      ? asStrArray(roomSummary?.majorBlockers)
      : [],
    unresolvedConflictCount: 0,
  };
}

export type ExecutiveBriefResponse = ExecutiveBrief & {
  /** package/addendum 变更行（与项目活动流在前端合并展示） */
  packageChanges: string[];
  /** 真实覆盖率（禁止谎报「已分析 N」） */
  coverage: PackageCoverage;
};

/** 取数并装配当前项目的 Executive Brief（供 API / UI 消费）。 */
export async function getExecutiveBrief(
  projectId: string,
  projectType: string | null,
): Promise<ExecutiveBriefResponse> {
  const run = await db.tenderAnalysisRun.findFirst({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      sourceHashFingerprint: true,
      summaryText: true,
      summaryJson: true,
    },
  });

  const room = await db.bidIntelligenceRoom
    .findUnique({
      where: { projectId },
      select: { summaryJson: true },
    })
    .catch(() => null);

  // 当前 package fingerprint（best-effort；失败则不做 stale 判定）
  let currentFingerprint: string | null = null;
  try {
    const docs = await getTenderPackageDocuments(projectId);
    if (docs.length > 0) currentFingerprint = computePackageFingerprint(docs);
  } catch {
    currentFingerprint = null;
  }

  // package/addendum 变更（最新 run 的变更候选）
  let packageChanges: string[] = [];
  if (run) {
    const changes = await db.tenderAnalysisChangeCandidate.findMany({
      where: { runId: run.id },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { summaryZh: true },
    });
    packageChanges = changes.map((c) => c.summaryZh).filter(Boolean);
  }

  const source = run
    ? extractBriefSource(
        run.summaryJson as SummaryJson,
        run.summaryText,
        (room?.summaryJson ?? null) as SummaryJson,
      )
    : null;

  const roomSj = (room?.summaryJson ?? null) as Record<string, unknown> | null;
  const extConfirmed =
    roomSj && typeof roomSj.externalConfirmed === "object"
      ? (roomSj.externalConfirmed as {
          previousWinner?: string | null;
          historicalContractValue?: string | null;
          possiblyRecurring?: string | null;
        })
      : null;

  const brief = buildExecutiveBrief({
    run: run
      ? {
          status: run.status,
          fingerprint: run.sourceHashFingerprint,
          source,
        }
      : null,
    currentFingerprint,
    projectType,
    externalConfirmed: extConfirmed,
  });

  const coverage = await getPackageCoverage(projectId, run?.id ?? null);

  return { ...brief, runId: run?.id ?? null, packageChanges, coverage };
}
