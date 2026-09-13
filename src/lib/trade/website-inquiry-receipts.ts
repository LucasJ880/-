/**
 * 网站询盘事件身份 — 最早可靠接收边界的收据（WebsiteInquiryReceipt）
 *
 * 目的：站点重发时能定位**原始事件**并逐项补齐中断的下游步骤，而不依赖
 * “正文能在 24 小时内匹配上”。收据在任何业务对象之前写入，因此
 * “Trade 消息已存、Sales 互动未建” 这类中断也能被精确恢复。
 *
 * 冻结口径：
 * - 事件范围 = (orgId, source, eventId)。orgId 与 source 由服务端按通道判定，
 *   调用方（站点表单）不能指定，也不能跨组织。
 * - payload 是**首次**收到的业务事实。同 eventId 携带不同业务内容 → 只记冲突
 *   （conflictCount / lastConflictAt）并按原始事实继续恢复，绝不覆盖。
 * - 来源页 / UTM 不参与业务指纹：它们变化不算冲突，也不回写既有对象。
 * - 站点未提供 eventId（旧接口）→ 服务端按业务指纹派生身份（eventIdProvided=false），
 *   并保留原有 24 小时正文去重窗口语义：窗口外的相同内容是新事件。
 * - 内容与既有事件相同但 eventId 不同 → 建立**独立收据**并指向原事件
 *   （duplicateOfReceiptId），不静默吞掉；业务对象复用原事件的。
 * - 保存期限：收据不自动清理（无 purge 路径）。只要站点仍可能重发，事件身份就必须在。
 *   若身份未知（收据被人为删除/超出保存期限）→ 先按内容尝试关联既有对象，关联不上
 *   才作为新事件建立，并在响应里标记 unknownEvent，不静默当成全新事件。
 */

import { createHash } from "node:crypto";
import type { Prisma, WebsiteInquiryReceipt } from "@prisma/client";
import { db } from "@/lib/db";
import type { NormalizedInquiry } from "./website-inquiry";

export const WEBSITE_INQUIRY_SOURCE = "website";

/** 单执行者控制：processing 超过此时长视为处理进程已中断，允许再次认领。
 *  必须大于 webhook 路由 maxDuration（300 s），否则会与仍在执行的请求并行。 */
export const RECEIPT_PROCESSING_STALE_MS = 6 * 60_000;

/** 派生身份（无 eventId 的旧接口）沿用的正文去重窗口 */
export const RECEIPT_DERIVED_WINDOW_MS = 24 * 60 * 60 * 1000;

export type ReceiptStatus = "received" | "processing" | "linked" | "complete";

/** 业务指纹：联系人 + 公司 + 国家 + 正文 + 产品 + 买家网站。不含来源页 / UTM / eventId。 */
export function computePayloadHash(v: NormalizedInquiry): string {
  const parts = [v.name, v.email, v.phone, v.company, v.country, v.product, v.website, v.message];
  return createHash("sha256").update(parts.map((x) => (x ?? "").trim()).join(" ")).digest("hex");
}

export function deriveEventId(hash: string, firstSeenAt: Date): string {
  return `sha256:${hash.slice(0, 32)}:${firstSeenAt.toISOString()}`;
}

/** 收据里持久化的原始载荷（NormalizedInquiry 去掉运行期标记） */
export type ReceiptPayload = Omit<NormalizedInquiry, "honeypotTripped">;

export function toReceiptPayload(v: NormalizedInquiry): ReceiptPayload {
  return {
    name: v.name,
    email: v.email,
    phone: v.phone,
    company: v.company,
    country: v.country,
    message: v.message,
    product: v.product,
    website: v.website,
    page: v.page,
    utm: v.utm,
    eventId: v.eventId,
  };
}

