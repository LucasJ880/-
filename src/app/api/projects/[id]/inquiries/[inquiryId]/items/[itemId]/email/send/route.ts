import { NextRequest, NextResponse } from "next/server";
import { requireProjectWriteAccess } from "@/lib/projects/access";
import { db } from "@/lib/db";
import { sendGmail, getEmailProvider } from "@/lib/google-email";
import { onEmailSent } from "@/lib/project-discussion/system-events";

type Params = {
  params: Promise<{ id: string; inquiryId: string; itemId: string }>;
};

export async function POST(request: NextRequest, { params }: Params) {
  const { id: projectId, inquiryId, itemId } = await params;

  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const body = await request.json().catch(() => null);
  const emailId = body?.emailId as string | undefined;

  if (!emailId) {
    return NextResponse.json({ error: "缺少 emailId" }, { status: 400 });
  }

  const email = await db.projectEmail.findUnique({ where: { id: emailId } });
  if (
    !email ||
    email.projectId !== projectId ||
    email.inquiryId !== inquiryId ||
    email.inquiryItemId !== itemId
  ) {
    return NextResponse.json({ error: "邮件记录不存在" }, { status: 404 });
  }

  if (email.status === "sent") {
    return NextResponse.json({ error: "该邮件已发送，不可重复发送" }, { status: 409 });
  }

  const provider = await getEmailProvider(access.user.id);
  if (!provider) {
    return NextResponse.json(
      { error: "你尚未绑定 Gmail 邮件服务，请在设置页绑定后重试" },
      { status: 400 }
    );
  }

  const subject = (body?.subject as string) || email.subject;
  const htmlBody = (body?.body as string) || email.body;

  await db.projectEmail.update({
    where: { id: emailId },
    data: {
      status: "sending",
      subject,
      body: htmlBody,
      fromEmail: provider.accountEmail,
      sentById: access.user.id,
    },
  });

  try {
    const result = await sendGmail(access.user.id, {
      to: email.toEmail,
      from: provider.accountEmail,
      subject,
      body: htmlBody,
    });

    await db.projectEmail.update({
      where: { id: emailId },
      data: {
        status: "sent",
        externalMessageId: result.messageId,
        sentAt: new Date(),
      },
    });

    const item = await db.inquiryItem.findUnique({
      where: { id: itemId },
      include: { supplier: { select: { name: true } } },
    });

    await onEmailSent(
      projectId,
      emailId,
      email.toEmail,
      email.toName,
      item?.supplier.name ?? "未知供应商",
      subject,
      access.user.id,
      access.user.name || access.user.email
    );

    return NextResponse.json({
      success: true,
      emailId,
      externalMessageId: result.messageId,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "发送失败";
    await db.projectEmail.update({
      where: { id: emailId },
      data: { status: "failed", errorMessage },
    });
    console.error("Gmail send error:", err);
    return NextResponse.json({ error: `邮件发送失败：${errorMessage}` }, { status: 502 });
  }
}
