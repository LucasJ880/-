import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { parseAndStoreContent } from "@/lib/files/parse-content";
import { generateDocumentSummary } from "@/lib/files/ai-summary";
import { generateProjectIntelligence } from "@/lib/files/ai-intelligence";
import { enqueueTenderPackageIfReady } from "@/lib/tender-auto-analysis/enqueue-package";

/** 自动入队业务结果诊断（附在 process-next 响应上；绝不包含 secret） */
type AutoEnqueueDiagnostic = {
  attempted: boolean;
  workDomain: string | null;
  enqueued: boolean;
  /** gate / readiness / enqueue 结果码（如 NOT_TENDER_PROJECT / auto_disabled / idempotent_reuse） */
  code: string;
  runId?: string;
};

/**
 * Phase D — 文件处理完成（package ready）后的最佳努力自动入队。
 * flag OFF / 非 tender / 未就绪 均在内部安全短路；幂等由 fingerprint 保证。
 * 绝不因分析入队失败而影响文件处理返回——但业务结果必须可观察：
 * structured log + 响应附带诊断，杜绝「文件扫描完成而 Package 从未入队且无人知晓」。
 */
async function maybeAutoEnqueueOnReady(
  projectId: string,
  userId: string,
): Promise<AutoEnqueueDiagnostic> {
  let diag: AutoEnqueueDiagnostic;
  try {
    const project = await db.project.findUnique({
      where: { id: projectId },
      select: { orgId: true, workDomain: true },
    });
    const result = await enqueueTenderPackageIfReady({
      projectId,
      userId,
      orgId: project?.orgId ?? undefined,
      trigger: "process_next_done",
    });
    diag = {
      attempted: true,
      workDomain: project?.workDomain ?? null,
      enqueued: result.enqueued,
      code: result.enqueued
        ? "ENQUEUED"
        : (result.reason ?? "UNKNOWN"),
      ...(result.runId ? { runId: result.runId } : {}),
    };
  } catch (e) {
    // 只记录错误类型，不透传 message（可能含内部细节）；secret 一律禁止
    diag = {
      attempted: true,
      workDomain: null,
      enqueued: false,
      code: `AUTO_ENQUEUE_ERROR:${e instanceof Error ? e.name : "unknown"}`,
    };
  }
  console.log(
    "[tender-auto-analysis] auto-enqueue outcome " +
      JSON.stringify({ projectId, ...diag }),
  );
  return diag;
}

/**
 * POST /api/projects/:id/files/process-next
 *
 * 按优先级处理项目文件的下一个待处理步骤（每次只做一步）：
 *   1. 文本提取（parseStatus = pending）
 *   2. AI 结构化摘要（parseStatus = done & aiSummaryStatus = pending & contentText 不为空）
 *   3. 项目情报分析（所有文档摘要完成后触发一次）
 *
 * 返回 { step, documentId?, remaining, done }
 */