/** 从收据还原首次收到的业务事实（恢复时一律用它，而不是本次请求的内容） */
export function fromReceiptPayload(payload: Prisma.JsonValue): NormalizedInquiry {
  const p = (payload ?? {}) as Partial<ReceiptPayload>;
  const utm = (p.utm ?? {}) as Partial<NormalizedInquiry["utm"]>;
  return {
    name: p.name ?? "",
    email: p.email ?? "",
    phone: p.phone ?? "",
    company: p.company ?? "",
    country: p.country ?? "",
    message: p.message ?? "",
    product: p.product ?? "",
    website: p.website ?? "",
    page: p.page ?? "",
    eventId: p.eventId ?? "",
    utm: {
      source: utm.source ?? "",
      medium: utm.medium ?? "",
      campaign: utm.campaign ?? "",
      content: utm.content ?? "",
      term: utm.term ?? "",
    },
    honeypotTripped: false,
  };
}

export interface ReceiptClaim {
  receipt: WebsiteInquiryReceipt;
  /** 本次是该事件的首次出现 */
  created: boolean;
  /** 同 eventId 但业务内容不同（原始事实已保留，未覆盖） */
  conflict: boolean;
  /** 另一执行者正在处理同一事件：本次不并行执行 */
  busy: boolean;
  /** 内容与既有事件相同（不同 eventId）→ 指向原事件收据 id */
  duplicateOfReceiptId: string | null;
}

/** 同 org 内、窗口内、相同业务指纹的最新既有事件（派生身份 + 内容重复判定共用） */
async function findByPayloadHash(orgId: string, payloadHash: string, now: Date, windowMs: number) {
  return db.websiteInquiryReceipt.findFirst({
    where: {
      orgId,
      source: WEBSITE_INQUIRY_SOURCE,
      payloadHash,
      firstSeenAt: { gte: new Date(now.getTime() - windowMs) },
    },
    orderBy: { firstSeenAt: "desc" },
  });
}

async function claimExisting(
  existing: WebsiteInquiryReceipt,
  hash: string,
  now: Date,
): Promise<{ receipt: WebsiteInquiryReceipt; busy: boolean; conflict: boolean }> {
  const conflict = existing.payloadHash !== hash;
  const claimed = await db.websiteInquiryReceipt.updateMany({
    where: {
      id: existing.id,
      OR: [
        { status: { not: "processing" } },
        { processingSince: null },
        { processingSince: { lt: new Date(now.getTime() - RECEIPT_PROCESSING_STALE_MS) } },
      ],
    },
    data: {
      status: "processing",
      processingSince: now,
      attempts: { increment: 1 },
      ...(conflict ? { conflictCount: { increment: 1 }, lastConflictAt: now } : {}),
    },
  });
  const receipt = await db.websiteInquiryReceipt.findUniqueOrThrow({ where: { id: existing.id } });
  return { receipt, busy: claimed.count === 0, conflict };
}

/**
 * 在任何业务写入之前认领事件身份。返回后：
 * - created=true → 首次事件，调用方走正常建链
 * - busy=true    → 同一事件正在被处理，调用方直接返回当前状态，不并行执行
 * - 其余         → 重发，调用方按收据逐项核对并补齐
 */
