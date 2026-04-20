import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { getEmailProvider } from "@/lib/google-email";

/**
 * GET /api/sales/email-status
 *
 * 返回销售账号的邮件绑定综合状态 —— 两个通道：
 *  - gmail: Google OAuth 一键授权（推荐）
 *  - smtp:  用户手填 SMTP + App Password（兜底）
 *
 * 前端据此显示"当前生效通道"并决定是否展示 SMTP 高级配置。
 */
export const GET = withAuth(async (_req, _ctx, user) => {
  const [provider, binding] = await Promise.all([
    getEmailProvider(user.id),
    db.emailBinding.findUnique({
      where: { userId: user.id },
      select: {
        id: true,
        email: true,
        displayName: true,
        verified: true,
        verifiedAt: true,
        lastSentAt: true,
        lastError: true,
      },
    }),
  ]);

  const gmail = provider && provider.accessToken
    ? {
        connected: true,
        email: provider.accountEmail,
        grantedScopes: provider.grantedScopes,
      }
    : { connected: false as const };

  const smtp = binding
    ? {
        configured: true,
        email: binding.email,
        displayName: binding.displayName,
        verified: binding.verified,
        verifiedAt: binding.verifiedAt,
        lastSentAt: binding.lastSentAt,
        lastError: binding.lastError,
      }
    : { configured: false as const };

  // 实际发信时会按 gmail → smtp 的顺序选择
  const activeChannel: "gmail" | "smtp" | null = gmail.connected
    ? "gmail"
    : smtp.configured && smtp.verified
    ? "smtp"
    : null;

  return NextResponse.json({ gmail, smtp, activeChannel });
});
