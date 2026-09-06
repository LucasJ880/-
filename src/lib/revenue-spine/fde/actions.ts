/**
 * Revenue Spine — FDE Action Tracking（PART 9）：扩展 SalesAction，不建平行 Action 系统
 */

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { buildSalesActionActiveKey } from "@/lib/sales/action-loop";

export const FDE_EMPLOYEE_KEY = "inbound_sales_fde";
export const FDE_ACTION_SOURCE = "digital_employee";

export interface CreateFdeActionInput {
  orgId: string;
  customerId: string;
  opportunityId: string;
  actionType: string;
  category: "contact" | "record_followup" | "quote" | "sample" | "review";
  title: string;
  description?: string | null;
  priority: "urgent" | "high" | "medium" | "low";
  dueAt?: Date | null;
  signalKey: string;
  assignedToId: string | null;
  createdById: string;
  inputContext?: Record<string, unknown>;
  employeeKey?: string;
  approvalRequired?: boolean;
}

function json(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === undefined) return undefined;
  return JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
}

/** 幂等：同 org+customer+opportunity+signalKey 的开放行动复用 */
export async function createFdeAction(input: CreateFdeActionInput) {
  const activeKey = buildSalesActionActiveKey({
    orgId: input.orgId,
    customerId: input.customerId,
    opportunityId: input.opportunityId,
    signalKey: input.signalKey,
  });
  const existing = await db.salesAction.findUnique({ where: { activeKey }, select: { id: true } });
  if (existing) return db.salesAction.findUniqueOrThrow({ where: { id: existing.id } });
  return db.salesAction.create({
    data: {
      orgId: input.orgId,
      customerId: input.customerId,
      opportunityId: input.opportunityId,
      source: FDE_ACTION_SOURCE,
      signalKey: input.signalKey,
      activeKey,
      category: input.category,
      title: input.title.slice(0, 160),
      description: input.description?.slice(0, 2000) ?? null,
      priority: input.priority,
      status: "open",
      dueAt: input.dueAt ?? null,
      lastObservedAt: new Date(),
      assignedToId: input.assignedToId,
      createdById: input.createdById,
      employeeKey: input.employeeKey ?? FDE_EMPLOYEE_KEY,
      actionType: input.actionType,
      inputContext: json(input.inputContext ?? {}),
      approvalRequired: input.approvalRequired ?? false,
    },
  });
}

export interface UpdateFdeActionInput {
  orgId: string;
  actionId: string;
  inputContextPatch?: Record<string, unknown>;
  recommendedAction?: Record<string, unknown>;
  approvalRequired?: boolean;
  pendingActionId?: string | null;
  agentRunId?: string | null;
  interactionId?: string | null;
  priority?: "urgent" | "high" | "medium" | "low";
  title?: string;
  description?: string;
  dueAt?: Date | null;
  resultJson?: Record<string, unknown>;
  /** 执行完成：executedAt + status completed + activeKey 释放 */
  executed?: { by: string | null; at?: Date; note?: string };
  /** 关闭为 auto_resolved / dismissed */
  close?: { status: "auto_resolved" | "dismissed"; reason: string };
}

export async function updateFdeAction(input: UpdateFdeActionInput) {
  const current = await db.salesAction.findFirst({
    where: { id: input.actionId, orgId: input.orgId },
    select: { id: true, inputContext: true, status: true },
  });
  if (!current) throw new Error("SalesAction 不存在或跨组织");
  const mergedContext =
    input.inputContextPatch !== undefined
      ? { ...((current.inputContext as Record<string, unknown> | null) ?? {}), ...input.inputContextPatch }
      : undefined;
  const now = new Date();
  const data: Prisma.SalesActionUncheckedUpdateInput = {
    ...(mergedContext !== undefined ? { inputContext: json(mergedContext) } : {}),
    ...(input.recommendedAction !== undefined ? { recommendedAction: json(input.recommendedAction) } : {}),
    ...(input.approvalRequired !== undefined ? { approvalRequired: input.approvalRequired } : {}),
    ...(input.pendingActionId !== undefined ? { pendingActionId: input.pendingActionId } : {}),
    ...(input.agentRunId !== undefined ? { agentRunId: input.agentRunId } : {}),
    ...(input.interactionId !== undefined ? { interactionId: input.interactionId } : {}),
    ...(input.priority !== undefined ? { priority: input.priority } : {}),
    ...(input.title !== undefined ? { title: input.title.slice(0, 160) } : {}),
    ...(input.description !== undefined ? { description: input.description.slice(0, 2000) } : {}),
    ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
    ...(input.resultJson !== undefined ? { resultJson: json(input.resultJson) } : {}),
    lastObservedAt: now,
  };
  if (input.executed && (current.status === "open" || current.status === "in_progress")) {
    data.status = "completed";
    data.completedAt = input.executed.at ?? now;
    data.executedAt = input.executed.at ?? now;
    data.approvedById = input.executed.by;
    data.completedById = input.executed.by;
    data.resolutionNote = input.executed.note ?? "由数字员工执行完成";
    data.activeKey = null;
  }
  if (input.close && (current.status === "open" || current.status === "in_progress")) {
    data.status = input.close.status;
    data.activeKey = null;
    if (input.close.status === "dismissed") {
      data.dismissedAt = now;
      data.dismissedReason = input.close.reason;
    } else {
      data.autoResolvedAt = now;
      data.resolutionNote = input.close.reason;
    }
  }
  return db.salesAction.update({ where: { id: current.id }, data });
}

export async function findFdeActionByPendingAction(orgId: string, pendingActionId: string) {
  return db.salesAction.findFirst({ where: { orgId, pendingActionId }, select: { id: true, opportunityId: true, customerId: true, status: true } });
}
