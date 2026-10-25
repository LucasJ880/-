/**
 * WhatsApp Cloud API 来信 → Revenue Spine（PRD F2.2–F2.4）
 *
 * 一条消息一条管线：收据（orgId, "whatsapp", wamid）→ Trade 线索 / 消息 → Revenue Spine intake
 * （客户按电话 E.164 去重 → 商机 → 互动 → FDE 行动）→ 响应之后 after() 执行 FDE（原子认领，与 cron / 重投互斥）。
 * 与网站询盘共用 ingestWebsiteInquiry（origin whatsapp、fdeMode deferred）：请求路径里没有 LLM，
 * 也不再另跑 TradeInquiryAnalysis。买家没有邮箱时 FDE 照常评分 / 抽取，但不建审批草稿（既有规则）。
 *
 * 批次处理规则：
 *   - 每条消息先认领收据：同一 wamid 再次投递 → 只补缺失步骤，不重复建任何对象（已全部完成 = 空操作）；
 *   - phone_number_id 缺失 / 不属于任何组织的条目只跳过该条目，不让整批 403；
 *   - 表情回应 / 贴纸 / 系统通知等不进询盘；图片 / 文件 / 视频 / 语音 / 按钮 / 列表选择等记「[类型标签] 说明文字」，
 *     标签用英文（[image] / [voice message] …）：它是买家消息正文的一部分，会参与语言识别与 RFQ 抽取，
 *     中文标签会把只发图片 / 语音的外国买家判成中文、FDE 草稿跟着用中文；
 *   - 不做内容去重：wamid 唯一，同一买家一天里两次「ok」、两条语音、两张不带说明的图各自是一条消息；
 *   - 同一发信人的消息按 (orgId, wa_id) 租约串行（买家一次发几张图会并发投递多个 webhook，
 *     不串行会各自建出新客户 / 新商机）。租约是收据表里的一行（WHATSAPP_SENDER_LEASE_SOURCE），
 *     等待时 sleep 轮询、不占 DB 连接；等不到（SENDER_LEASE_MAX_WAIT_MS）→ 记 busy；
 *   - 处理抛错、主干 intake 失败（SPINE_FAILED），或收据 / 发信人租约被另一个请求占着（busy）→ 路由返回 500
 *     让 Meta 重投整批；已处理的条目按收据幂等，重投只补缺失步骤。
 */

import { logger } from "@/lib/common/logger";
import { logInboundOrgDenial, resolveInboundTradeOrgId } from "./inbound-org";
import { blankInquiry, ingestWebsiteInquiry, type IngestResult, type NormalizedInquiry } from "./website-inquiry";
import { WHATSAPP_SENDER_LEASE_SOURCE, releaseEventLease, tryAcquireEventLease } from "./website-inquiry-receipts";

// 暂不读 timestamp：互动时间与 SLA 从处理时刻起算（Meta 重投可能晚几小时；按消息时间计需 ingest 增加只作用于互动的时间选项）
type WaMessage = {
  id?: string;
  from?: string;
  type?: string;
  text?: { body?: string };
  image?: { caption?: string };
  video?: { caption?: string };
  document?: { caption?: string; filename?: string };
  audio?: { voice?: boolean };
  location?: { name?: string; address?: string; latitude?: number; longitude?: number };
  contacts?: Array<{ name?: { formatted_name?: string }; phones?: Array<{ phone?: string }> }>;
  button?: { text?: string; payload?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
  };
  order?: { product_items?: Array<{ quantity?: number | string }> };
};

type WaContact = { profile?: { name?: string }; wa_id?: string };

type WaValue = {
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  contacts?: WaContact[];
  messages?: WaMessage[];
};

type WaWebhookBody = {
  object?: string;
  entry?: Array<{ id?: string; changes?: Array<{ field?: string; value?: WaValue }> }>;
};

const LIMITS = { name: 120, message: 4000, wamid: 256, label: 200 } as const;

/** 不进询盘：表情回应、贴纸、系统通知（换号等）、平台不支持的类型 */
const IGNORED_TYPES: ReadonlySet<string> = new Set(["reaction", "sticker", "system", "unsupported", "unknown", "ephemeral", "request_welcome"]);

