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
 * - 来源页 / UTM / referrer / 落地页不参与业务指纹：它们变化不算冲突，也不回写既有对象。
 * - 载荷里的 meta（接收元数据，如嵌入表单访客 IP 的 HMAC）同样不参与指纹，也不还原进业务事实。
 * - 站点未提供 eventId（旧接口）→ 服务端按业务指纹派生身份（eventIdProvided=false），
 *   并保留原有 24 小时正文去重窗口语义：窗口外的相同内容是新事件。
 * - 内容与既有事件相同但 eventId 不同 → 建立**独立收据**并指向原事件
 *   （duplicateOfReceiptId），不静默吞掉；业务对象复用原事件的。
 *   例外：平台消息 id 本身唯一的聊天通道（WhatsApp wamid）不做内容去重（contentDedupe=false）——
 *   同一买家一天里发两次「ok」、两条语音、两张不带说明的图都是不同的消息，各自建链。
 * - 保存期限：收据不自动清理（无 purge 路径）。只要站点仍可能重发，事件身份就必须在。
 *   若身份未知（收据被人为删除/超出保存期限）→ 先按内容尝试关联既有对象，关联不上
 *   才作为新事件建立，并在响应里标记 unknownEvent，不静默当成全新事件。
 */

import { createHash } from "node:crypto";
import type { Prisma, WebsiteInquiryReceipt } from "@prisma/client";
import { db } from "@/lib/db";
import type { NormalizedInquiry } from "./website-inquiry";

export const WEBSITE_INQUIRY_SOURCE = "website";
/** 展会速记卡（夜间批量录入）：与网站询盘同一条链路，事件身份空间独立 */
export const BOOTH_CARD_SOURCE = "trade_show";
/** 青砚托管的嵌入表单（浏览器带公开 key 直接提交）：事件 id = emb:<浏览器生成的 uuid>，事件身份空间独立 */
export const EMBED_INQUIRY_SOURCE = "embed";
/** 邮件转发询盘（Resend 入站，eventId = "email:<Message-ID>"）：同一条链路，事件身份空间独立 */
export const EMAIL_FORWARD_SOURCE = "email";
/** WhatsApp Cloud API 来信：eventId = wamid；与网站询盘同一条链路（收据 → Trade → Revenue Spine → 异步 FDE） */
export const WHATSAPP_INBOUND_SOURCE = "whatsapp";
/**
 * WhatsApp 发信人租约（不是事件）：eventId = wa_id，一行一个发信人，status=processing 表示有请求正在处理
 * 该发信人的消息（见 tryAcquireEventLease）。同一买家并发投递的几条消息据此串行，不各自建新客户。
 */
export const WHATSAPP_SENDER_LEASE_SOURCE = "whatsapp_sender";
/**
 * 微信公众号来信：eventId = MsgId（无 MsgId 时 FromUserName:CreateTime）。只走 Trade 通道
 * （openid 没有电话 / 邮箱，进不了 Revenue Spine 的客户去重），收据只做平台重试去重，见 claimChannelEventReceipt。
 */
export const WECHAT_INBOUND_SOURCE = "wechat";
/**
 * 微信收据的 processing 过期时长：微信 5 秒收不到回应就重发（约 5 s / 10 s 各一次）。Trade 通道处理只有几次 DB 写入，
 * 认领后超过 4 秒仍是 processing 基本可以认定那个请求已中断：重发据此再认领，不再把消息丢掉
 * （代价：那个请求若只是慢、最后也写完，会多一条重复消息——改动前每次重发都会重复写）。
 */
export const WECHAT_RECEIPT_STALE_MS = 4_000;

/** 单执行者控制：processing 超过此时长视为处理进程已中断，允许再次认领。
 *  网站 webhook（deferred）只在请求路径（收据 → Trade → Revenue Spine intake，数秒）持有收据，
 *  FDE 在响应之后另行认领（inbound-queue.ts 的 FDE_CLAIM_STALE_MS），不再占用收据；但展会速记卡录入等
 *  inline 调用仍在持有收据期间执行 FDE，所以此值仍必须大于这些路由的 maxDuration（300 s），
 *  否则会与仍在执行的请求并行。 */
export const RECEIPT_PROCESSING_STALE_MS = 6 * 60_000;

/** 派生身份（无 eventId 的旧接口）沿用的正文去重窗口 */
export const RECEIPT_DERIVED_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * quarantined（邮件转发：来源未验证 / 发件人不在白名单 / 无买家联系方式，未建任何业务对象）与
 * duplicate（邮件转发：同一询盘已由官网 webhook 入站，只记录、不建商机）是终态，不参与内容重复判定。
 */
