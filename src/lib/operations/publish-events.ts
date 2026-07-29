/**
 * PublishJob 状态事件 + AuditLog
 */

import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import { canTransition, normalizePublishStatus } from "./publish-status";
import type { Prisma } from "@prisma/client";

export async function transitionPublishJob(input: {
  orgId: string;
  jobId: string;
  toStatus: string;
  actorType: "user" | "ai" | "system" | "worker" | "webhook";
  actorId?: string | null;
  reasonCode?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  data?: Prisma.PublishJobUpdateInput;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const job = await db.publishJob.findFirst({
    where: { id: input.jobId, orgId: input.orgId },
  });
  if (!job) return { ok: false, error: "任务不存在" };

  const from = normalizePublishStatus(job.status);
  const to = normalizePublishStatus(input.toStatus);
  const gate = canTransition(String(from), String(to));
  if (!gate.ok) return gate;

  await db.$transaction(async (tx) => {
    await tx.publishJob.update({
      where: { id: job.id },
      data: {
        status: to,
        ...(input.data ?? {}),
      },
    });
    await tx.publishJobStatusEvent.create({
      data: {
        orgId: input.orgId,
        publishJobId: job.id,
        fromStatus: String(from),
        toStatus: String(to),
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        reasonCode: input.reasonCode ?? null,
        reason: input.reason ?? null,
        metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue,
      },
    });
  });

  if (input.actorId) {
    await logAudit({
      userId: input.actorId,
      orgId: input.orgId,
      action: `publish_job.${to}`,
      targetType: "PublishJob",
      targetId: job.id,
      beforeData: { status: from },
      afterData: {
        status: to,
        reasonCode: input.reasonCode,
        reason: input.reason,
        ...(input.metadata ?? {}),
      },
    });
  }

  return { ok: true };
}
