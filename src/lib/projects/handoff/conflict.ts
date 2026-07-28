import { Prisma } from "@prisma/client";
import type { ProjectHandoff } from "@prisma/client";
import { db } from "@/lib/db";
import { HandoffError } from "./errors";
import { HANDOFF_TYPE_AWARD_TO_DELIVERY } from "./types";

export function isPrismaUniqueConflict(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

export async function findHandoffByBusinessKey(input: {
  orgId: string;
  sourceTenderProjectId: string;
}): Promise<ProjectHandoff | null> {
  return db.projectHandoff.findUnique({
    where: {
      orgId_sourceTenderProjectId_handoffType: {
        orgId: input.orgId,
        sourceTenderProjectId: input.sourceTenderProjectId,
        handoffType: HANDOFF_TYPE_AWARD_TO_DELIVERY,
      },
    },
  });
}

/**
 * 唯一约束冲突后的应用层恢复：不向调用方暴露 Prisma/P2002。
 */
export function resolveHandoffAfterUniqueConflict(
  handoff: ProjectHandoff | null,
): {
  kind: "completed" | "processing" | "retryable" | "missing";
  handoff: ProjectHandoff | null;
} {
  if (!handoff) return { kind: "missing", handoff: null };
  if (handoff.status === "completed" && handoff.targetDeliveryProjectId) {
    return { kind: "completed", handoff };
  }
  if (handoff.status === "processing") {
    return { kind: "processing", handoff };
  }
  // failed / cancelled / pending — 调用方可继续重试或按权限处理
  return { kind: "retryable", handoff };
}

export function throwResolvedHandoffConflict(
  resolved: ReturnType<typeof resolveHandoffAfterUniqueConflict>,
): never {
  if (resolved.kind === "processing") {
    throw new HandoffError(
      "IN_PROGRESS",
      "交接正在处理中，请勿重复提交",
      409,
    );
  }
  if (resolved.kind === "missing") {
    throw new HandoffError(
      "INTERNAL",
      "交接冲突但无法找到既有记录，请稍后重试",
      500,
    );
  }
  throw new HandoffError(
    "INTERNAL",
    "交接状态异常，请查看交接记录后重试",
    500,
  );
}
