import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { escalateApproval } from "@/lib/agent/approval";

/**
 * GET /api/cron/approval-timeout
 *
 * 每 2 小时检查一次超时审批：
 * - 超过 deadlineAt 的 pending 审批 → 标记为 escalated + 发通知
 * - 没有 deadlineAt 但超过 48 小时的 → 发提醒通知
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  // 1) 有明确 deadline 且已超时的
  const expiredApprovals = await db.approvalRequest.findMany({
    where: {
      status: "pending",
      deadlineAt: { lte: now },
    },
    include: {
      task: { select: { intent: true, createdById: true, projectId: true } },
      step: { select: { title: true } },
    },
  });

  // 2) 没有 deadline 但超过 48 小时未处理的
  const staleApprovals = await db.approvalRequest.findMany({
    where: {
      status: "pending",
      deadlineAt: null,
      createdAt: { lte: fortyEightHoursAgo },
    },
    include: {
      task: { select: { intent: true, createdById: true, projectId: true } },
      step: { select: { title: true } },
    },
  });

  let escalatedCount = 0;
  let remindedCount = 0;

  // 处理超时审批
  for (const approval of expiredApprovals) {
    await escalateApproval(approval.id, approval.task.createdById, approval.task.projectId);
    escalatedCount++;
  }

  // 发送提醒通知（不改状态）
  for (const approval of staleApprovals) {
    const targetUserId = approval.approverUserId ?? approval.task.createdById;
    const existingReminder = await db.notification.findFirst({
      where: {
        sourceKey: `approval_remind_${approval.id}`,
      },
    });

    if (!existingReminder) {
      await db.notification.create({
        data: {
          userId: targetUserId,
          type: "agent_approval",
          category: "agent",
          title: `审批提醒：「${approval.step.title}」已等待超过 48 小时`,
          summary: `任务：${approval.task.intent}`,
          projectId: approval.task.projectId ?? null,
          entityType: "approval_request",
          entityId: approval.id,
          priority: "high",
          sourceKey: `approval_remind_${approval.id}`,
        },
      });
      remindedCount++;
    }
  }

  return NextResponse.json({
    checkedAt: now.toISOString(),
    expiredCount: expiredApprovals.length,
    escalatedCount,
    staleCount: staleApprovals.length,
    remindedCount,
  });
}
