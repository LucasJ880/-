import { NextRequest, NextResponse } from "next/server";
import { requireProjectWriteAccess } from "@/lib/projects/access";
import { db } from "@/lib/db";
import { sendGmail, getEmailProvider } from "@/lib/google-email";
import { onEmailSent } from "@/lib/project-discussion/system-events";

type Params = { params: Promise<{ id: string; questionId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id: projectId, questionId } = await params;
  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const question = await db.projectQuestion.findUnique({
    where: { id: questionId },
  });

  if (!question || question.projectId !== projectId) {
    return NextResponse.json({ error: "问题记录不存在" }, { status: 404 });
  }

  if (question.status === "sent") {
    return NextResponse.json({ error: "该邮件已发送" }, { status: 409 });
  }

  const toEmail = ((body.toRecipients as string) || question.toRecipients)?.trim();
  if (!toEmail) {
    return NextResponse.json({ error: "收件人不能为空" }, { status: 400 });
  }

  const subject = ((body.subject as string) || question.generatedSubject)?.trim();
  const htmlBody = ((body.body as string) || question.generatedBody)?.trim();
  if (!subject || !htmlBody) {
    return NextResponse.json({ error: "邮件主题和正文不能为空" }, { status: 400 });
  }

  const ccRecipients = ((body.ccRecipients as string) || question.ccRecipients)?.trim() || null;

  const provider = await getEmailProvider(access.user.id);
  if (!provider) {
    return NextResponse.json(
      { error: "你尚未绑定 Gmail 邮件服务，请在设置页绑定后重试" },
      { status: 400 }
    );
  }

  const emailRecord = await db.projectEmail.create({
    data: {
      orgId: question.orgId || "",
      projectId,
      toEmail,
      toName: null,
      fromEmail: provider.accountEmail,
      subject,
      body: htmlBody,
      status: "sending",
      createdById: access.user.id,
      sentById: access.user.id,
    },
  });

  try {
    const result = await sendGmail(access.user.id, {
      to: toEmail,
      from: provider.accountEmail,
      subject,
      body: htmlBody,
    });

    await db.projectEmail.update({
      where: { id: emailRecord.id },
      data: {
        status: "sent",
        externalMessageId: result.messageId,
        sentAt: new Date(),
      },
    });

    await db.projectQuestion.update({
      where: { id: questionId },
      data: {
        status: "sent",
        emailId: emailRecord.id,
        toRecipients: toEmail,
        ccRecipients,
        generatedSubject: subject,
        generatedBody: htmlBody,
      },
    });

    await onEmailSent(
      projectId,
      emailRecord.id,
      toEmail,
      null,
      question.title,
      subject,
      access.user.id,
      access.user.name || access.user.email
    );

    return NextResponse.json({
      success: true,
      questionId,
      emailId: emailRecord.id,
      externalMessageId: result.messageId,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "发送失败";
    await db.projectEmail.update({
      where: { id: emailRecord.id },
      data: { status: "failed", errorMessage },
    });
    console.error("[project-question] send error:", err);
    return NextResponse.json(
      { error: `邮件发送失败：${errorMessage}` },
      { status: 502 }
    );
  }
}
