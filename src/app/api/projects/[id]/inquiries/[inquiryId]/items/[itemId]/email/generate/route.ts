import { NextRequest, NextResponse } from "next/server";
import { requireProjectWriteAccess } from "@/lib/projects/access";
import { db } from "@/lib/db";
import { createCompletion } from "@/lib/ai/client";
import { getEmailDraftPrompt, type EmailDraftContext } from "@/lib/ai/prompts";

type Params = {
  params: Promise<{ id: string; inquiryId: string; itemId: string }>;
};

export async function POST(request: NextRequest, { params }: Params) {
  const { id: projectId, inquiryId, itemId } = await params;

  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const item = await db.inquiryItem.findUnique({
    where: { id: itemId },
    include: {
      inquiry: {
        select: {
          id: true,
          projectId: true,
          roundNumber: true,
          title: true,
          scope: true,
          dueDate: true,
        },
      },
      supplier: {
        select: {
          id: true,
          name: true,
          contactName: true,
          contactEmail: true,
          category: true,
          region: true,
        },
      },
    },
  });

  if (!item || item.inquiry.projectId !== projectId || item.inquiry.id !== inquiryId) {
    return NextResponse.json({ error: "询价项不存在" }, { status: 404 });
  }

  if (!item.supplier.contactEmail) {
    return NextResponse.json(
      { error: "该供应商未填写联系邮箱，无法生成邮件" },
      { status: 400 }
    );
  }

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      name: true,
      description: true,
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

  const ctx: EmailDraftContext = {
    project: {
      name: project.name,
      clientOrganization: project.clientOrganization,
      description: project.description,
      solicitationNumber: project.solicitationNumber,
      closeDate: project.closeDate?.toISOString().slice(0, 10) ?? null,
    },
    supplier: {
      name: item.supplier.name,
      contactEmail: item.supplier.contactEmail,
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
    senderName: access.user.name || access.user.email,
    senderOrg: orgName,
  };

  const systemPrompt = getEmailDraftPrompt(ctx);

  try {
    const raw = await createCompletion({
      systemPrompt,
      userPrompt: "请根据以上信息生成询价邮件草稿。",
      mode: "normal",
      temperature: 0.4,
    });

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json(
        { error: "AI 返回格式异常，请重试", raw },
        { status: 502 }
      );
    }

    const draft = JSON.parse(jsonMatch[0]) as { subject: string; body: string };

    if (!draft.subject || !draft.body) {
      return NextResponse.json(
        { error: "AI 返回内容不完整，请重试", raw },
        { status: 502 }
      );
    }

    const email = await db.projectEmail.create({
      data: {
        orgId: project.orgId ?? "",
        projectId,
        inquiryId,
        inquiryItemId: itemId,
        toEmail: item.supplier.contactEmail,
        toName: item.supplier.contactName,
        fromEmail: "",
        subject: draft.subject,
        body: draft.body,
        status: "draft",
        createdById: access.user.id,
      },
    });

    return NextResponse.json({
      emailId: email.id,
      subject: draft.subject,
      body: draft.body,
      toEmail: item.supplier.contactEmail,
      toName: item.supplier.contactName,
      supplierName: item.supplier.name,
    });
  } catch (err) {
    console.error("Email draft generation error:", err);
    return NextResponse.json(
      { error: "邮件草稿生成失败，请稍后重试" },
      { status: 500 }
    );
  }
}
