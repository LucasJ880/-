/**
 * 销售域工具 — 沟通 / 互动 / 预约
 */

import { registry } from "../tool-registry";
import type { ToolExecutionContext } from "../types";
import { db } from "@/lib/db";
import { ok } from "./sales-helpers";
import { salesCreatedScope } from "@/lib/rbac/data-scope";
import { assertSalesCustomerInOrgOrThrowForConvert } from "@/lib/sales/org-context";

/** PR1：归一化客户归属检查（admin 跳过；sales 必须是自己的客户） */
async function resolveOwnedCustomerId(
  ctx: ToolExecutionContext,
  customerIdArg: string | undefined,
  customerNameArg: string | undefined,
): Promise<{ customerId: string } | { error: string }> {
  const custScope = salesCreatedScope(ctx.userId, ctx.role);
  let customerId = customerIdArg;

  if (!customerId && customerNameArg) {
    const found = await db.salesCustomer.findFirst({
      where: {
        name: { contains: customerNameArg, mode: "insensitive" },
        ...(custScope ?? {}),
      },
      select: { id: true },
    });
    if (!found) return { error: `未找到客户 "${customerNameArg}"` };
    customerId = found.id;
  }

  if (!customerId) return { error: "请提供客户ID或姓名" };

  if (custScope) {
    const owned = await db.salesCustomer.findFirst({
      where: { id: customerId, ...custScope },
      select: { id: true },
    });
    if (!owned) return { error: "无权访问该客户" };
  }

  return { customerId };
}

// ── sales.compose_email ───────────────────────────────────────

registry.register({
  name: "sales_compose_email",
  description:
    "AI 生成邮件预览（不发送）。生成后展示给用户确认，用户说'发送'时再调用 sales.send_quote_email。用户说'改一下'时调用 sales.refine_email 修改。",
  domain: "sales",
  parameters: {
    type: "object",
    properties: {
      customerId: { type: "string", description: "客户ID" },
      customerName: { type: "string", description: "客户姓名" },
      scene: { type: "string", description: "场景：quote_initial / quote_followup / quote_viewed / quote_resend / general_followup" },
      quoteId: { type: "string", description: "报价ID（可选）" },
      productFilter: { type: "string", description: "产品过滤" },
      extraInstructions: { type: "string", description: "AI 额外指令" },
    },
    required: ["scene"],
  },
  execute: async (ctx: ToolExecutionContext) => {
    const { composeEmail } = await import("@/lib/sales/email-composer");

    const resolved = await resolveOwnedCustomerId(
      ctx,
      ctx.args.customerId as string | undefined,
      ctx.args.customerName as string | undefined,
    );
    if ("error" in resolved) return { success: false, data: { error: resolved.error } };
    const { customerId } = resolved;

    try {
      const email = await composeEmail({
        userId: ctx.userId,
        customerId,
        scene: (ctx.args.scene as string) as import("@/lib/sales/email-composer").EmailScene,
        quoteId: ctx.args.quoteId as string | undefined,
        productFilter: ctx.args.productFilter as string | undefined,
        extraInstructions: ctx.args.extraInstructions as string | undefined,
      });

      const textPreview = email.html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

      return ok({
        preview: true,
        to: email.to,
        subject: email.subject,
        body: textPreview.slice(0, 500),
        quoteId: email.quoteId,
        customerId,
        scene: email.scene,
        instruction: "邮件已生成，请展示给用户并等待确认。用户说'发送/发/确认/好的'→调用 sales.send_quote_email；用户要修改→调用 sales.refine_email",
      });
    } catch (err) {
      return { success: false, data: { error: err instanceof Error ? err.message : "生成失败" } };
    }
  },
});

// ── sales.refine_email ────────────────────────────────────────

