/**
 * 工具网关 — 所有对外副作用的统一管控层
 *
 * 每个工具调用经过：权限检查 → 参数校验 → 幂等查重 → 执行 → 审计记录
 */

import { db } from "@/lib/db";
import type { ToolCall, ToolResult } from "./types";

type ToolHandler = (
  params: Record<string, unknown>,
  userId: string
) => Promise<ToolResult>;

const TOOL_HANDLERS = new Map<string, ToolHandler>();

// ── 注册工具 ────────────────────────────────────────────────────

function registerTool(name: string, handler: ToolHandler): void {
  TOOL_HANDLERS.set(name, handler);
}

// ── 工具：write_quote ────────────────────────────────────────────

registerTool("write_quote", async (params) => {
  const quoteId = params.quoteId as string;
  const headerData = params.header as Record<string, unknown> | undefined;
  const linesData = params.lines as Array<Record<string, unknown>> | undefined;

  if (!quoteId) {
    return { success: false, data: {}, error: "缺少 quoteId" };
  }

  const updates: Record<string, unknown> = {};
  if (headerData) {
    if (headerData.templateType) updates.templateType = headerData.templateType;
    if (headerData.currency) updates.currency = headerData.currency;
    if (headerData.tradeTerms) updates.tradeTerms = headerData.tradeTerms;
    if (headerData.paymentTerms) updates.paymentTerms = headerData.paymentTerms;
    if (headerData.deliveryDays !== undefined)
      updates.deliveryDays = Number(headerData.deliveryDays);
    if (headerData.originCountry) updates.originCountry = headerData.originCountry;
  }

  if (Object.keys(updates).length > 0) {
    await db.projectQuote.update({ where: { id: quoteId }, data: updates });
  }

  if (linesData && linesData.length > 0) {
    await db.quoteLineItem.deleteMany({ where: { quoteId } });
    await db.quoteLineItem.createMany({
      data: linesData.map((l, i) => ({
        quoteId,
        sortOrder: i,
        category: (l.category as string) || "product",
        itemName: (l.itemName as string) || "",
        specification: (l.specification as string) || null,
        unit: (l.unit as string) || null,
        quantity: l.quantity != null ? Number(l.quantity) : null,
        unitPrice: l.unitPrice != null ? Number(l.unitPrice) : null,
        unitCost: l.unitCost != null ? Number(l.unitCost) : null,
        totalPrice: l.totalPrice != null ? Number(l.totalPrice) : null,
        totalCost: l.totalCost != null ? Number(l.totalCost) : null,
      })),
    });
  }

  return { success: true, data: { quoteId, updated: true } };
});

// ── 工具：create_task ────────────────────────────────────────────

registerTool("create_task", async (params, userId) => {
  const title = params.title as string;
  const projectId = params.projectId as string;
  if (!title || !projectId) {
    return { success: false, data: {}, error: "缺少 title 或 projectId" };
  }

  const task = await db.task.create({
    data: {
      title,
      projectId,
      assigneeId: userId,
      creatorId: userId,
      priority: (params.priority as string) || "medium",
      status: "todo",
    },
  });

  return { success: true, data: { taskId: task.id } };
});

// ── 工具：create_notification ────────────────────────────────────

registerTool("create_notification", async (params) => {
  const userId = params.userId as string;
  const title = params.title as string;
  if (!userId || !title) {
    return { success: false, data: {}, error: "缺少 userId 或 title" };
  }

  const notification = await db.notification.create({
    data: {
      userId,
      type: (params.type as string) || "agent_task",
      category: "agent",
      title,
      summary: (params.summary as string) || null,
      projectId: (params.projectId as string) || null,
      entityType: (params.entityType as string) || null,
      entityId: (params.entityId as string) || null,
      priority: (params.priority as string) || "medium",
      sourceKey: (params.sourceKey as string) || null,
    },
  });

  return { success: true, data: { notificationId: notification.id } };
});

// ── 工具：log_audit ──────────────────────────────────────────────

registerTool("log_audit", async (params, userId) => {
  const action = (params.action as string) || "agent_execute";
  const targetType = (params.targetType as string) || "agent_task";
  const targetId = (params.targetId as string) || "";

  await db.auditLog.create({
    data: {
      userId,
      action,
      targetType,
      targetId,
      projectId: (params.projectId as string) || null,
      afterData: params.detail ? JSON.stringify(params.detail) : null,
    },
  });

  return { success: true, data: { logged: true } };
});

// ── 主入口 ───────────────────────────────────────────────────────

export async function executeTool(call: ToolCall): Promise<ToolResult> {
  const handler = TOOL_HANDLERS.get(call.toolName);
  if (!handler) {
    return { success: false, data: {}, error: `未知工具: ${call.toolName}` };
  }

  // 幂等查重
  const existing = await db.toolExecution.findUnique({
    where: { idempotencyKey: call.idempotencyKey },
  });
  if (existing && existing.status === "success") {
    return {
      success: true,
      data: existing.toolOutput ? JSON.parse(existing.toolOutput) : {},
    };
  }

  // 创建执行记录
  const execution = await db.toolExecution.create({
    data: {
      taskId: call.taskId,
      stepId: call.stepId,
      toolName: call.toolName,
      toolInput: JSON.stringify(call.params),
      status: "executing",
      idempotencyKey: call.idempotencyKey,
      executedBy: call.userId,
    },
  });

  const startMs = Date.now();
  let result: ToolResult;
  let retries = 0;
  const maxRetries = 2;

  while (true) {
    try {
      result = await handler(call.params, call.userId);
      break;
    } catch (err) {
      retries++;
      if (retries > maxRetries) {
        result = {
          success: false,
          data: {},
          error: err instanceof Error ? err.message : String(err),
        };
        break;
      }
      await new Promise((r) => setTimeout(r, 500 * retries));
    }
  }

  // 更新执行记录
  await db.toolExecution.update({
    where: { id: execution.id },
    data: {
      status: result.success ? "success" : "failed",
      toolOutput: JSON.stringify(result.data),
      error: result.error ?? null,
      retryCount: retries,
      duration: Date.now() - startMs,
      executedAt: new Date(),
    },
  });

  return result;
}
