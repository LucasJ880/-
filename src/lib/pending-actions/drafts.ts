/**
 * PR4 — 创建 PendingAction 草稿的 helper
 *
 * 工具层统一通过 createDraft() / createDraftBatch() 创建待审批草稿，
 * 职责：
 * - 落库
 * - 写审计日志
 * - 可选关联 AgentRun（取消 Run 时联动拒绝）
 * - 返回 ToolExecutionResult 给 LLM
 */

import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import type { ToolExecutionResult } from "@/lib/agent-core/types";
import type { PendingActionType } from "./types";
import { toPendingApprovalResult } from "./types";
import { computePayloadHash } from "@/lib/capabilities/approvals/integrity";

const DEFAULT_TTL_HOURS = 24;

export interface CreateDraftInput {
  type: PendingActionType;
  title: string;
  preview: string;
  payload: Record<string, unknown>;
  userId: string;
  orgId?: string;
  projectId?: string;
  workspaceId?: string;
  approverUserId?: string;
  requiredRole?: string;
  threadId?: string;
  messageId?: string;
  /** 关联 AgentRun.id */
  agentRunId?: string;
  /** 过期小时数（默认 24） */
  ttlHours?: number;
  policyVersion?: string;
  resourceVersion?: string;
}

export type CreatedDraftAction = {
  actionId: string;
  type: string;
  title: string;
  preview: string;
  payloadHash: string;
  agentRunId: string | null;
};

export type CreateDraftBatchResult =
  | { success: true; actions: CreatedDraftAction[] }
  | {
      success: false;
      errorCode: "DRAFT_CREATION_FAILED";
      /** 补偿后仍可能短暂存在，但不得保持 pending */
      compensatedActionIds: string[];
    };

/** 批次 Prepare 失败时的补偿：将仍为 pending 的动作标 failed */
export async function compensateBatchPrepareFailure(input: {
  actionIds: string[];
  userId: string;
  orgId?: string;
  reason?: string;
}): Promise<number> {
  if (input.actionIds.length === 0) return 0;
  const now = new Date();
  const reason = input.reason ?? "BATCH_PREPARE_FAILED";
  const updated = await db.pendingAction.updateMany({
    where: {
      id: { in: input.actionIds },
      status: "pending",
    },
    data: {
      status: "failed",
      failureReason: reason,
      decidedAt: now,
      decidedById: input.userId,
    },
  });

  for (const id of input.actionIds) {
    await logAudit({
      userId: input.userId,
      orgId: input.orgId,
      action: "APPROVAL_BATCH_PREPARE_FAILED",
      targetType: "pending_action",
      targetId: id,
      afterData: { failureReason: reason },
    });
  }
  return updated.count;
}

type DraftBatchAdapters = {
  /** 在事务中创建全部行；失败应抛错（事务回滚） */
  createAllInTransaction: (
    inputs: CreateDraftInput[],
  ) => Promise<CreatedDraftAction[]>;
  /** 事务成功后写审计；失败应抛错以触发补偿 */
  auditCreated: (actions: CreatedDraftAction[], inputs: CreateDraftInput[]) => Promise<void>;
  markAwaitingApproval: (orgId: string, agentRunId: string) => Promise<void>;
  compensate: (actionIds: string[], userId: string, orgId?: string) => Promise<number>;
  /** 测试注入：在第 N 个创建后失败（模拟非事务路径） */
  __failAfterCreateIndex?: number;
};

function buildCreateData(input: CreateDraftInput) {
  const ttl = input.ttlHours ?? DEFAULT_TTL_HOURS;
  const expiresAt = new Date(Date.now() + ttl * 3600 * 1000);
  const workspaceId =
    input.workspaceId ??
    (typeof input.payload.workspaceId === "string"
      ? input.payload.workspaceId
      : undefined);
  const payloadHash = computePayloadHash(input.payload);
  return {
    payloadHash,
    data: {
      type: input.type,
      title: input.title,
      preview: input.preview,
      payload: input.payload as object,
      status: "pending" as const,
      createdById: input.userId,
      orgId: input.orgId,
      projectId: input.projectId,
      workspaceId: workspaceId ?? null,
      payloadVersion: 1,
      payloadHash,
      policyVersion: input.policyVersion ?? "org-default-v1",
      resourceVersion: input.resourceVersion ?? null,
      approverUserId: input.approverUserId,
      requiredRole: input.requiredRole,
      threadId: input.threadId,
      messageId: input.messageId,
      agentRunId: input.agentRunId || null,
      expiresAt,
    },
  };
}

