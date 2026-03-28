import { NextRequest, NextResponse } from "next/server";
import { requireProjectWriteAccess, requireProjectReadAccess } from "@/lib/projects/access";
import { db } from "@/lib/db";
import { createCompletion } from "@/lib/ai/client";
import { isAIConfigured } from "@/lib/ai/config";
import {
  getProjectQuestionEmailPrompt,
  type ProjectQuestionEmailContext,
} from "@/lib/ai/prompts";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";

type Params = { params: Promise<{ id: string }> };

// ── GET: 列出项目下所有问题 ─────────────────────────────────

export async function GET(request: NextRequest, { params }: Params) {
  const { id: projectId } = await params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const questions = await db.projectQuestion.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(questions);
}

// ── POST: 创建问题 + AI 生成邮件草稿 ─────────────────────────

export async function POST(request: NextRequest, { params }: Params) {
  const { id: projectId } = await params;
  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  if (!isAIConfigured()) {
    return NextResponse.json({ error: "AI 功能未配置" }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const title = (body.title as string)?.trim();
  const description = (body.description as string)?.trim();
  if (!title || !description) {
    return NextResponse.json(
      { error: "问题标题和描述不能为空" },
      { status: 400 }
    );
  }

  const locationOrReference = (body.locationOrReference as string)?.trim() || null;
  const clarificationNeeded = (body.clarificationNeeded as string)?.trim() || null;
  const impactNote = (body.impactNote as string)?.trim() || null;
  const toRecipients = (body.toRecipients as string)?.trim() || null;
  const ccRecipients = (body.ccRecipients as string)?.trim() || null;

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      name: true,
      description: true,
      solicitationNumber: true,
      clientOrganization: true,
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

  const ctx: ProjectQuestionEmailContext = {
    project: {
      name: project.name,
      solicitationNumber: project.solicitationNumber ?? null,
      clientOrganization: project.clientOrganization ?? null,
      description: project.description,
    },
    question: {
      title,
      description,
      locationOrReference,
      clarificationNeeded,
      impactNote,
    },
    senderName: access.user.name || access.user.email,
    senderOrg: orgName,
    toRecipients,
  };

  try {
    const systemPrompt = getProjectQuestionEmailPrompt(ctx);
    const raw = await createCompletion({
      systemPrompt,
      userPrompt: `Please generate the clarification email for the issue described above.`,
      mode: "normal",
      temperature: 0.3,
    });

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json(
        { error: "AI 返回格式异常，请重试" },
        { status: 502 }
      );
    }

    const { subject, body: emailBody } = JSON.parse(jsonMatch[0]) as {
      subject: string;
      body: string;
    };

    const question = await db.projectQuestion.create({
      data: {
        projectId,
        orgId: project.orgId,
        title,
        description,
        locationOrReference,
        clarificationNeeded,
        impactNote,
        generatedSubject: subject,
        generatedBody: emailBody,
        toRecipients,
        ccRecipients,
        status: "generated",
        createdById: access.user.id,
      },
    });

    await logAudit({
      userId: access.user.id,
      orgId: project.orgId,
      projectId,
      action: AUDIT_ACTIONS.AI_GENERATE,
      targetType: AUDIT_TARGETS.PROJECT_QUESTION,
      targetId: question.id,
      afterData: { title, subject },
      request,
    });

    return NextResponse.json(question);
  } catch (err) {
    console.error("[project-question] generate error:", err);
    return NextResponse.json(
      { error: "生成邮件草稿失败，请稍后重试" },
      { status: 500 }
    );
  }
}
