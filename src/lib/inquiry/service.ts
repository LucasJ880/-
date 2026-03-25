import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import {
  INQUIRY_STATUS,
  ITEM_STATUS,
  type InquiryStatus,
  type ItemStatus,
  type InquiryScope,
  type ItemScope,
  type CreateInquiryInput,
  type UpdateInquiryInput,
  type MarkSentInput,
  type RecordQuoteInput,
  type QuoteCompareRow,
  validateQuoteInput,
} from "./types";
import {
  canTransitionInquiry,
  canTransitionItem,
  isValidInquiryStatus,
} from "./status";

// ============================================================
// ProjectInquiry + InquiryItem 服务层
// ============================================================

// ── 资源归属校验 ──────────────────────────────────────────────

export class ScopeError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 404
  ) {
    super(message);
    this.name = "ScopeError";
  }
}

export class BusinessError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400
  ) {
    super(message);
    this.name = "BusinessError";
  }
}

async function resolveInquiry(scope: InquiryScope) {
  const inquiry = await db.projectInquiry.findUnique({
    where: { id: scope.inquiryId },
  });
  if (!inquiry) throw new ScopeError("询价轮次不存在");
  if (inquiry.projectId !== scope.projectId) {
    throw new ScopeError("询价轮次不属于该项目");
  }
  return inquiry;
}

async function resolveItem(scope: ItemScope) {
  const inquiry = await resolveInquiry(scope);
  const item = await db.inquiryItem.findUnique({
    where: { id: scope.itemId },
  });
  if (!item) throw new ScopeError("询价项不存在");
  if (item.inquiryId !== scope.inquiryId) {
    throw new ScopeError("询价项不属于该轮询价");
  }
  return { inquiry, item };
}

// ── Prisma 错误映射 ──────────────────────────────────────────

export function toPrismaHttpError(err: unknown): { msg: string; status: number } {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return { msg: "记录已存在（唯一约束冲突）", status: 409 };
    }
    if (err.code === "P2025") {
      return { msg: "目标记录不存在", status: 404 };
    }
  }
  if (err instanceof ScopeError) {
    return { msg: err.message, status: err.statusCode };
  }
  if (err instanceof BusinessError) {
    return { msg: err.message, status: err.statusCode };
  }
  if (err instanceof Error) {
    console.error("[InquiryService] Unhandled error:", err);
    return { msg: "服务器内部错误", status: 500 };
  }
  return { msg: "服务器内部错误", status: 500 };
}

// ── 创建询价轮次 ──────────────────────────────────────────────

export async function createInquiry(input: CreateInquiryInput, userId: string) {
  const maxRound = await db.projectInquiry.aggregate({
    where: { projectId: input.projectId },
    _max: { roundNumber: true },
  });
  const nextRound = (maxRound._max.roundNumber ?? 0) + 1;

  return db.projectInquiry.create({
    data: {
      projectId: input.projectId,
      roundNumber: nextRound,
      title: input.title?.trim() || `第 ${nextRound} 轮询价`,
      scope: input.scope?.trim() || null,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      createdById: userId,
    },
    include: { items: { include: { supplier: true } } },
  });
}

// ── 更新询价轮次 ──────────────────────────────────────────────

export async function updateInquiry(
  scope: InquiryScope,
  input: UpdateInquiryInput
) {
  const inquiry = await resolveInquiry(scope);

  if (input.status && input.status !== inquiry.status) {
    if (!isValidInquiryStatus(input.status)) {
      throw new BusinessError(`无效的询价状态: ${input.status}`);
    }
    if (
      !canTransitionInquiry(
        inquiry.status as InquiryStatus,
        input.status as InquiryStatus
      )
    ) {
      throw new BusinessError(
        `询价状态不允许从「${inquiry.status}」变为「${input.status}」`
      );
    }
  }

  const data: Record<string, unknown> = {};
  if (input.title !== undefined) data.title = input.title?.trim() || null;
  if (input.scope !== undefined) data.scope = input.scope?.trim() || null;
  if (input.status !== undefined) data.status = input.status;
  if (input.dueDate !== undefined) {
    data.dueDate = input.dueDate ? new Date(input.dueDate) : null;
  }

  return db.projectInquiry.update({
    where: { id: scope.inquiryId },
    data,
    include: { items: { include: { supplier: true } } },
  });
}

