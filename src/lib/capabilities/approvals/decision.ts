/**
 * 审批决策网关：Tenant + RBAC + 完整性 + 幂等 → ApprovalPort / PC decide
 * 不重写 PendingAction executor
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import {
  approveApprovalItem,
  rejectApprovalItem,
} from "@/lib/approval/port";
import { decideApproval } from "@/lib/product-content/jobs/service";
import type { CapabilitiesAccessContext } from "../types";
import { CapabilitiesAccessError } from "../access";
import { verifyPayloadIntegrity } from "./integrity";
import { getCapabilityApproval } from "./query";
import { parseApprovalId } from "./types";
import type { ApprovalProjection } from "./types";

export type DecisionAction = "approve" | "reject" | "cancel" | "retry";

export type DecisionInput = {
  approvalId: string;
  action: DecisionAction;
  note?: string;
  idempotencyKey?: string;
  /** 客户端声明的 hash（可选校验）；执行仍读服务端存储 */
  expectedPayloadHash?: string;
};

export type DecisionResult = {
  ok: boolean;
  approval?: ApprovalProjection;
  status?: string;
  message?: string;
  error?: string;
  code?: string;
  duplicate?: boolean;
};

async function rememberIdempotency(opts: {
  orgId: string;
  key: string;
  approvalKey: string;
  action: string;
  userId: string;
  result: DecisionResult;
}): Promise<DecisionResult | null> {
  try {
    await db.approvalDecisionIdempotency.create({
      data: {
        orgId: opts.orgId,
        idempotencyKey: opts.key,
        approvalKey: opts.approvalKey,
        action: opts.action,
        userId: opts.userId,
        resultJson: opts.result as object,
      },
    });
    return null;
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const existing = await db.approvalDecisionIdempotency.findUnique({
        where: {
          orgId_idempotencyKey: {
            orgId: opts.orgId,
            idempotencyKey: opts.key,
          },
        },
      });
      if (existing?.resultJson) {
        return {
          ...(existing.resultJson as DecisionResult),
          duplicate: true,
        };
      }
      return {
        ok: true,
        duplicate: true,
        message: "重复请求，已按首次结果处理",
      };
    }
    throw err;
  }
}

async function loadIdempotency(
  orgId: string,
  key: string,
): Promise<DecisionResult | null> {
  const existing = await db.approvalDecisionIdempotency.findUnique({
    where: {
      orgId_idempotencyKey: { orgId, idempotencyKey: key },
    },
  });
  if (!existing?.resultJson) return null;
  return { ...(existing.resultJson as DecisionResult), duplicate: true };
}

