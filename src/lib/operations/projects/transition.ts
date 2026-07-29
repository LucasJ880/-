/**
 * 交付阶段转换（服务端）
 */

import type { Prisma } from "@prisma/client";
import { writeAuditLog } from "@/lib/audit/logger";
import { isDeliveryProject } from "@/lib/projects/work-domain";
import {
  canTransitionDeliveryStage,
  isDeliveryStageComplete,
  normalizeDeliveryStage,
  type DeliveryStage,
} from "./stage";

export type TransitionDeliveryStageInput = {
  project: {
    id: string;
    orgId: string | null;
    workDomain: string;
    deliveryStage: string | null;
  };
  nextStage: string;
  actor: { userId: string; allowReopenCompleted: boolean };
  client: Prisma.TransactionClient;
  now?: Date;
};

export type TransitionDeliveryStageResult = {
  deliveryStage: DeliveryStage;
  actualCompletionDate: Date | null;
  clearActualCompletion: boolean;
};

export async function transitionDeliveryStage(
  input: TransitionDeliveryStageInput,
): Promise<TransitionDeliveryStageResult> {
  if (!isDeliveryProject(input.project.workDomain)) {
    throw new Error("仅执行项目（delivery）可修改交付阶段");
  }

  const next = normalizeDeliveryStage(input.nextStage);
  if (!next) throw new Error(`非法 deliveryStage: ${input.nextStage}`);

  const check = canTransitionDeliveryStage({
    from: input.project.deliveryStage,
    to: next,
    allowReopenCompleted: input.actor.allowReopenCompleted,
  });
  if (!check.ok) throw new Error(check.reason);

  const now = input.now ?? new Date();
  const wasCompleted = isDeliveryStageComplete(input.project.deliveryStage);
  const becomingCompleted = next === "completed";

  let actualCompletionDate: Date | null = null;
  let clearActualCompletion = false;

  if (becomingCompleted) {
    actualCompletionDate = now;
  } else if (wasCompleted) {
    // becomingCompleted 已为 false ⇒ next !== completed
    clearActualCompletion = true;
  }

  await input.client.project.update({
    where: { id: input.project.id },
    data: {
      deliveryStage: next,
      ...(becomingCompleted
        ? { actualCompletionDate: now, status: "completed" }
        : {}),
      ...(clearActualCompletion ? { actualCompletionDate: null } : {}),
      ...(next === "cancelled" ? { status: "cancelled" } : {}),
      ...(next === "on_hold" ? { status: "on_hold" } : {}),
      ...(next !== "completed" &&
      next !== "cancelled" &&
      next !== "on_hold" &&
      (input.project.deliveryStage === "completed" ||
        input.project.deliveryStage === "cancelled" ||
        input.project.deliveryStage === "on_hold")
        ? { status: "active" }
        : {}),
    },
  });

  await writeAuditLog(input.client, {
    userId: input.actor.userId,
    orgId: input.project.orgId,
    projectId: input.project.id,
    action: "delivery_stage.transition",
    targetType: "project",
    targetId: input.project.id,
    beforeData: { deliveryStage: input.project.deliveryStage },
    afterData: {
      deliveryStage: next,
      actualCompletionDate: becomingCompleted ? now.toISOString() : null,
      clearedActualCompletion: clearActualCompletion,
    },
  });

  return {
    deliveryStage: next,
    actualCompletionDate,
    clearActualCompletion,
  };
}