function clean(v: unknown, max: number = LIMITS.message): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function labeled(label: string, body: string): string {
  return body ? `${label} ${body}` : label;
}

/**
 * 消息 → 询盘正文（纯函数）：文字原样；媒体与交互记「[type] 说明文字」（英文标签，见文件头）。不进询盘的类型返回 null。
 * 媒体本身不下载（Meta 媒体 id 需要通道 accessToken 换取，且 30 天后失效）：业务员按标签回 WhatsApp 查看。
 */
export function whatsAppMessageText(msg: WaMessage): string | null {
  switch (msg.type ?? "") {
    case "text":
      return clean(msg.text?.body) || null;
    case "image":
      return labeled("[image]", clean(msg.image?.caption));
    case "video":
      return labeled("[video]", clean(msg.video?.caption));
    case "document": {
      const name = clean(msg.document?.filename, LIMITS.label);
      return labeled(name ? `[document: ${name}]` : "[document]", clean(msg.document?.caption));
    }
    case "audio":
      return msg.audio?.voice ? "[voice message]" : "[audio]";
    case "location": {
      const l = msg.location ?? {};
      const coords = typeof l.latitude === "number" && typeof l.longitude === "number" ? `(${l.latitude}, ${l.longitude})` : "";
      return labeled("[location]", [clean(l.name, LIMITS.label), clean(l.address, LIMITS.label), coords].filter(Boolean).join(" "));
    }
    case "contacts": {
      const cards = (msg.contacts ?? [])
        .map((c) => [clean(c.name?.formatted_name, LIMITS.label), ...(c.phones ?? []).map((p) => clean(p.phone, 40))].filter(Boolean).join(" "))
        .filter(Boolean);
      return labeled("[contact]", cards.join("; "));
    }
    case "button":
      return labeled("[button]", clean(msg.button?.text, LIMITS.label) || clean(msg.button?.payload, LIMITS.label));
    case "interactive": {
      const reply = msg.interactive?.button_reply ?? msg.interactive?.list_reply;
      const desc = msg.interactive?.list_reply?.description;
      return labeled("[option]", [clean(reply?.title, LIMITS.label), clean(desc, LIMITS.label)].filter(Boolean).join(" — "));
    }
    case "order": {
      const items = msg.order?.product_items ?? [];
      return items.length ? `[order] ${items.length} item(s)` : "[order]";
    }
    default:
      return null;
  }
}

interface WhatsAppInboundItem {
  phoneNumberId: string;
  wamid: string;
  /** 发信人 WhatsApp 号码（国际格式数字，不含 +） */
  waId: string;
  profileName: string;
  type: string;
  text: string;
}

interface WhatsAppSkip {
  reason: "missing_phone_number_id" | "missing_id" | "missing_from" | "ignored_type" | "empty_content" | "unknown_channel";
  phoneNumberId?: string;
  wamid?: string;
  type?: string;
}

/** webhook 载荷 → 逐条消息（纯函数）；状态回执（statuses）等非来信变更直接忽略 */
export function extractWhatsAppInbound(body: unknown): { items: WhatsAppInboundItem[]; skipped: WhatsAppSkip[] } {
  const items: WhatsAppInboundItem[] = [];
  const skipped: WhatsAppSkip[] = [];
  const entries = (body as WaWebhookBody | null)?.entry;
  for (const entry of Array.isArray(entries) ? entries : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      if (change?.field !== "messages") continue;
      const value = change.value ?? {};
      const messages = Array.isArray(value.messages) ? value.messages : [];
      if (messages.length === 0) continue;
      const phoneNumberId = clean(value.metadata?.phone_number_id, 64);
      const contacts = Array.isArray(value.contacts) ? value.contacts : [];
      for (const raw of messages) {
        const msg: WaMessage = raw && typeof raw === "object" ? raw : {};
        const wamid = clean(msg.id, LIMITS.wamid);
        const type = clean(msg.type, 40);
        if (!phoneNumberId) {
          skipped.push({ reason: "missing_phone_number_id", wamid, type });
          continue;
        }
        if (!wamid) {
          skipped.push({ reason: "missing_id", phoneNumberId, type });
          continue;
        }
        const waId = (typeof msg.from === "string" ? msg.from : "").replace(/\D+/g, "").slice(0, 20);
        if (waId.length < 7) {
          skipped.push({ reason: "missing_from", phoneNumberId, wamid, type });
          continue;
        }
        if (IGNORED_TYPES.has(type)) {
          skipped.push({ reason: "ignored_type", phoneNumberId, wamid, type });
          continue;
        }
        const text = whatsAppMessageText(msg);
        if (!text) {
          skipped.push({ reason: "empty_content", phoneNumberId, wamid, type });
          continue;
        }
        const contact = contacts.find((c) => typeof c?.wa_id === "string" && c.wa_id.replace(/\D+/g, "") === waId) ?? (contacts.length === 1 ? contacts[0] : undefined);
        items.push({ phoneNumberId, wamid, waId, profileName: clean(contact?.profile?.name, LIMITS.name), type, text });
      }
    }
  }
  return { items, skipped };
}

