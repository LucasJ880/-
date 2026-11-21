/**
 * BLOCKER 3 — Package 覆盖率可见性（evidence correctness，非新格式支持）
 *
 * Package AI 纳入 PDF/docx/xlsx/csv/txt（各自切成可引用单元）。若上传 10 文件、仅 7 个可分析，UI/E2E 绝不能显示
 * 「已分析 10 个文件」。必须报告真实覆盖：uploaded / eligible / analyzed / excluded + reasons。
 *
 * 纯函数 summarizePackageCoverage 便于单测；getPackageCoverage 负责取数。
 */

import { db } from "@/lib/db";
import { isAnalyzableFileType } from "./enqueue-helpers";
import { PACKAGE_ANALYSIS_MAX_PDF_PAGES } from "./page-parse";
import type { AnalystCoverage } from "@/lib/tender-analyst/contract";
import { PARSE_FAILED_REASON_LABEL } from "./exclusion-text";

export type CoverageRow = {
  documentId: string;
  fileType: string | null | undefined;
  parseStatus: string;
  /** 是否进入最新分析 run 的文档集 */
  analyzed: boolean;
  /** 文档来源；非用户上传（如 ai_checklist 系统生成物）不计入 uploaded/excluded */
  source?: string | null;
  title?: string | null;
  contentHashReady?: boolean;
  pageCount?: number | null;
  /** 文件当前记下的解析失败原因（ProjectDocument.parseError） */
  parseError?: string | null;
};

export type ExcludedFileDetail = {
  filename: string;
  fileType: string | null;
  parseStatus: string | null;
  contentHashReady: boolean;
  pageCount: number | null;
  exclusionReason: string;
  /**
   * 解析失败原文（FIX-13）：只有因解析失败被排除的文件有值，其它原因恒为 null。
   * 只随分析详情接口返回、只在分析面板上显示——可能含数据库报错与服务端路径，
   * 不得进模型提示、Muse 通道、通知，也不得存进综合解读的快照（见 toAnalystCoverage）；
   * 不显示它的接口用 withoutParseErrors 去掉。
   */
  parseError: string | null;
};

export type PackageCoverage = {
  uploaded: number;
  eligible: number;
  analyzed: number;
  excluded: number;
  /** 排除原因 → 计数（reason code） */
  excludedReasons: Record<string, number>;
  /** 逐文件排除明细（§3：可展开的排除原因） */
  excludedFiles: ExcludedFileDetail[];
  /** 人类可读覆盖标签（禁止谎报「已分析 N」） */
  label: string;
  /** 排除说明（若有） */
  note: string | null;
};

const REASON_LABEL: Record<string, string> = {
  unsupported_format:
    "格式不支持逐条溯源（如旧版 .doc / 图片），未纳入 Package AI",
  parse_failed: PARSE_FAILED_REASON_LABEL,
  // 观察期包4：解析层放行 81–400 页，但包分析（legacy 管线）守 80 页/文件。
  // 用户必须不用问就知道文件为何被排除（含真实页数，见逐文件明细的动态文案）。
  over_page_limit: `单文件超出包分析 ${PACKAGE_ANALYSIS_MAX_PDF_PAGES} 页上限（可由 AI 分析纳入）`,
};

