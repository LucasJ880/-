/**
 * 文档摘要 Skill — 批量为项目未解析文档生成 AI 结构化摘要
 */

import { generateDocumentSummary } from "@/lib/files/ai-summary";
import { db } from "@/lib/db";
import { registerSkill } from "./registry";
import type { SkillContext, SkillResult } from "../types";

async function execute(ctx: SkillContext): Promise<SkillResult> {
  try {
    const docs = await db.projectDocument.findMany({
      where: {
        projectId: ctx.projectId,
        parseStatus: "done",
        aiSummaryStatus: { in: [null, "pending", "failed"] },
      },
      select: { id: true, title: true },
      take: 10,
    });

    if (docs.length === 0) {
      return {
        success: true,
        data: { processed: 0 },
        summary: "所有文档已有摘要，无需处理",
      };
    }

    let successCount = 0;
    let failCount = 0;

    for (const doc of docs) {
      try {
        await generateDocumentSummary(doc.id);
        successCount++;
      } catch {
        failCount++;
      }
    }

    return {
      success: true,
      data: { total: docs.length, success: successCount, failed: failCount },
      summary: `文档摘要完成：${successCount}/${docs.length} 篇成功${failCount > 0 ? `，${failCount} 篇失败` : ""}`,
    };
  } catch (err) {
    return {
      success: false,
      data: {},
      summary: "文档摘要批量处理失败",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

registerSkill({
  id: "document_summary",
  name: "文档摘要",
  domain: "analysis",
  tier: "foundation",
  version: "1.0.0",
  description: "批量为项目文档生成 AI 结构化摘要（项目名、甲方、预算、技术要求、风险等）",
  actions: ["batch_generate"],
  riskLevel: "low",
  requiresApproval: false,
  inputSchema: { projectId: "string" },
  outputSchema: {
    total: "number",
    success: "number",
    failed: "number",
  },
  dependsOn: [],
  execute,
});
