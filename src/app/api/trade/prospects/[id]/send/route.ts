/**
 * POST /api/trade/prospects/[id]/send
 *
 * 发送开发信（Resend）或标记为已发送（手动发送场景）
 * body: { mode: "send" | "mark_sent" }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { getProspect, updateProspect, createMessage } from "@/lib/trade/service";
import { sendEmail } from "@/lib/trade/email";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const prospect = await getProspect(id);
  if (!prospect) {
    return NextResponse.json({ error: "线索不存在" }, { status: 404 });
  }

  if (!prospect.outreachSubject || !prospect.outreachBody) {
    return NextResponse.json(
      { error: "请先生成开发信草稿" },
      { status: 400 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const mode = body.mode ?? "mark_sent";
  const now = new Date();

  if (mode === "send" && prospect.contactEmail) {
    const result = await sendEmail({
      to: prospect.contactEmail,
      subject: prospect.outreachSubject,
      body: prospect.outreachBody,
      replyTo: body.replyTo,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: `发送失败: ${result.error}` },
        { status: 500 },
      );
    }
  }

  await createMessage({
    prospectId: id,
    direction: "outbound",
    channel: "email",
    subject: prospect.outreachSubject,
    content: prospect.outreachBody,
  });

  const threeDaysLater = new Date(now);
  threeDaysLater.setDate(threeDaysLater.getDate() + 3);

  await updateProspect(id, {
    stage: "outreach_sent",
    outreachSentAt: now,
    lastContactAt: now,
    nextFollowUpAt: threeDaysLater,
  });

  return NextResponse.json({
    success: true,
    mode,
    nextFollowUpAt: threeDaysLater.toISOString(),
  });
}