/** 单条消息 → 询盘载荷（纯函数）：电话 "+<wa_id>"（E.164），姓名取 WhatsApp 资料名，eventId = wamid */
export function toWhatsAppInquiry(item: WhatsAppInboundItem): NormalizedInquiry {
  return { ...blankInquiry(item.wamid), name: item.profileName, phone: `+${item.waId}`, message: item.text.slice(0, LIMITS.message) };
}

type ResolveOrgResult = { ok: true; orgId: string } | { ok: false; reason: string };

type SenderLockResult<T> = { acquired: true; value: T } | { acquired: false };

export interface WhatsAppWebhookDeps {
  resolveOrg: (phoneNumberId: string) => Promise<ResolveOrgResult>;
  ingest: (orgId: string, inquiry: NormalizedInquiry) => Promise<IngestResult>;
  /** 同一发信人串行（测试可替换为直接执行）；等不到 → acquired=false（本条记 busy，让 Meta 重投） */
  withSenderLock: <T>(orgId: string, waId: string, fn: () => Promise<T>) => Promise<SenderLockResult<T>>;
}

interface WhatsAppWebhookOutcome {
  /** 进入处理的消息数（已扣除跳过的） */
  messages: number;
  /** 首次处理（新事件） */
  processed: number;
  /** 同一 wamid 再次投递：只补缺失步骤 */
  replays: number;
  /** 收据被另一个（多半已中断的）请求占着，或同一发信人的租约等不到：本次未处理，需重投 */
  busy: number;
  /** 抛错，或 Revenue Spine intake 失败（Trade 消息已落、主干未建：重投时按收据补齐） */
  failed: number;
  skipped: WhatsAppSkip[];
}

/** org 按 TradeChannel(whatsapp).config.phoneNumberId 解析；绝不信任载荷里的任何 org 标识 */
async function resolveOrgByPhoneNumberId(phoneNumberId: string): Promise<ResolveOrgResult> {
  const r = await resolveInboundTradeOrgId({ provider: "whatsapp", providerAccountId: phoneNumberId });
  if (!r.ok) logInboundOrgDenial("whatsapp", r.reason, { phoneNumberId });
  return r;
}

/**
 * 发信人租约：持有者中断后多久可被接管。一条消息在请求路径里只做收据 / Trade / Revenue Spine intake（几次 DB 往返，
 * 通常 1–3 秒，FDE 在响应之后另行认领），2 分钟足够宽；接管只意味着这条消息可能与仍在跑的旧请求并行。
 */
const SENDER_LEASE_STALE_MS = 2 * 60_000;
/** 等同一发信人前面的消息处理完最多等多久；之后本条记 busy → 500，Meta 稍后重投（收据幂等） */
const SENDER_LEASE_MAX_WAIT_MS = 10_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 同一 (orgId, wa_id) 串行：非阻塞租约 + sleep 轮询（收据表一行，见 tryAcquireEventLease）。
 * 不用 pg_advisory_xact_lock：那要一条事务连接从头开到尾，而 ingest 本身走其它连接——并发请求数一到
 * Prisma connection_limit，所有请求都会在 pool_timeout 后失败（不同发信人、毫无锁竞争时也一样）。
 */
