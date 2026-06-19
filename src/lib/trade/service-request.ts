/**
 * 外贸客户服务工单 — 服务层
 *
 * 业务：微信 AI 助手受理国内外贸客户的需求（美工出图 / 文档总结 / 会议纪要 / 群聊总结），
 * 结构化落库到客户所属组织（orgId），随后由加拿大团队处理并回传。
 *
 * 隔离铁律：
 * - 所有创建 / 查询 / 资产写入都必须显式带 orgId（客户 org），禁止 default 兜底。
 * - 客户 org ↔ 加拿大处理方 org 之间唯一的跨组织写入，集中在 `assignToFulfillment`，
 *   它是本系统唯一允许写 `fulfillmentOrgId` 的函数（审计脚本会强制校验这一点）。
 * - bid 招标数据在不同的表（Project 等），与本表物理隔离，客户不可见。
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/common/logger";

export type ServiceRequestType =
  | "design_image"
  | "doc_summary"
  | "meeting_minutes"
  | "group_summary"
  | "other";

export type ServiceRequestStatus =
  | "new"
  | "accepted"
  | "in_progress"
  | "delivered"
  | "closed"
  | "cancelled";

export type ServiceRequestPriority = "low" | "medium" | "high" | "urgent";

const REQUEST_TYPES: ReadonlySet<string> = new Set<ServiceRequestType>([
  "design_image",
  "doc_summary",
  "meeting_minutes",
  "group_summary",
  "other",
]);

function normalizeRequestType(value: string | null | undefined): ServiceRequestType {
  return value && REQUEST_TYPES.has(value) ? (value as ServiceRequestType) : "other";
}

function assertOrgId(orgId: string | null | undefined, where: string): string {
  const v = (orgId ?? "").trim();
  if (!v) throw new Error(`[service-request] 缺少 orgId（${where}），拒绝执行以保证租户隔离`);
  if (v === "default") throw new Error(`[service-request] 非法 orgId="default"（${where}）`);
  return v;
}

// ── 创建 / 查询（均强制客户 org 隔离）────────────────────────────

export async function createServiceRequest(input: {
  orgId: string;
  requestType: string;
  title: string;
  description?: string | null;
  structuredSpec?: unknown;
  priority?: ServiceRequestPriority;
  sourceChannel?: string | null;
  externalUserId?: string | null;
  bindingId?: string | null;
  createdById?: string | null;
}) {
  const orgId = assertOrgId(input.orgId, "createServiceRequest");
  const title = input.title.trim() || "未命名需求";

  const request = await db.tradeServiceRequest.create({
    data: {
      orgId,
      requestType: normalizeRequestType(input.requestType),
      title,
      description: input.description ?? null,
      structuredSpec:
        input.structuredSpec === undefined
          ? undefined
          : (input.structuredSpec as object | null) ?? undefined,
      priority: input.priority ?? "medium",
      status: "new",
      sourceChannel: input.sourceChannel ?? null,
      externalUserId: input.externalUserId ?? null,
      bindingId: input.bindingId ?? null,
      createdById: input.createdById ?? null,
    },
  });

  logger.info("trade.service_request.created", {
    orgId,
    requestId: request.id,
    requestType: request.requestType,
    sourceChannel: request.sourceChannel ?? undefined,
  });

  return request;
}

export async function listServiceRequestsForOrg(input: {
  orgId: string;
  status?: ServiceRequestStatus;
  limit?: number;
  cursor?: string | null;
}) {
  const orgId = assertOrgId(input.orgId, "listServiceRequestsForOrg");
  const limit = Math.min(input.limit ?? 50, 200);

  const rows = await db.tradeServiceRequest.findMany({
    where: { orgId, ...(input.status ? { status: input.status } : {}) },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();
  return { items: rows, nextCursor: hasMore ? rows[rows.length - 1]?.id ?? null : null };
}

/** 单条加载（按客户 org 联合查询，跨 org 访问返回 null） */
export async function getServiceRequestForOrg(requestId: string, orgId: string) {
  const safeOrgId = assertOrgId(orgId, "getServiceRequestForOrg");
  return db.tradeServiceRequest.findFirst({
    where: { id: requestId, orgId: safeOrgId },
    include: { assets: true },
  });
}

// ── 资产（输入 / 交付物）────────────────────────────────────────