// ── 获取单个询价轮次 ─────────────────────────────────────────

export async function getInquiry(scope: InquiryScope) {
  const inquiry = await resolveInquiry(scope);
  return db.projectInquiry.findUnique({
    where: { id: inquiry.id },
    include: {
      items: {
        include: { supplier: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

// ── 列出项目的所有询价轮次 ───────────────────────────────────

export async function listInquiries(projectId: string) {
  return db.projectInquiry.findMany({
    where: { projectId },
    orderBy: { roundNumber: "asc" },
    include: {
      items: {
        include: { supplier: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

// ── 添加供应商到询价轮次 ─────────────────────────────────────

export async function addInquiryItem(
  scope: InquiryScope,
  supplierId: string,
  userId: string,
  contactNotes?: string
) {
  const inquiry = await resolveInquiry(scope);
  if (
    inquiry.status === INQUIRY_STATUS.COMPLETED ||
    inquiry.status === INQUIRY_STATUS.CANCELED
  ) {
    throw new BusinessError("该轮询价已结束，不能再添加供应商");
  }

  const supplier = await db.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) throw new ScopeError("供应商不存在");

  return db.inquiryItem.create({
    data: {
      inquiryId: scope.inquiryId,
      supplierId,
      contactNotes: contactNotes?.trim() || null,
      createdById: userId,
    },
    include: { supplier: true },
  });
}

// ── 删除询价项（仅 pending 可删） ─────────────────────────────

export async function removeInquiryItem(scope: ItemScope) {
  const { item } = await resolveItem(scope);
  if (item.status !== ITEM_STATUS.PENDING) {
    throw new BusinessError("只有待发送状态的询价项可以移除");
  }
  return db.inquiryItem.delete({ where: { id: scope.itemId } });
}

// ── mark-sent ─────────────────────────────────────────────────

export async function markItemSent(scope: ItemScope, input: MarkSentInput) {
  const { item } = await resolveItem(scope);
  if (!canTransitionItem(item.status as ItemStatus, ITEM_STATUS.SENT)) {
    throw new BusinessError(`当前状态「${item.status}」不允许标记为已发送`);
  }

  return db.inquiryItem.update({
    where: { id: scope.itemId },
    data: {
      status: ITEM_STATUS.SENT,
      sentVia: input.sentVia,
      sentAt: new Date(),
    },
    include: { supplier: true },
  });
}

// ── mark-replied ──────────────────────────────────────────────

export async function markItemReplied(scope: ItemScope, notes?: string) {
  const { item } = await resolveItem(scope);
  if (!canTransitionItem(item.status as ItemStatus, ITEM_STATUS.REPLIED)) {
    throw new BusinessError(`当前状态「${item.status}」不允许标记为已回复`);
  }

  return db.inquiryItem.update({
    where: { id: scope.itemId },
    data: {
      status: ITEM_STATUS.REPLIED,
      repliedAt: new Date(),
      contactNotes: notes?.trim() ?? item.contactNotes,
    },
    include: { supplier: true },
  });
}

// ── record-quote ──────────────────────────────────────────────

export async function recordQuote(scope: ItemScope, input: RecordQuoteInput) {
  const { item } = await resolveItem(scope);

  const current = item.status as ItemStatus;
  if (
    !canTransitionItem(current, ITEM_STATUS.QUOTED) &&
    current !== ITEM_STATUS.QUOTED
  ) {
    throw new BusinessError(`当前状态「${current}」不允许录入报价`);
  }

  const validationErr = validateQuoteInput(input);
  if (validationErr) throw new BusinessError(validationErr);

  const data: Record<string, unknown> = {
    status: ITEM_STATUS.QUOTED,
  };
  if (input.unitPrice !== undefined)
    data.unitPrice = new Prisma.Decimal(input.unitPrice);
  if (input.totalPrice !== undefined)
    data.totalPrice = new Prisma.Decimal(input.totalPrice);
  if (input.currency !== undefined) data.currency = input.currency;
  if (input.deliveryDays !== undefined) data.deliveryDays = input.deliveryDays;
  if (input.validUntil !== undefined)
    data.validUntil = input.validUntil ? new Date(input.validUntil) : null;
  if (input.quoteNotes !== undefined)
    data.quoteNotes = input.quoteNotes?.trim() || null;

  if (current !== ITEM_STATUS.QUOTED) {
    data.repliedAt = item.repliedAt ?? new Date();
  }

  return db.inquiryItem.update({
    where: { id: scope.itemId },
    data,
    include: { supplier: true },
  });
}

// ── mark-declined ─────────────────────────────────────────────

export async function markItemDeclined(scope: ItemScope) {
  const { item } = await resolveItem(scope);
  if (!canTransitionItem(item.status as ItemStatus, ITEM_STATUS.DECLINED)) {
    throw new BusinessError(`当前状态「${item.status}」不允许标记为已拒绝`);
  }

  return db.inquiryItem.update({
    where: { id: scope.itemId },
    data: { status: ITEM_STATUS.DECLINED, declinedAt: new Date() },
    include: { supplier: true },
  });
}

// ── mark-no-response ──────────────────────────────────────────

export async function markItemNoResponse(scope: ItemScope) {
  const { item } = await resolveItem(scope);
  if (
    !canTransitionItem(item.status as ItemStatus, ITEM_STATUS.NO_RESPONSE)
  ) {
    throw new BusinessError(`当前状态「${item.status}」不允许标记为未响应`);
  }

  return db.inquiryItem.update({
    where: { id: scope.itemId },
    data: { status: ITEM_STATUS.NO_RESPONSE },
    include: { supplier: true },
  });
}

// ── select（事务保证同一 inquiry 下仅一个 isSelected） ─────────

export async function selectItem(scope: ItemScope) {
  const { item } = await resolveItem(scope);
  if (item.status !== ITEM_STATUS.QUOTED) {
    throw new BusinessError("只有已报价的供应商才能被选定");
  }

  return db.$transaction(async (tx) => {
    await tx.inquiryItem.updateMany({
      where: { inquiryId: item.inquiryId, isSelected: true },
      data: { isSelected: false },
    });

    return tx.inquiryItem.update({
      where: { id: scope.itemId },
      data: { isSelected: true },
      include: { supplier: true },
    });
  });
}

// ── deselect ──────────────────────────────────────────────────

export async function deselectItem(scope: ItemScope) {
  await resolveItem(scope);
  return db.inquiryItem.update({
    where: { id: scope.itemId },
    data: { isSelected: false },
    include: { supplier: true },
  });
}

// ── compare（报价对比） ───────────────────────────────────────

export async function compareQuotes(
  scope: InquiryScope
): Promise<QuoteCompareRow[]> {
  await resolveInquiry(scope);

  const items = await db.inquiryItem.findMany({
    where: { inquiryId: scope.inquiryId },
    include: { supplier: { select: { id: true, name: true } } },
    orderBy: { totalPrice: "asc" },
  });

  return items
    .filter((i) => i.status === ITEM_STATUS.QUOTED)
    .map((i) => ({
      itemId: i.id,
      supplierId: i.supplier.id,
      supplierName: i.supplier.name,
      status: i.status as ItemStatus,
      unitPrice: i.unitPrice,
      totalPrice: i.totalPrice,
      currency: i.currency,
      deliveryDays: i.deliveryDays,
      validUntil: i.validUntil,
      quoteNotes: i.quoteNotes,
      isSelected: i.isSelected,
    }));
}
