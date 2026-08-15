import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  isAccessError,
  missingOrgResponse,
  orgIdOf,
  requireTenderAnalysisRead,
} from "@/lib/tender-auto-analysis/api-access";
import {
  serializeChangeCandidate,
  serializeClarification,
  serializeDeliverable,
  serializeFact,
  serializeRequirement,
  serializeRunListItem,
  serializeSection,
  serializeSourceRef,
} from "@/lib/tender-auto-analysis/serializers";
import { CHINESE_REPORT_CHAPTERS } from "@/lib/tender-auto-analysis/constants";
import { isTenderPackageAiExperienceEnabled } from "@/lib/tender-auto-analysis/auto-flags";
import { getPackageCoverage } from "@/lib/tender-auto-analysis/package-coverage";
import { readAnalystSynthesis } from "@/lib/tender-analyst/contract";

/**
 * GET /api/projects/[id]/tender-analysis/runs/[runId]
 * 完整报告：sections / facts / requirements / clarifications / deliverables / sources / summary
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const { id: projectId, runId } = await params;
  const access = await requireTenderAnalysisRead(request, projectId);
  if (isAccessError(access)) return access;
  const orgId = orgIdOf(access);
  if (!orgId) return missingOrgResponse();

  const run = await db.tenderAnalysisRun.findFirst({
    where: { id: runId, projectId, orgId },
    include: {
      sections: { orderBy: { sectionKey: "asc" } },
      facts: {
        orderBy: { createdAt: "asc" },
        include: { sourceRefs: true },
      },
      requirements: {
        orderBy: { requirementCode: "asc" },
        include: { sourceRefs: true },
      },
      clarifications: { orderBy: { createdAt: "asc" } },
      deliverables: { orderBy: { deliverableKey: "asc" } },
      sourceRefs: { orderBy: { createdAt: "asc" }, take: 200 },
      changeCandidates: {
        where: { status: "PENDING_REVIEW" },
        orderBy: { createdAt: "asc" },
      },
      documents: {
        select: {
          documentId: true,
          role: true,
          document: { select: { title: true, pageCount: true } },
        },
      },
    },
  });

  if (!run) {
    return NextResponse.json({ error: "分析记录不存在" }, { status: 404 });
  }

  // 任务（sourceId = runId）
  const tasks = await db.task.findMany({
    where: {
      projectId,
      sourceType: "tender_analysis",
      sourceId: run.id,
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      sourceTemplateKey: true,
    },
  });

  const summary =
    run.summaryJson && typeof run.summaryJson === "object"
      ? (run.summaryJson as Record<string, unknown>)
      : {};

  // 安全摘要字段（不整包吐 raw JSON 给 UI 当主内容）
  const summarySafe = {
    text: run.summaryText,
    recommendation:
      typeof summary.recommendation === "string" ? summary.recommendation : null,
    majorBlockers: Array.isArray(summary.majorBlockers)
      ? summary.majorBlockers.filter((x) => typeof x === "string")
      : [],
    nextActions: Array.isArray(summary.nextActions)
      ? summary.nextActions.filter((x) => typeof x === "string")
      : [],
  };

  const chapters = CHINESE_REPORT_CHAPTERS.map((ch) => {
    const sec = run.sections.find((s) => s.sectionKey === ch.sectionKey);
    return {
      order: ch.order,
      key: ch.key,
      titleZh: ch.titleZh,
      section: sec ? serializeSection(sec) : null,
    };
  });

  const documentTitleById = new Map(
    run.documents.map((d) => [d.documentId, d.document.title] as const),
  );
  const sourceOpts = { documentTitleById };

  const roleLabelOf = (role: string) => {
    switch (role) {
      case "ADDENDUM":
        return "补遗";
      case "ATTACHMENT":
      case "SUPPLEMENT":
        return "附件";
      case "PRICING":
        return "报价";
      case "FORM":
        return "表格";
      case "DRAWING":
        return "图纸";
      case "UNKNOWN":
        return "未分类";
      default:
        return "主文件";
    }
  };

  // Analyst 层（EXPERIENCE flag ON 且 run 带 synthesis 时才进入新 UX；
  // 旧 run / flag OFF → analystSynthesis:null，前端安全 fallback legacy 视图）
  const experienceEnabled = isTenderPackageAiExperienceEnabled({ orgId });
  const analystSynthesis = experienceEnabled
    ? readAnalystSynthesis(run.summaryJson)
    : null;
  const coverage = await getPackageCoverage(projectId, run.id);

  return NextResponse.json({
    run: serializeRunListItem({
      ...run,
      pendingChangeCount: run.changeCandidates.length,
    }),
    experienceEnabled,
    analystSynthesis,
    coverage,
    summary: summarySafe,
    chapters,
    sections: run.sections.map(serializeSection),
    facts: run.facts.map((f) => serializeFact(f, sourceOpts)),
    requirements: run.requirements.map((r) =>
      serializeRequirement(r, sourceOpts),
    ),
    clarifications: run.clarifications.map(serializeClarification),
    deliverables: run.deliverables.map(serializeDeliverable),
    sources: run.sourceRefs.map((s) => serializeSourceRef(s, sourceOpts)),
    changeCandidates: run.changeCandidates.map(serializeChangeCandidate),
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      status: t.status,
      statusLabel:
        t.status === "done"
          ? "已完成"
          : t.status === "in_progress"
            ? "进行中"
            : "待办",
      priority: t.priority,
    })),
    documents: run.documents.map((d) => ({
      documentId: d.documentId,
      role: d.role,
      roleLabel: roleLabelOf(d.role),
      title: d.document.title,
      pageCount: d.document.pageCount,
    })),
  });
}
