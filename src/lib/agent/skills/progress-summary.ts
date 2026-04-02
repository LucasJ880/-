/**
 * 进展摘要 Skill — 生成项目进展摘要报告
 */

import { db } from "@/lib/db";
import { createCompletion } from "@/lib/ai/client";
import { getProgressSummaryPrompt } from "@/lib/ai/prompts";
import { formatDateTimeToronto } from "@/lib/time";
import { registerSkill } from "./registry";
import type { SkillContext, SkillResult } from "../types";

async function execute(ctx: SkillContext): Promise<SkillResult> {
  try {
    const project = await db.project.findUnique({
      where: { id: ctx.projectId },
      include: {
        tasks: {
          select: { title: true, status: true, priority: true, dueDate: true },
          orderBy: { updatedAt: "desc" },
          take: 20,
        },
        members: {
          include: { user: { select: { name: true } } },
        },
        documents: {
          select: { title: true, fileType: true, contentText: true, parseStatus: true },
          take: 10,
        },
        inquiries: {
          include: {
            items: { select: { status: true, supplier: { select: { name: true } } } },
          },
          take: 5,
        },
      },
    });

    if (!project) {
      return { success: false, data: {}, summary: "项目不存在", error: "Project not found" };
    }

    const discussion = await db.projectMessage.findMany({
      where: { conversation: { projectId: ctx.projectId } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        body: true,
        type: true,
        createdAt: true,
        sender: { select: { name: true } },
      },
    });

    const taskStats = {
      total: project.tasks.length,
      done: project.tasks.filter((t) => t.status === "done").length,
      overdue: project.tasks.filter(
        (t) => t.dueDate && t.dueDate < new Date() && t.status !== "done"
      ).length,
    };

    const promptCtx = {
      project: {
        name: project.name,
        clientOrganization: project.clientOrganization,
        tenderStatus: project.tenderStatus,
        priority: project.priority,
        closeDate: project.closeDate?.toISOString().slice(0, 10) ?? null,
        location: project.location,
        estimatedValue: project.estimatedValue,
        currency: project.currency,
        description: project.description,
      },
      taskStats,
      recentDiscussion: discussion.map((d) => ({
        sender: d.sender?.name ?? "系统",
        body: d.body.slice(0, 200),
        createdAt: formatDateTimeToronto(d.createdAt),
        type: d.type,
      })),
      inquiries: project.inquiries.map((inq) => ({
        roundNumber: inq.roundNumber,
        status: inq.status,
        itemCount: inq.items.length,
        quotedCount: inq.items.filter((i) => i.status === "quoted").length,
        selectedSupplier: null,
      })),
      members: project.members.map((m) => ({
        name: m.user.name,
        role: m.role,
      })),
      documents: project.documents.map((d) => ({
        title: d.title,
        fileType: d.fileType,
        contentText: d.contentText,
        parseStatus: d.parseStatus,
      })),
    };

    const prompt = getProgressSummaryPrompt(promptCtx);
    const summaryText = await createCompletion({
      systemPrompt: "你是项目进展分析师。用简洁的中文输出项目进展摘要。",
      userPrompt: prompt,
      mode: "normal",
      maxTokens: 2000,
    });

    return {
      success: true,
      data: {
        summaryText,
        taskStats,
        inquiryCount: project.inquiries.length,
      },
      summary: `项目摘要已生成：${taskStats.total} 个任务（${taskStats.done} 完成，${taskStats.overdue} 逾期）`,
    };
  } catch (err) {
    return {
      success: false,
      data: {},
      summary: "进展摘要生成失败",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

registerSkill({
  id: "progress_summary",
  name: "进展摘要",
  domain: "report",
  description: "聚合项目任务、询价、讨论、文档等数据，生成结构化的项目进展摘要报告",
  riskLevel: "low",
  requiresApproval: false,
  inputDescription: "projectId",
  outputDescription: "summaryText, taskStats, inquiryCount",
  execute,
});