/** 纯函数：由文档行汇总覆盖率。 */
export function summarizePackageCoverage(
  rows: ReadonlyArray<CoverageRow>,
): PackageCoverage {
  // 系统生成物（ai_checklist 等）不是用户上传的源文件，不计入覆盖分母
  const userRows = rows.filter(
    (r) => r.source == null || r.source === "upload",
  );
  const uploaded = userRows.length;
  const excludedReasons: Record<string, number> = {};
  const excludedFiles: ExcludedFileDetail[] = [];
  let eligible = 0;
  let analyzed = 0;

  for (const r of userRows) {
    const analyzable = isAnalyzableFileType(r.fileType ?? "");
    const overPageLimit =
      typeof r.pageCount === "number" &&
      r.pageCount > PACKAGE_ANALYSIS_MAX_PDF_PAGES;
    const isEligible =
      analyzable && r.parseStatus !== "failed" && !overPageLimit;
    if (isEligible) {
      eligible += 1;
      if (r.analyzed) analyzed += 1;
    } else {
      const reason = !analyzable
        ? "unsupported_format"
        : r.parseStatus === "failed"
          ? "parse_failed"
          : "over_page_limit";
      excludedReasons[reason] = (excludedReasons[reason] ?? 0) + 1;
      excludedFiles.push({
        filename: r.title ?? r.documentId,
        fileType: r.fileType ?? null,
        parseStatus: r.parseStatus ?? null,
        contentHashReady: r.contentHashReady ?? false,
        pageCount: r.pageCount ?? null,
        exclusionReason:
          reason === "over_page_limit"
            ? `${r.pageCount} 页超出包分析单文件 ${PACKAGE_ANALYSIS_MAX_PDF_PAGES} 页上限（可由 AI 分析纳入）`
            : (REASON_LABEL[reason] ?? reason),
        parseError:
          reason === "parse_failed" ? r.parseError?.trim() || null : null,
      });
    }
  }

  const excluded = uploaded - eligible;

  // 「已分析 X / N」——分母用 uploaded（用户上传的总数），真实覆盖率
  const label = `已分析 ${analyzed} / ${uploaded} 个文件`;

  let note: string | null = null;
  if (excluded > 0) {
    const segs = Object.entries(excludedReasons).map(
      ([code, n]) => `${n} 个文件${REASON_LABEL[code] ?? code}`,
    );
    note = segs.join("；");
  } else if (analyzed < eligible) {
    note = `${eligible - analyzed} 个可分析文件尚未纳入本次分析`;
  }

  return {
    uploaded,
    eligible,
    analyzed,
    excluded,
    excludedReasons,
    excludedFiles,
    label,
    note,
  };
}

/**
 * 覆盖清单 → 存进综合解读的快照（FIX-13）。
 *
 * 被排除文件**显式只取六项**：综合解读整块会经投标草稿的取数进模型提示，
 * 解析失败原文（parseError）不能跟着进去。以后给 ExcludedFileDetail 加字段，
 * 也不会自动流进快照。
 */
export function toAnalystCoverage(cov: PackageCoverage): AnalystCoverage {
  return {
    uploaded: cov.uploaded,
    eligible: cov.eligible,
    analyzed: cov.analyzed,
    excluded: cov.excludedFiles.map((f) => ({
      filename: f.filename,
      fileType: f.fileType,
      parseStatus: f.parseStatus,
      contentHashReady: f.contentHashReady,
      pageCount: f.pageCount,
      exclusionReason: f.exclusionReason,
    })),
  };
}

/**
 * 去掉解析失败原文的覆盖清单（FIX-13）：给不显示原文的接口用（投标简报、工作台汇总），
 * 原文只随真正显示它的分析详情接口返回。
 */
export function withoutParseErrors(cov: PackageCoverage): PackageCoverage {
  return {
    ...cov,
    excludedFiles: cov.excludedFiles.map((f) => ({ ...f, parseError: null })),
  };
}

/** 取数并汇总当前项目 package 覆盖率（analyzed 基于给定 run 的文档集）。 */
export async function getPackageCoverage(
  projectId: string,
  runId: string | null,
): Promise<PackageCoverage> {
  const [rows, analyzedIds] = await Promise.all([
    db.projectDocument.findMany({
      where: { projectId },
      select: {
        id: true,
        title: true,
        fileType: true,
        parseStatus: true,
        parseError: true,
        source: true,
        contentHash: true,
        pageCount: true,
      },
    }),
    runId
      ? db.tenderAnalysisRunDocument
          .findMany({ where: { runId }, select: { documentId: true } })
          .then((r) => new Set(r.map((x) => x.documentId)))
      : Promise.resolve(new Set<string>()),
  ]);

  return summarizePackageCoverage(
    rows.map((r) => ({
      documentId: r.id,
      title: r.title,
      fileType: r.fileType,
      parseStatus: r.parseStatus,
      parseError: r.parseError,
      source: r.source,
      contentHashReady: Boolean(r.contentHash),
      pageCount: r.pageCount,
      analyzed: analyzedIds.has(r.id),
    })),
  );
}
