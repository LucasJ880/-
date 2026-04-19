/**
 * PR4 — 销售域写工具（走审批流）
 *
 * 这些工具不会直接改库，而是创建 PendingAction 草稿。
 * 用户在聊天里点"批准"后，pending-actions/executor 才会真正执行。
 *
 * 当前已实现：
 * - sales_update_followup        更新商机下次跟进时间
 * - sales_update_stage           推进商机阶段
 * - calendar_create_event_draft  创建日历事件
 *
 * 工具调用返回统一结构 { status: "pending_approval", actionId, ... }，
 * LLM 收到后应告知用户等待确认，不再重复调用。
 */

import { registry } from "../tool-registry";
import type { ToolExecutionContext } from "../types";
import { db } from "@/lib/db";
import { createDraft } from "@/lib/pending-actions/drafts";
import {
  salesAssignableScope,
  salesCreatedScope,
  canSeeResource,
} from "@/lib/rbac/data-scope";

// ── 辅助：格式化时间给用户看 ────────────────────────────────────
function fmtDate(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  if (isNaN(dt.getTime())) return String(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  const hh = String(dt.getHours()).padStart(2, "0");
  const mm = String(dt.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

// ── 辅助：按 customerName / opportunityId 定位商机（带权限） ────
async function resolveOpportunity(
  ctx: ToolExecutionContext,
  args: { opportunityId?: string; customerName?: string },
) {
  let opportunityId = args.opportunityId;

  if (!opportunityId && args.customerName) {
    const custScope = salesCreatedScope(ctx.userId, ctx.role);
    const customer = await db.salesCustomer.findFirst({
      where: {
        name: { contains: args.customerName, mode: "insensitive" },
        ...(custScope ?? {}),
      },
      select: { id: true, name: true },
    });
    if (!customer) {
      return { error: `未找到客户 "${args.customerName}"` as const };
    }
    const oppScope = salesAssignableScope(ctx.userId, ctx.role);
    const opp = await db.salesOpportunity.findFirst({
      where: {
        customerId: customer.id,
        stage: { notIn: ["lost", "completed"] },
        ...(oppScope ?? {}),
      },
      orderBy: { updatedAt: "desc" },
    });
    if (!opp) return { error: `客户 "${args.customerName}" 没有活跃商机` as const };
    opportunityId = opp.id;
  }

  if (!opportunityId) return { error: "请提供商机ID或客户姓名" as const };

  const opp = await db.salesOpportunity.findUnique({
    where: { id: opportunityId },
    include: { customer: { select: { name: true } } },
  });
  if (!opp) return { error: "商机不存在" as const };

  if (
    !canSeeResource(ctx.role, ctx.userId, {
      createdById: opp.createdById,
      assignedToId: opp.assignedToId,
    })
  ) {
    return { error: "无权操作该商机" as const };
  }

  return { opp };
}

// ── sales_update_followup ──────────────────────────────────────

registry.register({
  name: "sales_update_followup",
  description:
    "更新商机的下次跟进时间。这是一个写操作，会生成草稿并等待用户确认，不会直接修改数据库。例如：'把 Lucas 的跟进推到下周二上午'。",
  domain: "sales",
  parameters: {
    type: "object",
    properties: {
      opportunityId: { type: "string", description: "商机ID" },
      customerName: { type: "string", description: "客户姓名（用于定位商机）" },
      nextFollowupAt: {
        type: "string",
        description: "新的下次跟进时间，ISO 8601 格式，如 2026-04-21T10:00:00",
      },
      note: { type: "string", description: "备注（可选）" },
    },
    required: ["nextFollowupAt"],
  },
  execute: async (ctx: ToolExecutionContext) => {
    const args = ctx.args as {
      opportunityId?: string;
      customerName?: string;
      nextFollowupAt: string;
      note?: string;
    };

    const nextAt = new Date(args.nextFollowupAt);
    if (isNaN(nextAt.getTime())) {
      return { success: false, data: { error: "跟进时间格式无效" } };
    }

    const resolved = await resolveOpportunity(ctx, args);
    if ("error" in resolved) return { success: false, data: { error: resolved.error } };
    const { opp } = resolved;

    const prevStr = opp.nextFollowupAt
      ? fmtDate(opp.nextFollowupAt)
      : "（未设置）";
    const newStr = fmtDate(nextAt);

    return await createDraft({
      type: "sales.update_followup",
      title: `推迟 ${opp.customer?.name ?? "商机"} 的跟进到 ${newStr}`,
      preview: `将 ${opp.customer?.name ?? "未命名客户"} 的商机「${opp.title}」下次跟进时间从 ${prevStr} 更新为 ${newStr}。`,
      payload: {
        type: "sales.update_followup",
        opportunityId: opp.id,
        opportunityTitle: opp.title,
        customerName: opp.customer?.name ?? "",
        previousFollowupAt: opp.nextFollowupAt?.toISOString() ?? null,
        nextFollowupAt: nextAt.toISOString(),
        note: args.note,
      },
      userId: ctx.userId,
      threadId: ctx.sessionId,
    });
  },
});

// ── sales_update_stage ─────────────────────────────────────────

const STAGE_LABELS: Record<string, string> = {
  new_lead: "新线索",
  needs_confirmed: "需求确认",
  measure_booked: "已约量房",
  quoted: "已报价",
  negotiation: "洽谈中",
  signed: "已签约",
  producing: "生产中",
  installing: "安装中",
  completed: "已完成",
  lost: "已流失",
};

registry.register({
  name: "sales_update_stage",
  description:
    "推进商机到新阶段（会先生成草稿让用户确认，不直接改库）。例如：'把张三推到已报价'。",
  domain: "sales",
  parameters: {
    type: "object",
    properties: {
      opportunityId: { type: "string", description: "商机ID" },
      customerName: { type: "string", description: "客户姓名（用于定位商机）" },
      newStage: {
        type: "string",
        description:
          "目标阶段：new_lead / needs_confirmed / measure_booked / quoted / negotiation / signed / producing / installing / completed / lost",
      },
      note: { type: "string", description: "备注（可选）" },
    },
    required: ["newStage"],
  },
  execute: async (ctx: ToolExecutionContext) => {
    const args = ctx.args as {
      opportunityId?: string;
      customerName?: string;
      newStage: string;
      note?: string;
    };

    if (!STAGE_LABELS[args.newStage]) {
      return { success: false, data: { error: `未知阶段 ${args.newStage}` } };
    }

    const resolved = await resolveOpportunity(ctx, args);
    if ("error" in resolved) return { success: false, data: { error: resolved.error } };
    const { opp } = resolved;

    if (opp.stage === args.newStage) {
      return {
        success: false,
        data: { error: `商机已处于「${STAGE_LABELS[args.newStage]}」阶段` },
      };
    }

    const fromLabel = STAGE_LABELS[opp.stage] ?? opp.stage;
    const toLabel = STAGE_LABELS[args.newStage];

    return await createDraft({
      type: "sales.update_stage",
      title: `推进 ${opp.customer?.name ?? "商机"} 到「${toLabel}」`,
      preview: `将 ${opp.customer?.name ?? "未命名客户"} 的商机「${opp.title}」从「${fromLabel}」推进到「${toLabel}」。`,
      payload: {
        type: "sales.update_stage",
        opportunityId: opp.id,
        opportunityTitle: opp.title,
        customerName: opp.customer?.name ?? "",
        previousStage: opp.stage,
        newStage: args.newStage,
        note: args.note,
      },
      userId: ctx.userId,
      threadId: ctx.sessionId,
    });
  },
});

// ── calendar_create_event_draft ────────────────────────────────

registry.register({
  name: "calendar_create_event_draft",
  description:
    "生成一条日历事件草稿（如会议、量房、回访），用户确认后才会真正写入日历。不要用于修改已有事件。",
  domain: "secretary",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "事件标题" },
      description: { type: "string", description: "描述（可选）" },
      startTime: {
        type: "string",
        description: "开始时间，ISO 8601，如 2026-04-21T10:00:00",
      },
      endTime: {
        type: "string",
        description: "结束时间，ISO 8601",
      },
      allDay: { type: "string", description: "是否全天事件（true/false）" },
      location: { type: "string", description: "地点（可选）" },
      reminderMinutes: {
        type: "string",
        description: "提前多少分钟提醒（默认 15，传字符串数字）",
      },
    },
    required: ["title", "startTime", "endTime"],
  },
  execute: async (ctx: ToolExecutionContext) => {
    const args = ctx.args as {
      title: string;
      description?: string;
      startTime: string;
      endTime: string;
      allDay?: string | boolean;
      location?: string;
      reminderMinutes?: string | number;
    };

    const start = new Date(args.startTime);
    const end = new Date(args.endTime);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return { success: false, data: { error: "时间格式无效，请使用 ISO 8601" } };
    }
    if (end.getTime() <= start.getTime()) {
      return { success: false, data: { error: "结束时间必须晚于开始时间" } };
    }

    const allDay =
      args.allDay === true || args.allDay === "true" || args.allDay === "1";
    const reminder = Number(args.reminderMinutes ?? 15);

    return await createDraft({
      type: "calendar.create_event",
      title: `新建日历事件：${args.title}`,
      preview: `将在日历创建「${args.title}」：${fmtDate(start)} – ${fmtDate(end)}${args.location ? ` @ ${args.location}` : ""}。`,
      payload: {
        type: "calendar.create_event",
        title: args.title,
        description: args.description,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        allDay,
        location: args.location,
        reminderMinutes: Number.isFinite(reminder) ? reminder : 15,
      },
      userId: ctx.userId,
      threadId: ctx.sessionId,
    });
  },
});
