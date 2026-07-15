import { NextResponse } from "next/server";
import { withAuth, safeParseBody } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { sendSalesEmail } from "@/lib/email/sender";
import { canSeeVisualizerSession } from "@/lib/visualizer/access";
import { isShareLive } from "@/lib/visualizer/share";

type EmailShareBody = { to?: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[char] ?? char;
  });
}

export const POST = withAuth(async (request, ctx, user) => {
  const { id } = await ctx.params;
  const body = await safeParseBody<EmailShareBody>(request);
  const to = body?.to?.trim().toLowerCase() ?? "";
  if (!EMAIL_RE.test(to) || to.length > 254) {
    return NextResponse.json({ error: "请输入有效的客户邮箱" }, { status: 400 });
  }

  const session = await db.visualizerSession.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      createdById: true,
      salesOwnerId: true,
      shareToken: true,
      shareExpiresAt: true,
      customer: { select: { name: true, createdById: true } },
    },
  });
  if (!session) {
    return NextResponse.json({ error: "可视化方案不存在" }, { status: 404 });
  }
  if (!canSeeVisualizerSession(session, user)) {
    return NextResponse.json({ error: "无权发送该方案" }, { status: 403 });
  }
  if (!isShareLive(session.shareToken, session.shareExpiresAt)) {
    return NextResponse.json({ error: "分享链接尚未生成或已经过期" }, { status: 409 });
  }

  const origin = new URL(request.url).origin;
  const shareUrl = `${origin}/sales/share/visualizer/${session.shareToken}`;
  const customerName = escapeHtml(session.customer.name);
  const title = escapeHtml(session.title);
  const safeUrl = escapeHtml(shareUrl);
  const expiresAt = session.shareExpiresAt!.toLocaleDateString("zh-CN");
  const result = await sendSalesEmail(user.id, {
    to,
    subject: `${session.customer.name} - 窗饰效果方案`,
    text: `${session.customer.name}，您好。您的窗饰效果方案已经准备好：${shareUrl}。链接有效期至 ${expiresAt}。`,
    html: [
      `<p>${customerName}，您好：</p>`,
      `<p>您的窗饰效果方案“${title}”已经准备好。您可以查看不同方案，并标记喜欢的款式。</p>`,
      `<p><a href="${safeUrl}" style="display:inline-block;padding:10px 16px;background:#111827;color:#ffffff;text-decoration:none;border-radius:6px">查看效果方案</a></p>`,
      `<p style="color:#6b7280;font-size:12px">链接有效期至 ${expiresAt}。效果图用于选型参考，最终颜色和尺寸以实物样品及正式报价为准。</p>`,
    ].join(""),
  });
  if (!result.success) {
    return NextResponse.json({ error: result.error ?? "邮件发送失败" }, { status: 502 });
  }

  return NextResponse.json({ ok: true, messageId: result.messageId, channel: result.channel });
});
