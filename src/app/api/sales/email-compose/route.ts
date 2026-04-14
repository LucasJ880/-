/**
 * AI 邮件作曲 API
 *
 * POST /api/sales/email-compose
 *   → 生成邮件预览
 *
 * POST /api/sales/email-compose?action=send
 *   → 生成 + 立即发送
 *
 * POST /api/sales/email-compose?action=refine
 *   body 额外字段: { currentSubject, currentHtml, refinement }
 *   → AI 根据用户指令优化现有邮件
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import {
  composeEmail,
  sendSalesEmail,
  refineEmail,
  type EmailScene,
} from "@/lib/sales/email-composer";

export const POST = withAuth(async (request, _ctx, user) => {
  const action = new URL(request.url).searchParams.get("action");
  const body = await request.json();

  if (action === "refine") {
    const { currentSubject, currentHtml, refinement } = body as {
      currentSubject: string;
      currentHtml: string;
      refinement: string;
    };

    if (!currentHtml || !refinement) {
      return NextResponse.json({ error: "需要提供现有邮件和修改指令" }, { status: 400 });
    }

    try {
      const refined = await refineEmail({ currentSubject, currentHtml, refinement });
      return NextResponse.json({ email: refined });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "优化失败" },
        { status: 500 },
      );
    }
  }

  const {
    customerId,
    scene,
    quoteId,
    productFilter,
    extraInstructions,
  } = body as {
    customerId: string;
    scene: EmailScene;
    quoteId?: string;
    productFilter?: string;
    extraInstructions?: string;
  };

  if (!customerId || !scene) {
    return NextResponse.json(
      { error: "customerId 和 scene 不能为空" },
      { status: 400 },
    );
  }

  try {
    const email = await composeEmail({
      userId: user.id,
      customerId,
      scene,
      quoteId,
      productFilter,
      extraInstructions,
    });

    if (action === "send") {
      const result = await sendSalesEmail(user.id, email);

      if (!result.success) {
        return NextResponse.json(
          { error: result.error, email },
          { status: 500 },
        );
      }

      if (email.quoteId) {
        await db.salesQuote.update({
          where: { id: email.quoteId },
          data: { status: "sent", sentAt: new Date(), emailMessageId: result.messageId || null },
        }).catch(() => {});
      }

      await db.customerInteraction.create({
        data: {
          customerId,
          type: "email",
          direction: "outbound",
          summary: `AI 生成 ${scene} 邮件已发送 — ${email.subject}`,
          emailMessageId: result.messageId || null,
          createdById: user.id,
        },
      }).catch(() => {});

      return NextResponse.json({
        sent: true,
        messageId: result.messageId,
        method: result.method,
        email: { to: email.to, subject: email.subject, scene: email.scene },
      });
    }

    return NextResponse.json({
      email: {
        to: email.to,
        subject: email.subject,
        html: email.html,
        text: email.text,
        scene: email.scene,
        quoteId: email.quoteId,
        shareUrl: email.shareUrl,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "生成邮件失败" },
      { status: 500 },
    );
  }
});
