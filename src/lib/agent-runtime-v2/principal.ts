/**
 * Runtime V2 执行主体：始终以 Run 发起人为准，审批人不扩大数据范围。
 */

import { db } from "@/lib/db";
import { getOrgMembership } from "@/lib/auth";

export type RuntimeV2Principal =
  | {
      ok: true;
      userId: string;
      role: string;
      orgRole: string;
      approvalActorUserId?: string | null;
    }
  | {
      ok: false;
      code:
        | "INITIATOR_MISSING"
        | "USER_INACTIVE"
        | "NO_MEMBERSHIP"
        | "MEMBERSHIP_INACTIVE"
        | "RUN_NOT_FOUND";
      error: string;
    };

function readInitiatedByUserId(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const v = (metadata as Record<string, unknown>).initiatedByUserId;
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * 从 AgentRun.metadata.initiatedByUserId 解析执行主体，并校验 User / Org membership。
 * approvalActorUserId 仅记录，不用于后续工具执行。
 */
export async function resolveRuntimeV2Principal(input: {
  orgId: string;
  runId: string;
  approvalActorUserId?: string | null;
}): Promise<RuntimeV2Principal> {
  const run = await db.agentRun.findFirst({
    where: {
      id: input.runId,
      orgId: input.orgId,
      runtimeVersion: "v2",
    },
    select: { id: true, metadata: true },
  });
  if (!run) {
    return { ok: false, code: "RUN_NOT_FOUND", error: "Run not found" };
  }

  const initiatorId = readInitiatedByUserId(run.metadata);
  if (!initiatorId) {
    return {
      ok: false,
      code: "INITIATOR_MISSING",
      error: "缺少 initiatedByUserId，无法安全恢复执行",
    };
  }

  const user = await db.user.findUnique({
    where: { id: initiatorId },
    select: { id: true, status: true, role: true },
  });
  if (!user || user.status !== "active") {
    return {
      ok: false,
      code: "USER_INACTIVE",
      error: "发起人已离职或被冻结，停止 Runtime",
    };
  }

  const membership = await getOrgMembership(initiatorId, input.orgId);
  if (!membership) {
    return {
      ok: false,
      code: "NO_MEMBERSHIP",
      error: "发起人已无企业成员身份，停止 Runtime",
    };
  }
  if (membership.status !== "active") {
    return {
      ok: false,
      code: "MEMBERSHIP_INACTIVE",
      error: "发起人 membership 已失效，停止 Runtime",
    };
  }

  // Workspace：有活跃 workspace membership 更好，但 org 级销售工具不强制；
  // 若全部 workspace 均非 active 且用户非 org admin，仍允许 org 级只读，写工具会再鉴权。
  const orgRole =
    membership.role === "org_owner" ? "org_admin" : membership.role;

  return {
    ok: true,
    userId: initiatorId,
    role: user.role ?? "user",
    orgRole,
    approvalActorUserId: input.approvalActorUserId ?? null,
  };
}

/** 将审批人写入 metadata，不覆盖发起人 */
export async function recordApprovalActor(input: {
  orgId: string;
  runId: string;
  approvalActorUserId: string;
}): Promise<void> {
  const run = await db.agentRun.findFirst({
    where: { id: input.runId, orgId: input.orgId },
    select: { metadata: true },
  });
  if (!run) return;
  const meta =
    run.metadata && typeof run.metadata === "object"
      ? { ...(run.metadata as Record<string, unknown>) }
      : {};
  const prev = Array.isArray(meta.approvalActorUserIds)
    ? (meta.approvalActorUserIds as string[])
    : [];
  const next = Array.from(new Set([...prev, input.approvalActorUserId]));
  meta.approvalActorUserId = input.approvalActorUserId;
  meta.approvalActorUserIds = next;
  await db.agentRun.update({
    where: { id: input.runId },
    data: { metadata: JSON.parse(JSON.stringify(meta)) },
  });
}