export async function addServiceAsset(input: {
  requestId: string;
  orgId: string;
  kind: "input" | "deliverable";
  fileUrl: string;
  fileName: string;
  mimeType?: string | null;
  meta?: unknown;
  createdById?: string | null;
}) {
  const orgId = assertOrgId(input.orgId, "addServiceAsset");

  // 防御：资产必须挂在同一客户 org 的工单上，禁止跨 org 写资产
  const owner = await db.tradeServiceRequest.findFirst({
    where: { id: input.requestId, orgId },
    select: { id: true },
  });
  if (!owner) {
    throw new Error("[service-request] 工单不存在或不属于该组织，拒绝写入资产");
  }

  return db.tradeServiceAsset.create({
    data: {
      orgId,
      requestId: input.requestId,
      kind: input.kind,
      fileUrl: input.fileUrl,
      fileName: input.fileName,
      mimeType: input.mimeType ?? null,
      meta: input.meta === undefined ? undefined : (input.meta as object | null) ?? undefined,
      createdById: input.createdById ?? null,
    },
  });
}

/**
 * 统一资产写入（供 API 使用）：调用方可以是客户 org（归属方）或处理方 org（fulfillmentOrgId）。
 * 资产 orgId 始终写客户 org（request.orgId），保证资产归属客户租户。
 */
export async function addRequestAsset(input: {
  requestId: string;
  callerOrgId: string;
  kind: "input" | "deliverable";
  fileUrl: string;
  fileName: string;
  mimeType?: string | null;
  meta?: unknown;
  createdById?: string | null;
}) {
  const callerOrgId = assertOrgId(input.callerOrgId, "addRequestAsset");
  const request = await db.tradeServiceRequest.findFirst({
    where: {
      id: input.requestId,
      OR: [{ orgId: callerOrgId }, { fulfillmentOrgId: callerOrgId }],
    },
    select: { id: true, orgId: true },
  });
  if (!request) {
    throw new Error("[service-request] 工单不存在或无权访问，拒绝写入资产");
  }

  return db.tradeServiceAsset.create({
    data: {
      orgId: request.orgId,
      requestId: request.id,
      kind: input.kind,
      fileUrl: input.fileUrl,
      fileName: input.fileName,
      mimeType: input.mimeType ?? null,
      meta: input.meta === undefined ? undefined : (input.meta as object | null) ?? undefined,
      createdById: input.createdById ?? null,
    },
  });
}

// ── 跨组织桥接（唯一允许写 fulfillmentOrgId 的入口）──────────────

/**
 * 受控跨组织中转：把客户 org 的工单指派给加拿大处理方 org。
 *
 * 这是整个系统中唯一允许写入 `fulfillmentOrgId` 的函数。它不暴露客户 org 的其它数据，
 * 也不让处理方触达 bid 招标数据；处理方后续仅能按 `fulfillmentOrgId` 看到被指派的工单。
 *
 * @param ownerOrgId 调用方确认的客户 org（工单归属），用于二次校验防止越权指派他人工单。
 */
export async function assignToFulfillment(input: {
  requestId: string;
  ownerOrgId: string;
  fulfillmentOrgId: string;
  assigneeId?: string | null;
}) {
  const ownerOrgId = assertOrgId(input.ownerOrgId, "assignToFulfillment.ownerOrgId");
  const fulfillmentOrgId = assertOrgId(
    input.fulfillmentOrgId,
    "assignToFulfillment.fulfillmentOrgId",
  );

  // 1. 工单必须属于声明的客户 org
  const request = await db.tradeServiceRequest.findFirst({
    where: { id: input.requestId, orgId: ownerOrgId },
    select: { id: true, status: true },
  });
  if (!request) {
    throw new Error("[service-request] 工单不存在或不属于该客户组织，拒绝指派");
  }

  // 2. 处理方 org 必须是真实存在的 active 组织
  const fulfillmentOrg = await db.organization.findFirst({
    where: { id: fulfillmentOrgId, status: "active" },
    select: { id: true },
  });
  if (!fulfillmentOrg) {
    throw new Error("[service-request] 处理方组织不存在或未激活，拒绝指派");
  }

  // 3. 可选：处理人必须是处理方 org 的 active 成员
  if (input.assigneeId) {
    const member = await db.organizationMember.findFirst({
      where: { userId: input.assigneeId, orgId: fulfillmentOrgId, status: "active" },
      select: { id: true },
    });
    if (!member) {
      throw new Error("[service-request] 处理人不属于处理方组织，拒绝指派");
    }
  }

  const updated = await db.tradeServiceRequest.update({
    where: { id: input.requestId },
    data: {
      fulfillmentOrgId,
      assigneeId: input.assigneeId ?? null,
      status: "accepted",
      assignedAt: new Date(),
    },
  });

  logger.info("trade.service_request.assigned", {
    requestId: updated.id,
    ownerOrgId,
    fulfillmentOrgId,
    assigneeId: input.assigneeId ?? undefined,
  });

  return updated;
}