export type ReceiptStatus = "received" | "processing" | "linked" | "complete" | "quarantined" | "duplicate";

/** 不建业务对象的终态收据：不能被当成「既有事件」去继承下游对象 */
export const RECEIPT_TERMINAL_NO_CHAIN_STATUSES = ["quarantined", "duplicate"] as const;

/** 业务指纹：联系人 + 公司 + 国家 + 正文 + 产品 + 买家网站。不含来源页 / referrer / 落地页 / UTM / eventId / meta。 */
export function computePayloadHash(v: NormalizedInquiry): string {
  const parts = [v.name, v.email, v.phone, v.company, v.country, v.product, v.website, v.message];
  return createHash("sha256").update(parts.map((x) => (x ?? "").trim()).join(" ")).digest("hex");
}

export function deriveEventId(hash: string, firstSeenAt: Date): string {
  return `sha256:${hash.slice(0, 32)}:${firstSeenAt.toISOString()}`;
}

/** 收据里持久化的原始载荷（NormalizedInquiry 去掉运行期标记）+ 可选的接收元数据 */
export type ReceiptPayload = Omit<NormalizedInquiry, "honeypotTripped"> & { meta?: Record<string, unknown> };

export function toReceiptPayload(v: NormalizedInquiry, meta?: Record<string, unknown>): ReceiptPayload {
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
    referrer: v.referrer,
    landing: v.landing,
    utm: v.utm,
    eventId: v.eventId,
    ...(meta && Object.keys(meta).length ? { meta: { ...meta } } : {}),
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
    referrer: p.referrer ?? "",
    landing: p.landing ?? "",
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

/** 同 org 内、窗口内、相同业务指纹的最新既有事件（派生身份 + 内容重复判定共用；隔离 / 重复收据不算） */
async function findByPayloadHash(orgId: string, source: string, payloadHash: string, now: Date, windowMs: number) {
  return db.websiteInquiryReceipt.findFirst({
    where: {
      orgId,
      source,
      payloadHash,
      firstSeenAt: { gte: new Date(now.getTime() - windowMs) },
      status: { notIn: [...RECEIPT_TERMINAL_NO_CHAIN_STATUSES] },
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
  source: string = WEBSITE_INQUIRY_SOURCE,
  /** 首次建收据时随载荷保存的来源元数据（payload.meta，不参与业务指纹）：嵌入表单写访客 IP HMAC（限流计数），邮件转发写发件人 / 主题 / 解析依据 */
  meta?: Record<string, unknown>,
  opts: {
    /** false = eventId 由平台保证唯一（WhatsApp wamid）：同内容不同 eventId 是另一条消息，不指向原事件、不继承其对象 */
    contentDedupe?: boolean;
  } = {},
): Promise<ReceiptClaim> {
  const hash = computePayloadHash(v);
  const payload = toReceiptPayload(v, meta) as unknown as Prisma.InputJsonValue;
  const provided = Boolean(v.eventId);

  if (provided) {
    const existing = await db.websiteInquiryReceipt.findUnique({
      where: { orgId_source_eventId: { orgId, source, eventId: v.eventId } },
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
    const sameContent = await findByPayloadHash(orgId, source, hash, now, RECEIPT_DERIVED_WINDOW_MS);
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
  const contentTwin = provided && opts.contentDedupe !== false ? await findByPayloadHash(orgId, source, hash, now, RECEIPT_DERIVED_WINDOW_MS) : null;
  const eventId = provided ? v.eventId : deriveEventId(hash, now);
  try {
    const receipt = await db.websiteInquiryReceipt.create({
      data: {
        orgId,
        source,
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
        where: { orgId_source_eventId: { orgId, source, eventId } },
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
export async function findReceiptByEventId(orgId: string, eventId: string, source: string = WEBSITE_INQUIRY_SOURCE) {
  return db.websiteInquiryReceipt.findUnique({
    where: { orgId_source_eventId: { orgId, source, eventId } },
  });
}

export type ChannelEventClaim =
  | { outcome: "claimed"; receiptId: string; /** 上次处理失败（received）或中断（processing 过期）后再次认领 */ retry: boolean }
  | { outcome: "duplicate" | "busy"; receiptId: string };

/**
 * Trade 通道来信（微信公众号）按平台消息 id 认领，在任何业务写入之前调用：
 *   - 首次出现 → claimed（收据建为 processing）；
 *   - 已处理完（linked / complete）→ duplicate：平台重试（微信 5 秒没收到回应会重发，共 3 次），不再处理；
 *   - 另一请求正在处理（processing 且未过期）→ busy：由那个请求处理完；
 *   - 上次处理抛错（调用方已释放为 received）或处理中断（processing 超过 opts.staleMs）→ 再次 claimed。
 * payload 只存定位信息（不存正文：正文在 TradeMessage 里），不参与冲突判定。
 * 与网站询盘的 claimInquiryReceipt 不同：不做内容去重、不按收据重放——这条通道没有可补齐的下游链路。
 */
export async function claimChannelEventReceipt(
  orgId: string,
  source: string,
  eventId: string,
  payload: Record<string, string>,
  opts: {
    now?: Date;
    /** processing 超过此时长视为处理中断、允许再次认领（默认 RECEIPT_PROCESSING_STALE_MS；微信用 WECHAT_RECEIPT_STALE_MS） */
    staleMs?: number;
  } = {},
): Promise<ChannelEventClaim> {
  const now = opts.now ?? new Date();
  const staleMs = opts.staleMs ?? RECEIPT_PROCESSING_STALE_MS;
  const payloadHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  try {
    const created = await db.websiteInquiryReceipt.create({
      data: {
        orgId,
        source,
        eventId,
        eventIdProvided: true,
        payload: payload as Prisma.InputJsonValue,
        payloadHash,
        status: "processing",
        processingSince: now,
        firstSeenAt: now,
      },
      select: { id: true },
    });
    return { outcome: "claimed", receiptId: created.id, retry: false };
  } catch (err) {
    if ((err as { code?: string })?.code !== "P2002") throw err;
  }
  const existing = await db.websiteInquiryReceipt.findUniqueOrThrow({
    where: { orgId_source_eventId: { orgId, source, eventId } },
    select: { id: true },
  });
  const reclaimed = await db.websiteInquiryReceipt.updateMany({
    where: {
      id: existing.id,
      status: { notIn: ["linked", "complete"] },
      OR: [
        { status: { not: "processing" } },
        { processingSince: null },
        { processingSince: { lt: new Date(now.getTime() - staleMs) } },
      ],
    },
    data: { status: "processing", processingSince: now, attempts: { increment: 1 } },
  });
  if (reclaimed.count === 1) return { outcome: "claimed", receiptId: existing.id, retry: true };
  const cur = await db.websiteInquiryReceipt.update({
    where: { id: existing.id },
    data: { attempts: { increment: 1 } },
    select: { status: true },
  });
  return { outcome: cur.status === "linked" || cur.status === "complete" ? "duplicate" : "busy", receiptId: existing.id };
}

/**
 * 非阻塞租约（同一 key 同一时刻只有一个持有者），存在收据表里（source 区分，eventId = key），不占用 DB 连接：
 * 认领只是一条条件 UPDATE / INSERT，等待在调用方用 sleep 轮询完成。与 pg_advisory_xact_lock 相比，
 * 持有期间不需要一条一直开着的事务连接，并发请求再多也不会把连接池占满。
 *   - 返回本次持有的令牌（processingSince）；已被别人持有且未过期 → null；
 *   - 持有者中断（processingSince 超过 staleMs）→ 可被接管。
 * 释放用 releaseEventLease（按令牌比对，过期后被接管的租约不会被旧持有者误释放）。
 */
export async function tryAcquireEventLease(
  orgId: string,
  source: string,
  key: string,
  opts: { staleMs: number; now?: Date },
): Promise<Date | null> {
  const now = opts.now ?? new Date();
  const taken = await db.websiteInquiryReceipt.updateMany({
    where: {
      orgId,
      source,
      eventId: key,
      OR: [
        { status: { not: "processing" } },
        { processingSince: null },
        { processingSince: { lt: new Date(now.getTime() - opts.staleMs) } },
      ],
    },
    data: { status: "processing", processingSince: now, attempts: { increment: 1 } },
  });
  if (taken.count === 1) return now;
  try {
    await db.websiteInquiryReceipt.create({
      data: {
        orgId,
        source,
        eventId: key,
        eventIdProvided: true,
        payload: { lease: key } as Prisma.InputJsonValue,
        payloadHash: createHash("sha256").update(`${source}:${key}`).digest("hex"),
        status: "processing",
        processingSince: now,
        firstSeenAt: now,
      },
      select: { id: true },
    });
    return now;
  } catch (err) {
    // 行已存在且被别人持有（或另一请求刚建出来）
    if ((err as { code?: string })?.code === "P2002") return null;
    throw err;
  }
}

/** 释放租约：只有令牌仍是自己的才释放（返回是否释放了） */
export async function releaseEventLease(orgId: string, source: string, key: string, token: Date): Promise<boolean> {
  const r = await db.websiteInquiryReceipt.updateMany({
    where: { orgId, source, eventId: key, status: "processing", processingSince: token },
    data: { status: "complete", processingSince: null },
  });
  return r.count === 1;
}