export const POST = withAuth(async (request, ctx, user) => {
  const { id: projectId } = await ctx.params;

  // ?retry=1 → 重置失败/卡住的文件，重新处理
  const retry = request.nextUrl.searchParams.get("retry") === "1";
  if (retry) {
    await db.projectDocument.updateMany({
      where: {
        projectId,
        parseStatus: { in: ["failed", "parsing"] },
      },
      data: {
        parseStatus: "pending",
        parseError: null,
        contentText: null,
        aiSummaryStatus: "pending",
        aiSummaryJson: null,
      },
    });
    await db.projectDocument.updateMany({
      where: {
        projectId,
        parseStatus: "done",
        aiSummaryStatus: { in: ["failed", "generating"] },
      },
      data: { aiSummaryStatus: "pending", aiSummaryJson: null },
    });
  }

  // Step 1: 找到需要文本提取的文件
  const pendingParse = await db.projectDocument.findFirst({
    where: {
      projectId,
      parseStatus: "pending",
      fileType: { in: ["pdf", "doc", "docx", "xls", "xlsx", "csv", "txt"] },
    },
    select: { id: true, title: true },
    orderBy: { createdAt: "asc" },
  });

  if (pendingParse) {
    await parseAndStoreContent(pendingParse.id);
    const afterParse = await db.projectDocument.findUnique({
      where: { id: pendingParse.id },
      select: { parseStatus: true, parseError: true },
    });
    const remaining = await countRemaining(projectId);
    return NextResponse.json({
      step: "parse",
      documentId: pendingParse.id,
      documentTitle: pendingParse.title,
      parseStatus: afterParse?.parseStatus,
      parseError: afterParse?.parseError,
      remaining,
      done: false,
    });
  }

  // Step 2: 找到需要 AI 摘要的文件
  const pendingSummary = await db.projectDocument.findFirst({
    where: {
      projectId,
      parseStatus: "done",
      aiSummaryStatus: "pending",
      contentText: { not: null },
    },
    select: { id: true, title: true, contentText: true },
    orderBy: { createdAt: "asc" },
  });

  if (pendingSummary && pendingSummary.contentText && pendingSummary.contentText.length >= 50) {
    await generateDocumentSummary(pendingSummary.id);
    const remaining = await countRemaining(projectId);
    return NextResponse.json({
      step: "ai_summary",
      documentId: pendingSummary.id,
      documentTitle: pendingSummary.title,
      remaining,
      done: false,
    });
  }

  if (pendingSummary) {
    await db.projectDocument.update({
      where: { id: pendingSummary.id },
      data: { aiSummaryStatus: "done", aiSummaryJson: null },
    });
    const remaining = await countRemaining(projectId);
    const autoAnalysis =
      remaining === 0
        ? await maybeAutoEnqueueOnReady(projectId, user.id)
        : null;
    return NextResponse.json({
      step: "ai_summary_skip",
      documentId: pendingSummary.id,
      remaining,
      done: remaining === 0,
      autoAnalysis,
    });
  }

  // Step 3: 所有文档处理完后，生成/更新项目情报
  const hasSummaries = await db.projectDocument.count({
    where: { projectId, aiSummaryStatus: "done", aiSummaryJson: { not: null } },
  });

  if (hasSummaries > 0) {
    const existingIntel = await db.projectIntelligence.findUnique({
      where: { projectId },
      select: { createdAt: true },
    });

    const latestDoc = await db.projectDocument.findFirst({
      where: { projectId, aiSummaryStatus: "done" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });

    const needsRefresh =
      !existingIntel ||
      (latestDoc && latestDoc.createdAt > existingIntel.createdAt);

    if (needsRefresh) {
      await generateProjectIntelligence(projectId);
      const { applyDocumentMetadataToProject } = await import(
        "@/lib/projects/apply-document-metadata"
      );
      const metadata = await applyDocumentMetadataToProject(projectId).catch(
        () => null,
      );
      const autoAnalysis = await maybeAutoEnqueueOnReady(projectId, user.id);
      return NextResponse.json({
        step: "intelligence",
        remaining: 0,
        done: true,
        metadata,
        autoAnalysis,
      });
    }
  }

  // 情报已最新时，仍尝试补全一次空字段（幂等：已填不覆盖）
  const { applyDocumentMetadataToProject } = await import(
    "@/lib/projects/apply-document-metadata"
  );
  const metadata = await applyDocumentMetadataToProject(projectId).catch(
    () => null,
  );

  const autoAnalysis = await maybeAutoEnqueueOnReady(projectId, user.id);

  return NextResponse.json({
    step: "none",
    remaining: 0,
    done: true,
    metadata,
    autoAnalysis,
  });
});

async function countRemaining(projectId: string): Promise<number> {
  const pendingParse = await db.projectDocument.count({
    where: {
      projectId,
      parseStatus: "pending",
      fileType: { in: ["pdf", "doc", "docx", "xls", "xlsx", "csv", "txt"] },
    },
  });
  const pendingSummary = await db.projectDocument.count({
    where: {
      projectId,
      parseStatus: "done",
      aiSummaryStatus: "pending",
      contentText: { not: null },
    },
  });
  return pendingParse + pendingSummary;
}
