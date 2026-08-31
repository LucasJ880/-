/**
 * SupplierSearchRun 生命周期 + 不可变治理（B1 / B.1 §7–§9）
 *
 * - 状态机：PLANNED → RUNNING → COMPLETED/FAILED；PLANNED/RUNNING → CANCELLED；
 *   终态不得重入（服务层强制，不依赖 UI）。
 * - 四快照（brief/requirements/sourceConfig/queries）+ 三版本在创建期写死；
 *   终态后任何语义字段禁改——重评估 = 新 Run，不是 PATCH 旧 Run。
 * - 所有函数 org-scoped：查询自带 actor.orgId，跨租户一律按 NOT_FOUND 处理（不泄露存在性）。
 */

import type { Prisma } from "@prisma/client";
import { writeAuditLog } from "@/lib/audit/logger";
import { db } from "@/lib/db";
import type { SupplierIntelActor } from "./actor";
import {
  SUPPLIER_EVALUATION_VERSION_V1,
  SUPPLIER_INTEL_AUDIT_ACTIONS,
  canTransitionRun,
  isRunTerminal,
} from "./constants";
import { SupplierIntelError } from "./errors";
import { validateRequirementSnapshot } from "./requirement-snapshot";
import { SUPPLIER_SCORE_V1 } from "./score-contract";

const RUN_TARGET_TYPE = "supplier_search_run";
/** brief/sourceConfig 快照序列化上限（防滥用；正常 brief 远低于此） */
const SNAPSHOT_MAX_BYTES = 131_072;

function assertJsonObjectWithinLimit(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SupplierIntelError("INVALID_INPUT", `${label} 必须是对象`);
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new SupplierIntelError("INVALID_INPUT", `${label} 无法序列化`);
  }
  if (Buffer.byteLength(serialized, "utf8") > SNAPSHOT_MAX_BYTES) {
    throw new SupplierIntelError("INVALID_INPUT", `${label} 超出快照大小上限`);
  }
  return value as Record<string, unknown>;
}

async function assertProjectPointerInOrg(
  orgId: string,
  pointer: string | null | undefined,
  label: string,
): Promise<string | null> {
  const id = pointer?.trim() || null;
  if (!id) return null;
  const row = await db.project.findFirst({ where: { id, orgId }, select: { id: true } });
  if (!row) {
    throw new SupplierIntelError("INVALID_INPUT", `${label} 不存在或不属于当前组织`);
  }
  return id;
}

export interface CreateSearchRunInput {
  projectId?: string | null;
  tenderId?: string | null;
  /** SupplierSearchBrief 全量（S1 不校验内部结构，S2 起由 buildSupplierSearchBrief 产出） */
  brief: unknown;
  /** canonical requirements（三值 mandatory 必须保留，见 requirement-snapshot.ts） */
  requirements: unknown;
  sourceConfig?: unknown;
  promptName?: string | null;
  promptVersion?: string | null;
}

export async function createSearchRun(actor: SupplierIntelActor, input: CreateSearchRunInput) {
  const brief = assertJsonObjectWithinLimit(input.brief, "brief 快照");
  const requirements = validateRequirementSnapshot(input.requirements);
  const sourceConfig =
    input.sourceConfig === undefined || input.sourceConfig === null
      ? {}
      : assertJsonObjectWithinLimit(input.sourceConfig, "sourceConfig 快照");

  const projectId = await assertProjectPointerInOrg(actor.orgId, input.projectId, "项目");
  const tenderId = await assertProjectPointerInOrg(actor.orgId, input.tenderId, "招标项目");

  return db.$transaction(async (tx) => {
    const run = await tx.supplierSearchRun.create({
      data: {
        orgId: actor.orgId,
        projectId,
        tenderId,
        status: "PLANNED",
        briefSnapshotJson: brief as Prisma.InputJsonValue,
        requirementSnapshotJson: requirements as unknown as Prisma.InputJsonValue,
        sourceConfigJson: sourceConfig as Prisma.InputJsonValue,
        queriesJson: [] as unknown as Prisma.InputJsonValue,
        promptName: input.promptName?.trim() || null,
        promptVersion: input.promptVersion?.trim() || null,
        scoreVersion: SUPPLIER_SCORE_V1.version,
        evaluationVersion: SUPPLIER_EVALUATION_VERSION_V1,
        createdByUserId: actor.userId,
      },
    });
    await writeAuditLog(tx, {
      userId: actor.userId,
      orgId: actor.orgId,
      projectId,
      action: SUPPLIER_INTEL_AUDIT_ACTIONS.RUN_CREATED,
      targetType: RUN_TARGET_TYPE,
      targetId: run.id,
      afterData: {
        status: run.status,
        scoreVersion: run.scoreVersion,
        evaluationVersion: run.evaluationVersion,
        requirementCount: requirements.length,
      },
    });
    return run;
  });
}

export async function getSearchRun(actor: SupplierIntelActor, runId: string) {
  return db.supplierSearchRun.findFirst({ where: { id: runId, orgId: actor.orgId } });
}

export async function listSearchRuns(
  actor: SupplierIntelActor,
  opts?: { status?: string; take?: number },
) {
  return db.supplierSearchRun.findMany({
    where: { orgId: actor.orgId, ...(opts?.status ? { status: opts.status } : {}) },
    orderBy: { createdAt: "desc" },
    take: Math.min(opts?.take ?? 50, 200),
  });
}

