/**
 * AI 邮件作曲 API
 *
 * POST /api/sales/email-compose
 *   → 生成邮件预览
 *
 * POST /api/sales/email-compose?action=send-approved
 *   → 发送销售已审阅的草稿
 *
 * POST /api/sales/email-compose?action=refine
 *   body 额外字段: { currentSubject, currentHtml, refinement }
 *   → AI 根据用户指令优化现有邮件
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import {
  assertSalesCustomerInOrgForMutation,
  resolveSalesOrgIdForRequest,
} from "@/lib/sales/org-context";
import {
  composeEmail,
  sendSalesEmail,
  refineEmail,
  type ComposedEmail,
  type EmailScene,
} from "@/lib/sales/email-composer";

export const POST = withAuth(async (request, _ctx, user) => {
  const action = new URL(request.url).searchParams.get("action");
  const body = await request.json();
  const rawBody = body as Record<string, unknown>;

  if (action === "refine") {
    const orgRes = await resolveSalesOrgIdForRequest(request as NextRequest, user, {
      bodyOrgId: typeof rawBody.orgId === "string" ? rawBody.orgId : null,
    });
    if (!orgRes.ok) return orgRes.response;

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

  const orgRes = await resolveSalesOrgIdForRequest(request as NextRequest, user, {
    bodyOrgId: typeof rawBody.orgId === "string" ? rawBody.orgId : null,
  });
  if (!orgRes.ok) return orgRes.response;
  const requestOrgId = orgRes.orgId;

  const {
    customerId,
    scene,
    quoteId,
    productFilter,
    extraInstructions,
    approvedSubject,
    approvedHtml,
  } = body as {
    customerId: string;
    scene: EmailScene;
    quoteId?: string;
    productFilter?: string;
    extraInstructions?: string;
    approvedSubject?: string;
    approvedHtml?: string;
  };

  if (!customerId || !scene) {
    return NextResponse.json(
      { error: "customerId 和 scene 不能为空" },
      { status: 400 },
    );
  }

  const customerRow = await db.salesCustomer.findFirst({
    where: { id: customerId, archivedAt: null },
    select: { id: true, orgId: true, createdById: true, email: true },
  });
  if (!customerRow) {
    return NextResponse.json({ error: "客户不存在" }, { status: 404 });
  }
  const custDenied = await assertSalesCustomerInOrgForMutation(customerRow, requestOrgId, {
    user,
    permission: "sales.customer.read",
  });
  if (custDenied) return custDenied;

  try {
    let email: ComposedEmail;

    if (action === "send-approved") {
      const subject = approvedSubject?.trim();
      const html = approvedHtml?.trim();
      if (!customerRow.email) {
        return NextResponse.json({ error: "客户没有可用的邮箱地址" }, { status: 400 });
      }
      if (!subject || !html) {
        return NextResponse.json({ error: "请先审阅邮件主题和正文" }, { status: 400 });
      }
      if (subject.length > 200 || html.length > 100_000) {
        return NextResponse.json({ error: "邮件内容超出允许长度" }, { status: 400 });
      }
      if (/<script\b|javascript:|\son\w+\s*=/i.test(html)) {
        return NextResponse.json({ error: "邮件正文包含不允许的内容" }, { status: 400 });
      }

      email = {
        to: customerRow.email,
        subject,
        html,
        text: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        scene,
        quoteId,
      };
    } else {
      email = await composeEmail({
        userId: user.id,
        customerId,
        scene,
        quoteId,
        productFilter,
        extraInstructions,
      });
    }

    if (action === "send-approved") {
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
          orgId: requestOrgId,
          customerId,
          type: "email",
          direction: "outbound",
          summary: `销售审阅的 ${scene} 邮件已发送 — ${email.subject}`,
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
