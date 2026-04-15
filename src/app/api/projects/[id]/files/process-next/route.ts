import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { parseAndStoreContent } from "@/lib/files/parse-content";
import { generateDocumentSummary } from "@/lib/files/ai-summary";
import { generateProjectIntelligence } from "@/lib/files/ai-intelligence";

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
export const POST = withAuth(async (request, ctx) => {
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
    return NextResponse.json({
      step: "ai_summary_skip",
      documentId: pendingSummary.id,
      remaining,
      done: remaining === 0,
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
      return NextResponse.json({
        step: "intelligence",
        remaining: 0,
        done: true,
      });
    }
  }

  return NextResponse.json({ step: "none", remaining: 0, done: true });
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