async function defaultCreateAllInTransaction(
  inputs: CreateDraftInput[],
): Promise<CreatedDraftAction[]> {
  return db.$transaction(async (tx) => {
    const out: CreatedDraftAction[] = [];
    for (const input of inputs) {
      const { payloadHash, data } = buildCreateData(input);
      const action = await tx.pendingAction.create({
        data,
        select: {
          id: true,
          type: true,
          title: true,
          preview: true,
          agentRunId: true,
        },
      });
      out.push({
        actionId: action.id,
        type: action.type,
        title: action.title,
        preview: action.preview,
        payloadHash,
        agentRunId: action.agentRunId,
      });
    }
    return out;
  });
}

/**
 * 批量创建草稿：事务内全部成功，或没有任何可操作 pending 残留。
 * 审计在事务外统一写入；失败则补偿标 failed。
 * 成功后只调用一次 markAgentRunAwaitingApproval。
 */
export async function createDraftBatch(
  inputs: CreateDraftInput[],
  adapters?: Partial<DraftBatchAdapters>,
): Promise<CreateDraftBatchResult> {
  if (inputs.length === 0) {
    return { success: true, actions: [] };
  }

  const userId = inputs[0].userId;
  const orgId = inputs[0].orgId;
  const agentRunId = inputs.find((i) => i.agentRunId)?.agentRunId;

  const impl: DraftBatchAdapters = {
    createAllInTransaction: adapters?.createAllInTransaction ?? defaultCreateAllInTransaction,
    auditCreated:
      adapters?.auditCreated ??
      (async (actions, sourceInputs) => {
        for (let i = 0; i < actions.length; i++) {
          const action = actions[i];
          const input = sourceInputs[i];
          await logAudit({
            userId: input.userId,
            orgId: input.orgId,
            projectId: input.projectId,
            action: "APPROVAL_CREATED",
            targetType: "pending_action",
            targetId: action.actionId,
            afterData: {
              type: action.type,
              title: action.title,
              payloadHash: action.payloadHash,
              agentRunId: action.agentRunId,
              batch: true,
            },
          });
        }
      }),
    markAwaitingApproval:
      adapters?.markAwaitingApproval ??
      (async (o, runId) => {
        const { markAgentRunAwaitingApproval } = await import(
          "@/lib/agent-runtime/pending-link"
        );
        await markAgentRunAwaitingApproval(o, runId);
      }),
    compensate:
      adapters?.compensate ??
      ((ids, uid, oid) =>
        compensateBatchPrepareFailure({
          actionIds: ids,
          userId: uid,
          orgId: oid,
          reason: "BATCH_PREPARE_FAILED",
        })),
    __failAfterCreateIndex: adapters?.__failAfterCreateIndex,
  };

  let created: CreatedDraftAction[] = [];
  try {
    if (typeof impl.__failAfterCreateIndex === "number") {
      // 测试路径：逐条创建以模拟「第一张成功、第二张失败」
      created = [];
      for (let i = 0; i < inputs.length; i++) {
        if (i === impl.__failAfterCreateIndex) {
          throw new Error("BATCH_CREATE_INJECTED_FAILURE");
        }
        const slice = await impl.createAllInTransaction([inputs[i]]);
        created.push(...slice);
      }
    } else {
      created = await impl.createAllInTransaction(inputs);
    }

    await impl.auditCreated(created, inputs);

    if (agentRunId && orgId) {
      await impl.markAwaitingApproval(orgId, agentRunId);
    }

    return { success: true, actions: created };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg !== "BATCH_CREATE_INJECTED_FAILURE") {
      console.error("[createDraftBatch] failed:", e);
    }
    const ids = created.map((a) => a.actionId);
    if (ids.length > 0) {
      await impl.compensate(ids, userId, orgId).catch((err) => {
        console.error("[createDraftBatch] compensate failed:", err);
      });
    }
    return {
      success: false,
      errorCode: "DRAFT_CREATION_FAILED",
      compensatedActionIds: ids,
    };
  }
}

/**
 * 落草稿 → 返回给 LLM 的结构化结果。
 * 调用方直接把返回值作为 ToolExecutionResult 返回即可。
 */
export async function createDraft(
  input: CreateDraftInput,
): Promise<ToolExecutionResult> {
  const batch = await createDraftBatch([input]);
  if (!batch.success || batch.actions.length === 0) {
    return {
      success: false,
      data: null,
      error: "创建待确认草稿失败",
    };
  }
  const action = batch.actions[0];
  return {
    success: true,
    data: toPendingApprovalResult({
      id: action.actionId,
      type: action.type,
      title: action.title,
      preview: action.preview,
    }),
  };
}