registry.register({
  name: "sales_refine_email",
  description:
    "AI 修改邮件内容。用户对预览邮件不满意时调用，传入修改指令让AI优化。修改后再次展示给用户确认。",
  domain: "sales",
  parameters: {
    type: "object",
    properties: {
      customerId: { type: "string", description: "客户ID（用于重新生成）" },
      customerName: { type: "string", description: "客户姓名" },
      scene: { type: "string", description: "场景" },
      refinement: { type: "string", description: "用户的修改指令，如：语气更热情/加上折扣信息/更简短" },
    },
    required: ["refinement"],
  },
  execute: async (ctx: ToolExecutionContext) => {
    const { composeEmail } = await import("@/lib/sales/email-composer");

    const resolved = await resolveOwnedCustomerId(
      ctx,
      ctx.args.customerId as string | undefined,
      ctx.args.customerName as string | undefined,
    );
    if ("error" in resolved) return { success: false, data: { error: resolved.error } };
    const { customerId } = resolved;

    try {
      const email = await composeEmail({
        userId: ctx.userId,
        customerId,
        scene: ((ctx.args.scene as string) || "general_followup") as import("@/lib/sales/email-composer").EmailScene,
        extraInstructions: ctx.args.refinement as string,
      });

      const textPreview = email.html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

      return ok({
        preview: true,
        refined: true,
        to: email.to,
        subject: email.subject,
        body: textPreview.slice(0, 500),
        quoteId: email.quoteId,
        customerId,
        scene: email.scene,
        instruction: "修改后的邮件已生成。展示给用户，等待确认发送或继续修改。",
      });
    } catch (err) {
      return { success: false, data: { error: err instanceof Error ? err.message : "修改失败" } };
    }
  },
});

// ── sales.send_quote_email ────────────────────────────────────

registry.register({
  name: "sales_send_quote_email",
  description:
    "向客户发送报价邮件。AI 自动生成邮件内容，支持多种场景（首发/跟进/重发）。支持 Gmail OAuth 和 SMTP 双通道。",
  domain: "sales",
  parameters: {
    type: "object",
    properties: {
      customerId: { type: "string", description: "客户ID" },
      customerName: { type: "string", description: "客户姓名（用于搜索）" },
      quoteId: { type: "string", description: "指定报价ID（可选）" },
      productFilter: { type: "string", description: "按产品类型过滤（如 Zebra）" },
      scene: {
        type: "string",
        description: "邮件场景：quote_initial / quote_followup / quote_viewed / quote_resend / general_followup",
      },
      extraInstructions: { type: "string", description: "给AI的额外指示，如特殊折扣信息" },
    },
    required: [],
  },
  execute: async (ctx: ToolExecutionContext) => {
    const { composeEmail, sendSalesEmail } = await import("@/lib/sales/email-composer");

    const resolved = await resolveOwnedCustomerId(
      ctx,
      ctx.args.customerId as string | undefined,
      ctx.args.customerName as string | undefined,
    );
    if ("error" in resolved) return { success: false, data: { error: resolved.error } };
    const { customerId } = resolved;

    const scene = (ctx.args.scene as string) || "quote_initial";

    try {
      const cust = await db.salesCustomer.findFirst({
        where: { id: customerId, archivedAt: null },
        select: { id: true, orgId: true, createdById: true },
      });
      if (!cust) {
        return { success: false, data: { error: "客户不存在" } };
      }
      await assertSalesCustomerInOrgOrThrowForConvert(cust, ctx.orgId);

      const email = await composeEmail({
        userId: ctx.userId,
        customerId,
        scene: scene as import("@/lib/sales/email-composer").EmailScene,
        quoteId: ctx.args.quoteId as string | undefined,
        productFilter: ctx.args.productFilter as string | undefined,
        extraInstructions: ctx.args.extraInstructions as string | undefined,
      });

      const result = await sendSalesEmail(ctx.userId, email);

      if (!result.success) {
        return { success: false, data: { error: result.error } };
      }

      if (email.quoteId) {
        await db.salesQuote.update({
          where: { id: email.quoteId },
          data: { status: "sent", sentAt: new Date() },
        }).catch(() => {});
      }

      await db.customerInteraction.create({
        data: {
          orgId: ctx.orgId,
          customerId,
          type: "email",
          direction: "outbound",
          summary: `AI ${scene} 邮件已发送 — ${email.subject}`,
          createdById: ctx.userId,
        },
      }).catch(() => {});

      return ok({
        sent: true,
        to: email.to,
        subject: email.subject,
        method: result.method,
        quoteId: email.quoteId,
      });
    } catch (err) {
      return {
        success: false,
        data: { error: err instanceof Error ? err.message : "邮件发送失败" },
      };
    }
  },
});