export async function claimInquiryReceipt(
  orgId: string,
  v: NormalizedInquiry,
  now: Date = new Date(),
): Promise<ReceiptClaim> {
  const hash = computePayloadHash(v);
  const payload = toReceiptPayload(v) as unknown as Prisma.InputJsonValue;
  const provided = Boolean(v.eventId);

  if (provided) {
    const existing = await db.websiteInquiryReceipt.findUnique({
      where: { orgId_source_eventId: { orgId, source: WEBSITE_INQUIRY_SOURCE, eventId: v.eventId } },
    });
    if (existing) {
      const c = await claimExisting(existing, hash, now);
      return {
        receipt: c.receipt,
        created: false,
        conflict: c.conflict,
        busy: c.busy,
        duplicateOfReceiptId: c.receipt.duplicateOfReceiptId,
      };
    }
  }

  // 派生身份（无 eventId）：窗口内相同内容视为同一事件，保持旧的正文去重语义
  if (!provided) {
    const sameContent = await findByPayloadHash(orgId, hash, now, RECEIPT_DERIVED_WINDOW_MS);
    if (sameContent) {
      const c = await claimExisting(sameContent, hash, now);
      return {
        receipt: c.receipt,
        created: false,
        conflict: false,
        busy: c.busy,
        duplicateOfReceiptId: c.receipt.duplicateOfReceiptId,
      };
    }
  }

  // 新事件：内容与既有事件相同（不同 eventId）→ 记录并指向原事件，不静默吞掉
  const contentTwin = provided ? await findByPayloadHash(orgId, hash, now, RECEIPT_DERIVED_WINDOW_MS) : null;
  const eventId = provided ? v.eventId : deriveEventId(hash, now);
  try {
    const receipt = await db.websiteInquiryReceipt.create({
      data: {
        orgId,
        source: WEBSITE_INQUIRY_SOURCE,
        eventId,
        eventIdProvided: provided,
        payload,
        payloadHash: hash,
        duplicateOfReceiptId: contentTwin?.id ?? null,
        status: "processing",
        processingSince: now,
        firstSeenAt: now,
        // 内容重复：直接继承原事件已建立的下游对象（业务对象不重复创建）
        prospectId: contentTwin?.prospectId ?? null,
        tradeMessageId: contentTwin?.tradeMessageId ?? null,
        customerId: contentTwin?.customerId ?? null,
        opportunityId: contentTwin?.opportunityId ?? null,
        interactionId: contentTwin?.interactionId ?? null,
        salesActionId: contentTwin?.salesActionId ?? null,
      },
    });
    return { receipt, created: !contentTwin, conflict: false, busy: false, duplicateOfReceiptId: contentTwin?.id ?? null };
  } catch (err) {
    // 并发首发：另一执行者刚建立了同一事件身份（唯一约束）→ 转为重发路径
    if ((err as { code?: string })?.code === "P2002") {
      const existing = await db.websiteInquiryReceipt.findUnique({
        where: { orgId_source_eventId: { orgId, source: WEBSITE_INQUIRY_SOURCE, eventId } },
      });
      if (existing) {
        const c = await claimExisting(existing, hash, now);
        return {
          receipt: c.receipt,
          created: false,
          conflict: c.conflict,
          busy: c.busy,
          duplicateOfReceiptId: c.receipt.duplicateOfReceiptId,
        };
      }
    }
    throw err;
  }
}

export interface ReceiptLinkPatch {
  prospectId?: string | null;
  tradeMessageId?: string | null;
  customerId?: string | null;
  opportunityId?: string | null;
  interactionId?: string | null;
  salesActionId?: string | null;
  agentRunId?: string | null;
  pendingActionId?: string | null;
}

/** 回填下游对象 id（每一步成功后立即写，中断时下一次重发从此处继续） */
export async function linkReceipt(receiptId: string, patch: ReceiptLinkPatch): Promise<void> {
  const data: Record<string, string> = {};
  for (const [k, val] of Object.entries(patch)) {
    if (typeof val === "string" && val) data[k] = val;
  }
  if (Object.keys(data).length === 0) return;
  await db.websiteInquiryReceipt.update({
    where: { id: receiptId },
    data: data as Prisma.WebsiteInquiryReceiptUncheckedUpdateInput,
  });
}

/** 结束本次处理：complete = 全链终态（含 FDE），linked = 业务对象已建但下游未完成 */
export async function releaseReceipt(
  receiptId: string,
  status: Exclude<ReceiptStatus, "processing">,
  now: Date = new Date(),
): Promise<void> {
  await db.websiteInquiryReceipt.update({
    where: { id: receiptId },
    data: { status, processingSince: null, ...(status === "complete" ? { completedAt: now } : {}) },
  });
}

/** 运维/排障：按事件 id 读取收据（只读） */
export async function findReceiptByEventId(orgId: string, eventId: string) {
  return db.websiteInquiryReceipt.findUnique({
    where: { orgId_source_eventId: { orgId, source: WEBSITE_INQUIRY_SOURCE, eventId } },
  });
}
