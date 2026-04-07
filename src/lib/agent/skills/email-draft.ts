/**
 * 邮件草稿 Skill — 为项目中待联系的供应商批量生成询价邮件草稿
 */

import { db } from "@/lib/db";
import { createCompletion } from "@/lib/ai/client";
import { getEmailDraftPrompt } from "@/lib/ai/prompts";
import { registerSkill } from "./registry";
import type { SkillContext, SkillResult } from "../types";

async function execute(ctx: SkillContext): Promise<SkillResult> {
  try {
    const inquiryItemId = ctx.input.inquiryItemId as string | undefined;

    // 单个询价项生成
    if (inquiryItemId) {
      return generateSingleDraft(ctx, inquiryItemId);
    }

    // 批量：找到项目下待处理的询价项
    const items = await db.inquiryItem.findMany({
      where: {
        inquiry: { projectId: ctx.projectId },
        status: "pending",
      },
      select: {
        id: true,
        status: true,
        contactNotes: true,
        supplier: {
          select: { name: true, contactEmail: true, contactName: true, category: true, region: true },
        },
        inquiry: {
          select: {
            roundNumber: true,
            title: true,
            scope: true,
            dueDate: true,
            project: {
              select: {
                name: true,
                clientOrganization: true,
                description: true,
                solicitationNumber: true,
                closeDate: true,
              },
            },
          },
        },
      },
      take: 10,
    });

    if (items.length === 0) {
      return {
        success: true,
        data: { generated: 0 },
        summary: "暂无需要生成草稿的询价项",
      };
    }

    const user = await db.user.findUnique({
      where: { id: ctx.userId },
      select: { name: true },
    });
    const org = await db.organization.findFirst({
      select: { name: true },
    });

    let generated = 0;
    const drafts: Array<{ supplierName: string; draft: string }> = [];

    for (const item of items) {
      try {
        const project = item.inquiry.project;
        const prompt = getEmailDraftPrompt({
          project: {
            name: project.name,
            clientOrganization: project.clientOrganization,
            description: project.description,
            solicitationNumber: project.solicitationNumber,
            closeDate: project.closeDate?.toISOString().slice(0, 10) ?? null,
          },
          supplier: {
            name: item.supplier.name,
            contactEmail: item.supplier.contactEmail ?? "",
            contactName: item.supplier.contactName,
            category: item.supplier.category,
            region: item.supplier.region,
          },
          inquiry: {
            roundNumber: item.inquiry.roundNumber,
            title: item.inquiry.title,
            scope: item.inquiry.scope,
            dueDate: item.inquiry.dueDate?.toISOString().slice(0, 10) ?? null,
          },
          inquiryItem: {
            status: item.status,
            contactNotes: item.contactNotes,
          },
          senderName: user?.name ?? "青砚用户",
          senderOrg: org?.name ?? null,
        });

        const draft = await createCompletion({
          systemPrompt: "你是专业的商务邮件草稿助手。只输出邮件正文，不要输出 JSON 或其他格式。",
          userPrompt: prompt,
          mode: "normal",
          maxTokens: 1500,
        });

        drafts.push({ supplierName: item.supplier.name, draft });
        generated++;
      } catch {
        // 单封失败不影响其他
      }
    }

    return {
      success: true,
      data: { total: items.length, generated, drafts },
      summary: `已为 ${generated}/${items.length} 个供应商生成邮件草稿`,
    };
  } catch (err) {
    return {
      success: false,
      data: {},
      summary: "邮件草稿生成失败",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function generateSingleDraft(
  ctx: SkillContext,
  inquiryItemId: string,
): Promise<SkillResult> {
  const item = await db.inquiryItem.findUnique({
    where: { id: inquiryItemId },
    select: {
      id: true,
      status: true,
      contactNotes: true,
      supplier: {
        select: { name: true, contactEmail: true, contactName: true, category: true, region: true },
      },
      inquiry: {
        select: {
          roundNumber: true,
          title: true,
          scope: true,
          dueDate: true,
          project: {
            select: {
              name: true,
              clientOrganization: true,
              description: true,
              solicitationNumber: true,
              closeDate: true,
            },
          },
        },
      },
    },
  });

  if (!item) {
    return { success: false, data: {}, summary: "询价项不存在" };
  }

  const user = await db.user.findUnique({
    where: { id: ctx.userId },
    select: { name: true },
  });
  const org = await db.organization.findFirst({ select: { name: true } });

  const project = item.inquiry.project;
  const prompt = getEmailDraftPrompt({
    project: {
      name: project.name,
      clientOrganization: project.clientOrganization,
      description: project.description,
      solicitationNumber: project.solicitationNumber,
      closeDate: project.closeDate?.toISOString().slice(0, 10) ?? null,
    },
    supplier: {
      name: item.supplier.name,
      contactEmail: item.supplier.contactEmail ?? "",
      contactName: item.supplier.contactName,
      category: item.supplier.category,
      region: item.supplier.region,
    },
    inquiry: {
      roundNumber: item.inquiry.roundNumber,
      title: item.inquiry.title,
      scope: item.inquiry.scope,
      dueDate: item.inquiry.dueDate?.toISOString().slice(0, 10) ?? null,
    },
    inquiryItem: {
      status: item.status,
      contactNotes: item.contactNotes,
    },
    senderName: user?.name ?? "青砚用户",
    senderOrg: org?.name ?? null,
  });

  const draft = await createCompletion({
    systemPrompt: "你是专业的商务邮件草稿助手。只输出邮件正文，不要输出 JSON 或其他格式。",
    userPrompt: prompt,
    mode: "normal",
    maxTokens: 1500,
  });

  return {
    success: true,
    data: { draft, supplierName: item.supplier.name },
    summary: `已为「${item.supplier.name}」生成邮件草稿`,
  };
}

registerSkill({
  id: "email_draft",
  name: "询价邮件草稿",
  domain: "email",
  tier: "execution",
  version: "1.0.0",
  description: "为项目中待联系的供应商批量或单独生成询价邮件草稿",
  actions: ["generate", "batch_generate"],
  riskLevel: "medium",
  requiresApproval: true,
  inputSchema: {
    inquiryItemId: "string（可选，不传则批量生成）",
  },
  outputSchema: {
    draft: "string（单个模式）",
    total: "number（批量模式）",
    generated: "number（批量模式）",
  },
  execute,
});