// ── sales.create_appointment ──────────────────────────────────

registry.register({
  name: "sales_create_appointment",
  description:
    "为客户创建预约（安装、回访、咨询）。支持通过客户姓名搜索。",
  domain: "sales",
  parameters: {
    type: "object",
    properties: {
      customerName: { type: "string", description: "客户姓名" },
      customerId: { type: "string", description: "客户ID" },
      type: {
        type: "string",
        description: "预约类型：install / revisit / consultation（量房已下线，不要使用 measure）",
      },
      startAt: { type: "string", description: "开始时间，ISO 8601 格式" },
      endAt: { type: "string", description: "结束时间（可选）" },
      notes: { type: "string", description: "备注" },
      address: { type: "string", description: "地址" },
    },
    required: ["type", "startAt"],
  },
  execute: async (ctx: ToolExecutionContext) => {
    const resolved = await resolveOwnedCustomerId(
      ctx,
      ctx.args.customerId as string | undefined,
      ctx.args.customerName as string | undefined,
    );
    if ("error" in resolved) return { success: false, data: { error: resolved.error } };
    const { customerId } = resolved;

    const startAt = new Date(ctx.args.startAt as string);
    const endAt = ctx.args.endAt
      ? new Date(ctx.args.endAt as string)
      : new Date(startAt.getTime() + 60 * 60 * 1000);

    const cust = await db.salesCustomer.findUnique({
      where: { id: customerId },
      select: { name: true },
    });

    const typeLabels: Record<string, string> = {
      measure: "量房", install: "安装", revisit: "回访", consultation: "咨询",
    };
    const apptType = String(ctx.args.type);
    const title = `${cust?.name || "客户"} - ${typeLabels[apptType] || apptType}`;

    const appointment = await db.appointment.create({
      data: {
        customerId,
        type: apptType,
        title,
        status: "scheduled",
        startAt,
        endAt,
        address: (ctx.args.address as string) || null,
        notes: (ctx.args.notes as string) || null,
        assignedToId: ctx.userId,
        createdById: ctx.userId,
      },
    });

    const { syncAppointmentToGoogle } = await import(
      "@/lib/sales/appointment-gcal-sync"
    );
    syncAppointmentToGoogle(appointment.id, ctx.userId).catch(() => {});

    return ok({
      appointmentId: appointment.id,
      type: appointment.type,
      startAt: appointment.startAt,
      endAt: appointment.endAt,
    });
  },
});

// ── sales.analyze_interaction ──────────────────────────────────

registry.register({
  name: "sales_analyze_interaction",
  description:
    "对一段销售沟通内容进行 AI 分析，提取意图/情绪/异议/买方信号/风险/下一步建议。" +
    "用于分析微信转发内容或销售问'帮我分析一下这段对话'。",
  domain: "sales",
  parameters: {
    type: "object",
    properties: {
      content: { type: "string", description: "需要分析的沟通内容" },
      customerName: { type: "string", description: "客户姓名（可选，提高分析精度）" },
      dealStage: { type: "string", description: "当前 deal 阶段（可选）" },
    },
    required: ["content"],
  },
  execute: async (ctx: ToolExecutionContext) => {
    const { analyzeCommunication } = await import(
      "@/lib/sales/communication-analyzer"
    );

    const content = ctx.args.content as string;
    if (!content || content.length < 10) {
      return { success: false, data: { error: "内容过短，无法分析" } };
    }

    try {
      const analysis = await analyzeCommunication({
        content,
        customerName: ctx.args.customerName as string | undefined,
        dealStage: ctx.args.dealStage as string | undefined,
      });

      return ok({
        sentiment: analysis.sentiment,
        intent: analysis.intent,
        objectionType: analysis.objectionType,
        dealHealthScore: analysis.dealHealthScore,
        buyerSignals: analysis.buyerSignals,
        riskSignals: analysis.riskSignals,
        keyNeeds: analysis.keyNeeds,
        suggestedNextAction: analysis.suggestedNextAction,
        summary: analysis.summary,
      });
    } catch (err) {
      return {
        success: false,
        data: { error: err instanceof Error ? err.message : "分析失败" },
      };
    }
  },
});