async function withWhatsAppSenderLock<T>(orgId: string, waId: string, fn: () => Promise<T>): Promise<SenderLockResult<T>> {
  const deadline = Date.now() + SENDER_LEASE_MAX_WAIT_MS;
  let delay = 100;
  for (;;) {
    const token = await tryAcquireEventLease(orgId, WHATSAPP_SENDER_LEASE_SOURCE, waId, { staleMs: SENDER_LEASE_STALE_MS });
    if (token) {
      try {
        return { acquired: true, value: await fn() };
      } finally {
        await releaseEventLease(orgId, WHATSAPP_SENDER_LEASE_SOURCE, waId, token).catch((err) =>
          // 释放失败只会让后面的消息多等到租约过期，不影响本条结果
          logger.warn("trade.inbound.whatsapp_sender_lease_release_failed", { orgId, error: err instanceof Error ? err.message : String(err) }),
        );
      }
    }
    if (Date.now() + delay > deadline) return { acquired: false };
    await sleep(delay + Math.floor(Math.random() * 50));
    delay = Math.min(delay * 2, 1_000);
  }
}

const DEFAULT_DEPS: WhatsAppWebhookDeps = {
  resolveOrg: resolveOrgByPhoneNumberId,
  // deferred：请求只做到 Revenue Spine intake，FDE 交给 after()（cron 兜底接手丢失的回调）
  ingest: (orgId, inquiry) => ingestWebsiteInquiry(orgId, inquiry, { origin: { kind: "whatsapp" }, fdeMode: "deferred" }),
  withSenderLock: withWhatsAppSenderLock,
};

/** 处理一次 webhook 投递（签名已在路由校验）。逐条处理，一条失败不影响其它条目。 */
export async function processWhatsAppWebhook(body: unknown, deps: Partial<WhatsAppWebhookDeps> = {}): Promise<WhatsAppWebhookOutcome> {
  const d: WhatsAppWebhookDeps = { ...DEFAULT_DEPS, ...deps };
  const { items, skipped } = extractWhatsAppInbound(body);
  const outcome: WhatsAppWebhookOutcome = { messages: 0, processed: 0, replays: 0, busy: 0, failed: 0, skipped: [...skipped] };
  for (const s of skipped) {
    if (s.reason === "missing_phone_number_id") logInboundOrgDenial("whatsapp", s.reason, { wamid: s.wamid });
  }

  const orgs = new Map<string, ResolveOrgResult>();
  for (const item of items) {
    try {
      let org = orgs.get(item.phoneNumberId);
      if (!org) {
        org = await d.resolveOrg(item.phoneNumberId);
        orgs.set(item.phoneNumberId, org);
      }
      if (!org.ok) {
        outcome.skipped.push({ reason: "unknown_channel", phoneNumberId: item.phoneNumberId, wamid: item.wamid, type: item.type });
        continue;
      }
      const orgId = org.orgId;
      outcome.messages += 1;
      const locked = await d.withSenderLock(orgId, item.waId, () => d.ingest(orgId, toWhatsAppInquiry(item)));
      if (!locked.acquired) {
        // 同一买家前面的消息还在处理（或持有者刚中断、租约未过期）：本条不处理，让 Meta 重投
        outcome.busy += 1;
        logger.warn("trade.inbound.whatsapp_sender_busy", { orgId, wamid: item.wamid });
        continue;
      }
      const result = locked.value;
      if (result.busy) {
        outcome.busy += 1;
      } else if (!result.spine.ok && result.spine.code === "SPINE_FAILED") {
        // ingest 把 intake 异常收成 SPINE_FAILED 返回（网站由站点重发补齐）；这里要靠 Meta 重投
        outcome.failed += 1;
        logger.error("trade.inbound.whatsapp_spine_failed", { orgId, wamid: item.wamid, error: result.spine.error });
      } else if (result.replay) {
        outcome.replays += 1;
      } else {
        outcome.processed += 1;
      }
    } catch (err) {
      outcome.failed += 1;
      logger.error("trade.inbound.whatsapp_ingest_failed", {
        phoneNumberId: item.phoneNumberId,
        wamid: item.wamid,
        type: item.type,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return outcome;
}
