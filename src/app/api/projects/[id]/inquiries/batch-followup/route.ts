import { NextRequest, NextResponse } from "next/server";
import { requireProjectWriteAccess } from "@/lib/projects/access";
import { db } from "@/lib/db";
import { createCompletion } from "@/lib/ai/client";
import { isAIConfigured } from "@/lib/ai/config";
import {
  getFollowupEmailPrompt,
  type FollowupEmailContext,
} from "@/lib/ai/prompts";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";

type Params = { params: Promise<{ id: string }> };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * POST /api/projects/[id]/inquiries/batch-followup
 *
 * 多步串联第一步：识别未回复供应商 → 批量生成催促邮件草稿
 * 返回草稿列表供前端批量审核。
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { id: projectId } = await params;
  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  if (!isAIConfigured()) {
    return NextResponse.json({ error: "AI 功能未配置" }, { status: 503 });
  }

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      name: true,
      clientOrganization: true,
      solicitationNumber: true,
      closeDate: true,
      orgId: true,
    },
  });
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  let orgName: string | null = null;
  if (project.orgId) {
    const org = await db.organization.findUnique({
      where: { id: project.orgId },
      select: { name: true },
    });
    orgName = org?.name ?? null;
  }

  const now = new Date();
  const threeDaysAgo = new Date(now.getTime() - 3 * DAY_MS);

  const pendingItems = await db.inquiryItem.findMany({
    where: {
      inquiry: { projectId },
      status: { in: ["pending", "contacted"] },
      createdAt: { lt: threeDaysAgo },
    },
    include: {
      supplier: {
        select: {
          id: true,
          name: true,
          contactName: true,
          contactEmail: true,
          category: true,
        },
      },
      inquiry: {
        select: {
          id: true,
          roundNumber: true,
          title: true,
          dueDate: true,
        },
      },
    },
    take: 10,
  });

  if (pendingItems.length === 0) {
    return NextResponse.json({
      drafts: [],
      message: "没有超过 3 天未回复的供应商",
    });
  }

  const drafts: Array<{
    supplierId: string;
    supplierName: string;
    contactEmail: string;
    subject: string;
    body: string;
    daysSinceContact: number;
    inquiryItemId: string;
    inquiryId: string;
  }> = [];

  const errors: Array<{ supplierName: string; error: string }> = [];

  for (const item of pendingItems) {
    if (!item.supplier.contactEmail) {
      errors.push({
        supplierName: item.supplier.name,
        error: "无联系邮箱",
      });
      continue;
    }

    const daysSinceContact = Math.floor(
      (now.getTime() - item.createdAt.getTime()) / DAY_MS
    );

    const ctx: FollowupEmailContext = {
      project: {
        name: project.name,
        clientOrganization: project.clientOrganization,
        solicitationNumber: project.solicitationNumber,
        closeDate: project.closeDate?.toISOString().slice(0, 10) ?? null,
      },
      supplier: {
        name: item.supplier.name,
        contactName: item.supplier.contactName,
        contactEmail: item.supplier.contactEmail,
        category: item.supplier.category,
      },
      inquiry: {
        roundNumber: item.inquiry.roundNumber,
        title: item.inquiry.title,
        dueDate: item.inquiry.dueDate?.toISOString().slice(0, 10) ?? null,
      },
      daysSinceContact,
      senderName: access.user.name || access.user.email,
      senderOrg: orgName,
    };

    try {
      const raw = await createCompletion({
        systemPrompt: getFollowupEmailPrompt(ctx),
        userPrompt: "请生成催促邮件草稿。",
        mode: "normal",
        temperature: 0.3,
      });

      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        errors.push({ supplierName: item.supplier.name, error: "AI 格式异常" });
        continue;
      }

      const { subject, body } = JSON.parse(jsonMatch[0]) as {
        subject: string;
        body: string;
      };

      drafts.push({
        supplierId: item.supplier.id,
        supplierName: item.supplier.name,
        contactEmail: item.supplier.contactEmail,
        subject,
        body,
        daysSinceContact,
        inquiryItemId: item.id,
        inquiryId: item.inquiry.id ?? "",
      });
    } catch (err) {
      errors.push({
        supplierName: item.supplier.name,
        error: err instanceof Error ? err.message : "生成失败",
      });
    }
  }

  await logAudit({
    userId: access.user.id,
    orgId: project.orgId,
    projectId,
    action: AUDIT_ACTIONS.AI_GENERATE,
    targetType: AUDIT_TARGETS.PROJECT_EMAIL,
    afterData: {
      type: "batch_followup",
      draftCount: drafts.length,
      errorCount: errors.length,
    },
    request,
  });

  return NextResponse.json({
    drafts,
    errors,
    totalPending: pendingItems.length,
    generatedAt: now.toISOString(),
  });
}
