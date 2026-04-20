/**
 * AI 邮件作曲家 — 根据销售场景自动生成邮件
 *
 * 场景支持：
 * 1. quote_initial   — 首次发送报价
 * 2. quote_followup  — 报价未回复跟进
 * 3. quote_viewed     — 客户已查看但未签约
 * 4. quote_resend    — 重新发送报价
 * 5. general_followup — 通用跟进
 */

import { db } from "@/lib/db";
import { runSimple } from "@/lib/agent-core/engine";

export type EmailScene =
  | "quote_initial"
  | "quote_followup"
  | "quote_viewed"
  | "quote_resend"
  | "general_followup";

export interface ComposedEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  scene: EmailScene;
  quoteId?: string;
  shareUrl?: string;
}

interface ComposeContext {
  userId: string;
  customerId: string;
  scene: EmailScene;
  quoteId?: string;
  productFilter?: string;
  extraInstructions?: string;
}

export async function composeEmail(ctx: ComposeContext): Promise<ComposedEmail> {
  const customer = await db.salesCustomer.findUnique({
    where: { id: ctx.customerId },
    select: { name: true, email: true },
  });

  if (!customer?.email) {
    throw new Error(`客户 ${customer?.name || ctx.customerId} 没有邮箱地址`);
  }

  // 查找报价
  let quote = null;
  if (ctx.quoteId) {
    quote = await db.salesQuote.findUnique({
      where: { id: ctx.quoteId },
      include: {
        items: { select: { product: true, fabric: true, price: true, location: true } },
        createdBy: { select: { name: true } },
      },
    });
  } else {
    // 自动查找最新的匹配报价
    const quotes = await db.salesQuote.findMany({
      where: { customerId: ctx.customerId },
      include: {
        items: { select: { product: true, fabric: true, price: true, location: true } },
        createdBy: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    });

    if (ctx.productFilter) {
      const pf = ctx.productFilter.toLowerCase();
      quote = quotes.find((q) =>
        q.items.some((i) => i.product.toLowerCase().includes(pf)),
      ) || quotes[0];
    } else {
      quote = quotes[0];
    }
  }

  // 获取销售信息
  const salesUser = await db.user.findUnique({
    where: { id: ctx.userId },
    select: { name: true },
  });

  // 获取最近互动记录
  const recentInteractions = await db.customerInteraction.findMany({
    where: { customerId: ctx.customerId },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: { type: true, summary: true, createdAt: true },
  });

  // 构建分享链接
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || "https://qingyan.ai";
  const shareUrl = quote?.shareToken ? `${baseUrl}/quote/${quote.shareToken}` : null;

  const products = quote
    ? [...new Set(quote.items.map((i) => i.product))].join(", ")
    : "N/A";

  // AI 生成邮件
  const scenePrompts: Record<EmailScene, string> = {
    quote_initial: `场景：首次发送报价给客户。语气热情专业，感谢客户的兴趣，简要说明报价内容，邀请查看详情。`,
    quote_followup: `场景：报价已发送多天未回复，需要礼貌跟进。语气温和不催促，表达关心，询问是否有疑问，提供帮助。`,
    quote_viewed: `场景：客户已查看报价但尚未确认，这是热信号。语气积极但不急迫，提及你注意到他们查看了报价，询问是否需要调整或有问题需要解答。`,
    quote_resend: `场景：客户要求重新发送报价或销售主动再次发送。语气简洁明了，直接附上报价链接。`,
    general_followup: `场景：一般性跟进。语气友好，询问近况，提醒你随时可以帮助。`,
  };

  const prompt = `为以下销售场景生成一封英文邮件（客户是英语用户）。

${scenePrompts[ctx.scene]}

客户信息：
- 姓名: ${customer.name}
- 产品: ${products}
${quote ? `- 报价金额: $${quote.grandTotal.toFixed(2)}\n- 报价项目: ${quote.items.length} 个窗户` : ""}
${recentInteractions.length > 0 ? `- 最近互动: ${recentInteractions[0].summary}` : ""}

销售姓名: ${salesUser?.name || "Sales Team"}
公司: Sunny Blinds
${shareUrl ? `报价查看链接: ${shareUrl}` : ""}
${ctx.extraInstructions ? `\n额外要求: ${ctx.extraInstructions}` : ""}

请返回以下 JSON 格式（不要包含代码块标记）：
{"subject": "邮件主题", "body": "邮件HTML正文（使用简洁的HTML格式，包含适当的段落和格式化）"}`;

  let subject: string;
  let htmlBody: string;
  let textBody: string;

  try {
    const aiResult = await runSimple({
      systemPrompt:
        "You are a professional sales email writer for Sunny Blinds, a custom window covering company. Write concise, warm, and professional emails in English. Always return valid JSON.",
      userPrompt: prompt,
      mode: "chat",
      temperature: 0.6,
    });

    // 解析 AI 返回
    const cleaned = aiResult.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    subject = parsed.subject;
    htmlBody = parsed.body;
    textBody = htmlBody.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  } catch {
    // AI 失败降级到模板
    const fallback = getFallbackEmail(ctx.scene, {
      customerName: customer.name,
      salesName: salesUser?.name || "Sales Team",
      products,
      grandTotal: quote?.grandTotal ?? 0,
      shareUrl,
    });
    subject = fallback.subject;
    htmlBody = fallback.html;
    textBody = fallback.text;
  }

  return {
    to: customer.email,
    subject,
    html: wrapEmailLayout(htmlBody),
    text: textBody,
    scene: ctx.scene,
    quoteId: quote?.id,
    shareUrl: shareUrl ?? undefined,
  };
}

/**
 * AI 优化现有邮件 — 根据用户指令修改
 */
export async function refineEmail(params: {
  currentSubject: string;
  currentHtml: string;
  refinement: string;
}): Promise<{ subject: string; html: string; text: string }> {
  const plainText = params.currentHtml.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

  const prompt = `当前邮件：
主题: ${params.currentSubject}
正文: ${plainText}

用户要求的修改: ${params.refinement}

请根据用户的修改要求，调整这封邮件。保持原邮件的整体结构和风格，只做用户要求的调整。
返回 JSON 格式（不要包含代码块标记）：
{"subject": "修改后的主题", "body": "修改后的HTML正文"}`;

  const aiResult = await runSimple({
    systemPrompt: "You are a professional email editor. Modify the email according to user instructions. Keep the overall structure and style. Always return valid JSON.",
    userPrompt: prompt,
    mode: "chat",
    temperature: 0.5,
  });

  const cleaned = aiResult.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
  const parsed = JSON.parse(cleaned);

  return {
    subject: parsed.subject || params.currentSubject,
    html: wrapEmailLayout(parsed.body || params.currentHtml),
    text: (parsed.body || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
  };
}

/**
 * 统一发送：优先 Gmail OAuth，降级到 SMTP
 */
export async function sendSalesEmail(
  userId: string,
  email: ComposedEmail,
): Promise<{ success: boolean; error?: string; messageId?: string; method?: string }> {
  // 尝试 Gmail OAuth
  try {
    const { getEmailProvider, sendGmail } = await import("@/lib/google-email");
    const provider = await getEmailProvider(userId);

    if (provider?.accessToken) {
      const result = await sendGmail(userId, {
        to: email.to,
        from: provider.accountEmail,
        subject: email.subject,
        body: email.html,
      });

      return { success: true, messageId: result.messageId, method: "gmail_oauth" };
    }
  } catch (err) {
    console.warn("Gmail OAuth send failed, falling back to SMTP:", err);
  }

  // 降级到 SMTP
  try {
    const { sendMailAs } = await import("@/lib/email/sender");
    const result = await sendMailAs(userId, {
      to: email.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });

    if (result.success) {
      return { success: true, messageId: result.messageId, method: "smtp" };
    }
    return { success: false, error: result.error, method: "smtp" };
  } catch (err) {
    return {
      success: false,
      error: `邮件发送失败，请确认已绑定邮箱（Gmail OAuth 或 SMTP）。${err instanceof Error ? err.message : ""}`,
    };
  }
}

// ── 邮件 HTML 布局 ──────────────────────────────────────────

function wrapEmailLayout(body: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:20px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
<tr><td style="background:linear-gradient(135deg,#ea580c,#c2410c);padding:28px 32px;">
  <p style="margin:0;color:rgba(255,255,255,0.75);font-size:10px;letter-spacing:3px;text-transform:uppercase;">Est. Sunny Shutter Inc.</p>
  <h1 style="margin:6px 0 4px;color:#fff;font-size:22px;font-weight:700;letter-spacing:1px;">SUNNY HOME &amp; DECO</h1>
  <p style="margin:0;color:rgba(255,255,255,0.88);font-size:12px;font-style:italic;">Custom Window Coverings &amp; Interior Decor</p>
</td></tr>
<tr><td style="padding:32px;">
  ${body}
</td></tr>
<tr><td style="background:#fff7ed;padding:18px 32px;text-align:center;border-top:1px solid #fed7aa;">
  <p style="margin:0;color:#c2410c;font-size:11px;font-weight:600;letter-spacing:1px;">SUNNY HOME &amp; DECO · www.sunnyshutter.ca</p>
  <p style="margin:4px 0 0;color:#a8a29e;font-size:10px;">Delivered securely by Qingyan AI</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

// ── 降级模板 ─────────────────────────────────────────────────

function getFallbackEmail(
  scene: EmailScene,
  data: {
    customerName: string;
    salesName: string;
    products: string;
    grandTotal: number;
    shareUrl: string | null;
  },
): { subject: string; html: string; text: string } {
  const { customerName, salesName, products, grandTotal, shareUrl } = data;
  const viewBtn = shareUrl
    ? `<p style="margin:24px 0;"><a href="${shareUrl}" style="display:inline-block;background:#1a1a1a;color:#fff;padding:12px 28px;text-decoration:none;border-radius:8px;font-weight:bold;">View Your Quote — $${grandTotal.toFixed(2)}</a></p>`
    : "";

  switch (scene) {
    case "quote_initial":
      return {
        subject: `Your ${products} Quote — $${grandTotal.toFixed(2)}`,
        html: `<p>Hello ${customerName},</p><p>Thank you for your interest in our ${products}! Here is your personalized quote.</p>${viewBtn}<p>Please don't hesitate to reach out if you have any questions.</p><p>Best regards,<br/>${salesName}</p>`,
        text: `Hello ${customerName}, here is your ${products} quote: $${grandTotal.toFixed(2)}. ${shareUrl || ""}`,
      };
    case "quote_followup":
      return {
        subject: `Following up on your ${products} quote`,
        html: `<p>Hi ${customerName},</p><p>I wanted to check in regarding the quote we sent for your ${products}. We'd love to help you move forward!</p>${viewBtn}<p>If you have any questions or would like to make adjustments, I'm here to help.</p><p>Best regards,<br/>${salesName}</p>`,
        text: `Hi ${customerName}, following up on your ${products} quote. Let me know if you have any questions!`,
      };
    case "quote_viewed":
      return {
        subject: `Noticed you checked your ${products} quote — any questions?`,
        html: `<p>Hi ${customerName},</p><p>I noticed you had a chance to review your ${products} quote. I hope everything looks good!</p><p>If you have any questions, need adjustments, or are ready to move forward, I'd be happy to assist.</p>${viewBtn}<p>Best regards,<br/>${salesName}</p>`,
        text: `Hi ${customerName}, I noticed you reviewed your quote. Let me know if you'd like to proceed!`,
      };
    case "quote_resend":
      return {
        subject: `Your ${products} Quote — $${grandTotal.toFixed(2)}`,
        html: `<p>Hi ${customerName},</p><p>As requested, here is your ${products} quote again.</p>${viewBtn}<p>Best regards,<br/>${salesName}</p>`,
        text: `Hi ${customerName}, here is your quote again: $${grandTotal.toFixed(2)}`,
      };
    default:
      return {
        subject: `Checking in — Sunny Blinds`,
        html: `<p>Hi ${customerName},</p><p>Just wanted to check in and see how things are going. If there's anything I can help with, please don't hesitate to reach out.</p><p>Best regards,<br/>${salesName}</p>`,
        text: `Hi ${customerName}, just checking in. Let me know if you need anything!`,
      };
  }
}