/** 处理方视角：按 (id, fulfillmentOrgId) 单条加载被指派工单（跨 org 访问返回 null） */
export async function getFulfillmentRequest(requestId: string, fulfillmentOrgId: string) {
  const orgId = assertOrgId(fulfillmentOrgId, "getFulfillmentRequest");
  return db.tradeServiceRequest.findFirst({
    where: { id: requestId, fulfillmentOrgId: orgId },
    include: { assets: true },
  });
}

/**
 * 处理方写入交付物资产。
 *
 * 访问控制按 fulfillmentOrgId（处理方）校验，但资产 orgId 写客户 org（request.orgId），
 * 以便客户侧能看到交付物，且资产始终归属客户租户。属于受控桥接面的一部分。
 */
export async function addDeliverableForFulfillment(input: {
  requestId: string;
  fulfillmentOrgId: string;
  fileUrl: string;
  fileName: string;
  mimeType?: string | null;
  meta?: unknown;
  createdById?: string | null;
}) {
  const fulfillmentOrgId = assertOrgId(input.fulfillmentOrgId, "addDeliverableForFulfillment");
  const request = await db.tradeServiceRequest.findFirst({
    where: { id: input.requestId, fulfillmentOrgId },
    select: { id: true, orgId: true },
  });
  if (!request) {
    throw new Error("[service-request] 工单不存在或未指派给该处理方，拒绝写入交付物");
  }

  return db.tradeServiceAsset.create({
    data: {
      orgId: request.orgId, // 资产归属客户 org
      requestId: request.id,
      kind: "deliverable",
      fileUrl: input.fileUrl,
      fileName: input.fileName,
      mimeType: input.mimeType ?? null,
      meta: input.meta === undefined ? undefined : (input.meta as object | null) ?? undefined,
      createdById: input.createdById ?? null,
    },
  });
}

/** 处理方更新工单状态（按 fulfillmentOrgId 校验）。status=delivered 时写 deliveredAt。 */
export async function setFulfillmentStatus(input: {
  requestId: string;
  fulfillmentOrgId: string;
  status: ServiceRequestStatus;
  assigneeId?: string | null;
}) {
  const fulfillmentOrgId = assertOrgId(input.fulfillmentOrgId, "setFulfillmentStatus");
  const request = await db.tradeServiceRequest.findFirst({
    where: { id: input.requestId, fulfillmentOrgId },
    select: { id: true },
  });
  if (!request) {
    throw new Error("[service-request] 工单不存在或未指派给该处理方，拒绝更新状态");
  }

  return db.tradeServiceRequest.update({
    where: { id: input.requestId },
    data: {
      status: input.status,
      ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
      ...(input.status === "delivered" ? { deliveredAt: new Date() } : {}),
      ...(input.status === "closed" ? { closedAt: new Date() } : {}),
    },
  });
}

/** 处理方视角：按 fulfillmentOrgId 列出被指派的工单（不暴露客户 org 其它数据） */
export async function listFulfillmentRequests(input: {
  fulfillmentOrgId: string;
  status?: ServiceRequestStatus;
  assigneeId?: string | null;
  limit?: number;
  cursor?: string | null;
}) {
  const fulfillmentOrgId = assertOrgId(input.fulfillmentOrgId, "listFulfillmentRequests");
  const limit = Math.min(input.limit ?? 50, 200);

  const rows = await db.tradeServiceRequest.findMany({
    where: {
      fulfillmentOrgId,
      ...(input.status ? { status: input.status } : {}),
      ...(input.assigneeId ? { assigneeId: input.assigneeId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();
  return { items: rows, nextCursor: hasMore ? rows[rows.length - 1]?.id ?? null : null };
}