export async function decideCapabilityApproval(
  access: CapabilitiesAccessContext,
  input: DecisionInput,
): Promise<DecisionResult> {
  const parsed = parseApprovalId(input.approvalId);
  if (!parsed) {
    throw new CapabilitiesAccessError("审批不存在", "NOT_FOUND", 404);
  }

  if (input.idempotencyKey) {
    const cached = await loadIdempotency(
      access.orgId,
      input.idempotencyKey,
    );
    if (cached) return cached;
  }

  const projection = await getCapabilityApproval(access, input.approvalId);

  // 能力检查
  const capOk =
    (input.action === "approve" && projection.capabilities.canApprove) ||
    (input.action === "reject" && projection.capabilities.canReject) ||
    (input.action === "cancel" && projection.capabilities.canCancel) ||
    (input.action === "retry" && projection.capabilities.canRetry);

  if (!capOk) {
    await logAudit({
      userId: access.userId,
      orgId: access.orgId,
      action: "TOOL_AUTH_DENIED",
      targetType: "approval",
      targetId: input.approvalId,
      afterData: { reason: "capability_denied", action: input.action },
    });
    return {
      ok: false,
      error: "当前状态或角色不支持该操作",
      code: "capability_denied",
    };
  }

  // 过期
  if (
    projection.expiresAt &&
    new Date(projection.expiresAt).getTime() < Date.now() &&
    projection.status === "PENDING"
  ) {
    return {
      ok: false,
      error: "审批已过期",
      code: "expired",
    };
  }

  // PendingAction：完整性 + 条件更新防并发
  if (parsed.sourceType === "PENDING_ACTION") {
    const row = await db.pendingAction.findFirst({
      where: { id: parsed.sourceId, orgId: access.orgId },
    });
    if (!row) {
      throw new CapabilitiesAccessError("审批不存在", "NOT_FOUND", 404);
    }

    const integrity = verifyPayloadIntegrity({
      payload: row.payload,
      expectedHash: row.payloadHash ?? input.expectedPayloadHash,
      expectedVersion: row.payloadVersion,
      currentVersion: row.payloadVersion,
    });
    if (!integrity.ok) {
      await logAudit({
        userId: access.userId,
        orgId: access.orgId,
        action: "APPROVAL_EXECUTION_BLOCKED",
        targetType: "pending_action",
        targetId: row.id,
        afterData: { reason: integrity.reason },
      });
      return {
        ok: false,
        error: "审批内容已变化，请重新提交审批",
        code: integrity.reason,
      };
    }

    if (input.action === "cancel") {
      const updated = await db.pendingAction.updateMany({
        where: {
          id: row.id,
          orgId: access.orgId,
          status: "pending",
        },
        data: {
          status: "failed",
          failureReason: "已取消",
          decidedAt: new Date(),
          decidedById: access.userId,
        },
      });
      if (updated.count === 0) {
        return {
          ok: false,
          error: "审批状态已变更",
          code: "conflict",
        };
      }
      await logAudit({
        userId: access.userId,
        orgId: access.orgId,
        action: "APPROVAL_CANCELLED",
        targetType: "pending_action",
        targetId: row.id,
      });
      const result: DecisionResult = {
        ok: true,
        status: "CANCELLED",
        message: "已取消",
        approval: await getCapabilityApproval(access, input.approvalId),
      };
      if (input.idempotencyKey) {
        await rememberIdempotency({
          orgId: access.orgId,
          key: input.idempotencyKey,
          approvalKey: input.approvalId,
          action: input.action,
          userId: access.userId,
          result,
        });
      }
      return result;
    }

    if (input.action === "reject") {
      const port = await rejectApprovalItem("pending_action", row.id, {
        userId: access.userId,
        role: access.orgRole,
        orgId: access.orgId,
        note: input.note,
      });
      await logAudit({
        userId: access.userId,
        orgId: access.orgId,
        action: "APPROVAL_REJECTED",
        targetType: "pending_action",
        targetId: row.id,
        afterData: { ok: port.ok },
      });
      const result: DecisionResult = {
        ok: port.ok,
        status: "REJECTED",
        message: port.message,
        error: port.error,
        approval: await getCapabilityApproval(access, input.approvalId),
      };
      if (input.idempotencyKey) {
        await rememberIdempotency({
          orgId: access.orgId,
          key: input.idempotencyKey,
          approvalKey: input.approvalId,
          action: input.action,
          userId: access.userId,
          result,
        });
      }
      return result;
    }

    // approve / retry → ApprovalPort（内部走 executor，不重写）
    await logAudit({
      userId: access.userId,
      orgId: access.orgId,
      action: "APPROVAL_APPROVED",
      targetType: "pending_action",
      targetId: row.id,
    });
    await logAudit({
      userId: access.userId,
      orgId: access.orgId,
      action: "APPROVAL_EXECUTION_STARTED",
      targetType: "pending_action",
      targetId: row.id,
    });

    const port = await approveApprovalItem("pending_action", row.id, {
      userId: access.userId,
      role: access.orgRole,
      orgId: access.orgId,
      note: input.note,
    });

    await logAudit({
      userId: access.userId,
      orgId: access.orgId,
      action: port.ok ? "APPROVAL_EXECUTED" : "APPROVAL_EXECUTION_FAILED",
      targetType: "pending_action",
      targetId: row.id,
      afterData: {
        ok: port.ok,
        status: port.status,
        // 不记录完整 payload
      },
    });

    const result: DecisionResult = {
      ok: port.ok,
      status: port.status,
      message: port.message,
      error: port.error,
      approval: await getCapabilityApproval(access, input.approvalId),
    };
    if (input.idempotencyKey) {
      await rememberIdempotency({
        orgId: access.orgId,
        key: input.idempotencyKey,
        approvalKey: input.approvalId,
        action: input.action,
        userId: access.userId,
        result,
      });
    }
    return result;
  }

  if (parsed.sourceType === "APPROVAL_REQUEST") {
    if (input.action === "cancel" || input.action === "retry") {
      return {
        ok: false,
        error: "该审批源不支持此操作",
        code: "capability_denied",
      };
    }
    const fn =
      input.action === "approve" ? approveApprovalItem : rejectApprovalItem;
    const port = await fn("approval_request", parsed.sourceId, {
      userId: access.userId,
      role: access.orgRole,
      orgId: access.orgId,
      note: input.note,
    });
    await logAudit({
      userId: access.userId,
      orgId: access.orgId,
      action:
        input.action === "approve"
          ? "APPROVAL_APPROVED"
          : "APPROVAL_REJECTED",
      targetType: "approval_request",
      targetId: parsed.sourceId,
      afterData: { ok: port.ok },
    });
    const result: DecisionResult = {
      ok: port.ok,
      status: port.status,
      message: port.message,
      error: port.error,
      approval: await getCapabilityApproval(access, input.approvalId),
    };
    if (input.idempotencyKey) {
      await rememberIdempotency({
        orgId: access.orgId,
        key: input.idempotencyKey,
        approvalKey: input.approvalId,
        action: input.action,
        userId: access.userId,
        result,
      });
    }
    return result;
  }

  if (parsed.sourceType === "PRODUCT_CONTENT") {
    if (input.action === "cancel" || input.action === "retry") {
      return {
        ok: false,
        error: "该审批源不支持此操作",
        code: "capability_denied",
      };
    }
    const row = await db.productContentApproval.findFirst({
      where: { id: parsed.sourceId, orgId: access.orgId },
    });
    if (!row) {
      throw new CapabilitiesAccessError("审批不存在", "NOT_FOUND", 404);
    }
    await decideApproval({
      orgId: access.orgId,
      userId: access.userId,
      jobId: row.jobId,
      approvalId: row.id,
      decision: input.action === "approve" ? "approved" : "rejected",
      reason: input.note,
    });
    await logAudit({
      userId: access.userId,
      orgId: access.orgId,
      action:
        input.action === "approve"
          ? "APPROVAL_APPROVED"
          : "APPROVAL_REJECTED",
      targetType: "product_content_approval",
      targetId: row.id,
    });
    const result: DecisionResult = {
      ok: true,
      status: input.action === "approve" ? "APPROVED" : "REJECTED",
      approval: await getCapabilityApproval(access, input.approvalId),
    };
    if (input.idempotencyKey) {
      await rememberIdempotency({
        orgId: access.orgId,
        key: input.idempotencyKey,
        approvalKey: input.approvalId,
        action: input.action,
        userId: access.userId,
        result,
      });
    }
    return result;
  }

  return { ok: false, error: "未知审批源", code: "unknown_source" };
}