type RunLifecyclePatch = {
  startedAt?: Date;
  completedAt?: Date;
  statusDetailJson?: Prisma.InputJsonValue;
};

async function transitionRun(
  actor: SupplierIntelActor,
  runId: string,
  to: "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED",
  action: string,
  patch: RunLifecyclePatch,
) {
  return db.$transaction(async (tx) => {
    const run = await tx.supplierSearchRun.findFirst({
      where: { id: runId, orgId: actor.orgId },
      select: { id: true, status: true, projectId: true },
    });
    if (!run) throw new SupplierIntelError("NOT_FOUND", "搜索运行不存在");
    if (!canTransitionRun(run.status, to)) {
      throw new SupplierIntelError(
        "INVALID_RUN_TRANSITION",
        `不允许的状态迁移：${run.status} → ${to}${isRunTerminal(run.status) ? "（终态不可重入）" : ""}`,
      );
    }
    // 乐观并发守卫：以读取时的 status 为条件更新，被并发抢先则 count=0
    const updated = await tx.supplierSearchRun.updateMany({
      where: { id: runId, orgId: actor.orgId, status: run.status },
      data: { status: to, ...patch },
    });
    if (updated.count !== 1) {
      throw new SupplierIntelError(
        "INVALID_RUN_TRANSITION",
        `状态已被并发修改：${run.status} → ${to} 未生效`,
      );
    }
    await writeAuditLog(tx, {
      userId: actor.userId,
      orgId: actor.orgId,
      projectId: run.projectId,
      action,
      targetType: RUN_TARGET_TYPE,
      targetId: runId,
      beforeData: { status: run.status },
      afterData: { status: to },
    });
    return tx.supplierSearchRun.findFirst({ where: { id: runId, orgId: actor.orgId } });
  });
}

export async function startSearchRun(actor: SupplierIntelActor, runId: string) {
  return transitionRun(actor, runId, "RUNNING", SUPPLIER_INTEL_AUDIT_ACTIONS.RUN_STARTED, {
    startedAt: new Date(),
  });
}

export async function completeSearchRun(
  actor: SupplierIntelActor,
  runId: string,
  statusDetail?: unknown,
) {
  return transitionRun(actor, runId, "COMPLETED", SUPPLIER_INTEL_AUDIT_ACTIONS.RUN_COMPLETED, {
    completedAt: new Date(),
    ...(statusDetail !== undefined
      ? { statusDetailJson: statusDetail as Prisma.InputJsonValue }
      : {}),
  });
}

export async function failSearchRun(
  actor: SupplierIntelActor,
  runId: string,
  failureReason: string,
  statusDetail?: unknown,
) {
  return transitionRun(actor, runId, "FAILED", SUPPLIER_INTEL_AUDIT_ACTIONS.RUN_FAILED, {
    completedAt: new Date(),
    statusDetailJson: (statusDetail ?? {
      status: "error",
      reason: failureReason.slice(0, 2000),
    }) as Prisma.InputJsonValue,
  });
}

export async function cancelSearchRun(actor: SupplierIntelActor, runId: string) {
  return transitionRun(actor, runId, "CANCELLED", SUPPLIER_INTEL_AUDIT_ACTIONS.RUN_CANCELLED, {
    completedAt: new Date(),
  });
}

/**
 * 运行期工作数据（queries/sourceConfig/statusDetail）——仅 PLANNED/RUNNING 可写；
 * 终态后一律 RUN_IMMUTABLE。快照语义字段（brief/requirements/版本/createdBy/startedAt）
 * 没有任何更新入口：创建即冻结（B.1 §8）。
 */
export async function updateRunWorkingData(
  actor: SupplierIntelActor,
  runId: string,
  patch: { queries?: unknown; sourceConfig?: unknown; statusDetail?: unknown },
) {
  const data: Record<string, Prisma.InputJsonValue> = {};
  if (patch.queries !== undefined) {
    if (!Array.isArray(patch.queries)) {
      throw new SupplierIntelError("INVALID_INPUT", "queries 必须是数组");
    }
    data.queriesJson = patch.queries as Prisma.InputJsonValue;
  }
  if (patch.sourceConfig !== undefined) {
    data.sourceConfigJson = assertJsonObjectWithinLimit(
      patch.sourceConfig,
      "sourceConfig 快照",
    ) as Prisma.InputJsonValue;
  }
  if (patch.statusDetail !== undefined) {
    data.statusDetailJson = patch.statusDetail as Prisma.InputJsonValue;
  }
  if (Object.keys(data).length === 0) {
    throw new SupplierIntelError("INVALID_INPUT", "没有可更新的字段");
  }

  const updated = await db.supplierSearchRun.updateMany({
    where: { id: runId, orgId: actor.orgId, status: { in: ["PLANNED", "RUNNING"] } },
    data,
  });
  if (updated.count === 1) {
    return db.supplierSearchRun.findFirst({ where: { id: runId, orgId: actor.orgId } });
  }
  const existing = await db.supplierSearchRun.findFirst({
    where: { id: runId, orgId: actor.orgId },
    select: { status: true },
  });
  if (!existing) throw new SupplierIntelError("NOT_FOUND", "搜索运行不存在");
  throw new SupplierIntelError(
    "RUN_IMMUTABLE",
    `Run 已处于终态 ${existing.status}，快照与工作数据不可修改；重评估请新建 Run`,
  );
}
