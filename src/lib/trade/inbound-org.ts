/**
 * 外贸入站消息 — 解析 orgId（禁止依赖 webhook body/query 中的 orgId，禁止落到 default）
 *
 * 当前 TradeChannel 无独立 providerAccountId 列，沿用各通道 config JSON：
 * - WhatsApp：`config.phoneNumberId` 须与 Meta webhook `metadata.phone_number_id` 一致
 * - 微信：`config.originalId`（或 `toUserName` / `ghId` / `wechatId`）须与入站 XML 的 ToUserName 一致
 * - 邮件转发：`config.inboundAlias` 须与收件地址 inq-xxxxxxxxxx@<INBOUND_EMAIL_DOMAIN> 的本地部分一致
 *
 * 可选后续迁移（更小优先级）：在 TradeChannel 增加 `inboundKey String?` + `@@index([channel, inboundKey])`
 * 用于 O(1) 查询，避免扫 active 行；当前 MVP 安装规模下 `findMany + 内存比对` 可接受。
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/common/logger";
import { INBOUND_ALIAS_RE, readForwarderAllowlist } from "./email-inbound-rules";

export type TradeInboundProvider = "whatsapp" | "wechat" | "email" | "website_form";

/**
 * 入站按 config 里这些字段解析组织（WhatsApp：phone_number_id；微信：ToUserName 可与任一字段相同）。
 * 保存通道（channel-service.upsertChannel）与上线前检查脚本（scripts/check-duplicate-channel-ids.ts）用同一份。
 */
export const INBOUND_ID_KEYS = {
  whatsapp: ["phoneNumberId"],
  wechat: ["originalId", "toUserName", "ghId", "wechatId"],
} as const satisfies Record<"whatsapp" | "wechat", readonly string[]>;

export type InboundIdChannel = keyof typeof INBOUND_ID_KEYS;

export function isInboundIdChannel(channel: string): channel is InboundIdChannel {
  return Object.prototype.hasOwnProperty.call(INBOUND_ID_KEYS, channel);
}

/** 通道 config 里参与入站解析的标识（去首尾空白、去空、去重），与下面解析时的比较口径一致 */
export function inboundIdsOf(channel: InboundIdChannel, config: unknown): Array<{ key: string; value: string }> {
  if (!config || typeof config !== "object" || Array.isArray(config)) return [];
  const c = config as Record<string, unknown>;
  const out: Array<{ key: string; value: string }> = [];
  for (const key of INBOUND_ID_KEYS[channel]) {
    const value = String(c[key] ?? "").trim();
    if (value && !out.some((x) => x.value === value)) out.push({ key, value });
  }
  return out;
}

export interface InboundIdDuplicate {
  channel: InboundIdChannel;
  /** 撞上的 config 字段名（不含取值） */
  keys: string[];
  channels: Array<{ orgId: string; channelId: string }>;
}

/**
 * 纯函数：同一入站标识出现在两个及以上组织的通道上（调用方只传 active 行）。按「通道类型 + 涉及的通道集合」合并，
 * 只返回字段名与组织 / 通道 id，不返回标识值或任何 config 内容。
 */
export function crossOrgInboundIdDuplicates(rows: ReadonlyArray<{ id: string; orgId: string; channel: string; config: unknown }>): InboundIdDuplicate[] {
  const groups = new Map<string, InboundIdDuplicate>();
  for (const channel of Object.keys(INBOUND_ID_KEYS) as InboundIdChannel[]) {
    const byValue = new Map<string, { keys: Set<string>; orgOf: Map<string, string> }>();
    for (const r of rows) {
      if (r.channel !== channel) continue;
      for (const { key, value } of inboundIdsOf(channel, r.config)) {
        const g = byValue.get(value) ?? { keys: new Set<string>(), orgOf: new Map<string, string>() };
        g.keys.add(key);
        g.orgOf.set(r.id, r.orgId);
        byValue.set(value, g);
      }
    }
    for (const g of byValue.values()) {
      if (new Set(g.orgOf.values()).size < 2) continue;
      const channels = [...g.orgOf].map(([channelId, orgId]) => ({ orgId, channelId })).sort((a, b) => a.orgId.localeCompare(b.orgId) || a.channelId.localeCompare(b.channelId));
      const sig = `${channel}|${channels.map((c) => c.channelId).join(",")}`;
      const prev = groups.get(sig);
      const keys = [...new Set([...(prev?.keys ?? []), ...g.keys])].sort();
      groups.set(sig, { channel, keys, channels });
    }
  }
  return [...groups.values()];
}

/** 上线前检查（只读，scripts/check-duplicate-channel-ids.ts）：启用的 WhatsApp / 微信通道里跨组织重复的入站标识 */
export async function listCrossOrgInboundIdDuplicates(): Promise<InboundIdDuplicate[]> {
  const rows = await db.tradeChannel.findMany({
    where: { channel: { in: Object.keys(INBOUND_ID_KEYS) }, status: "active" },
    select: { id: true, orgId: true, channel: true, config: true },
  });
  return crossOrgInboundIdDuplicates(rows);
}

type ResolveOk = { ok: true; orgId: string; channelId: string };
type ResolveFail = { ok: false; reason: string };
type ChannelOrg = { orgId: string; channelId: string };

/**
 * active 通道里 config 命中 matches 的那一条。同一标识配在多个组织的通道上（每个组织每种通道只有一条）一律拒绝、
 * 记 <channel>_channel_ambiguous，绝不按行序猜归属（两条 webhook 都只用一个全局密钥验签，分不出是哪个组织）。
 * 保存通道时已拒绝跨组织重复（channel-service.upsertChannel）；这里仍失败即关闭，兜住存量数据与绕过接口的写入。
 */
async function findUniqueChannelOrg(
  channel: "whatsapp" | "wechat",
  matches: (config: Record<string, unknown>) => boolean,
  logMeta: Record<string, string>,
): Promise<ChannelOrg | null> {
  const rows = await db.tradeChannel.findMany({ where: { channel, status: "active" }, select: { id: true, orgId: true, config: true } });
  const hits = rows.filter((r) => matches(r.config as Record<string, unknown>));
  if (hits.length !== 1) {
    if (hits.length) logger.warn(`trade.inbound.${channel}_channel_ambiguous`, { ...logMeta, count: hits.length });
    else logger.warn(`trade.inbound.${channel}_channel_not_found`, logMeta);
    return null;
  }
  return { orgId: hits[0].orgId, channelId: hits[0].id };
}

/** 通过 WhatsApp Cloud API 的 phone_number_id 解析 org（config.phoneNumberId） */
export async function findTradeChannelOrgByWhatsAppPhoneNumberId(phoneNumberId: string): Promise<ChannelOrg | null> {
  const pid = phoneNumberId.trim();
  if (!pid) return null;
  return findUniqueChannelOrg("whatsapp", (c) => String(c.phoneNumberId ?? "").trim() === pid, { phoneNumberId: pid });
}

/** 通过微信公众号接收 XML 的 ToUserName 解析 org（与 config 中 originalId/toUserName/ghId/wechatId 之一匹配） */
export async function findTradeChannelOrgByWechatToUserName(toUserName: string): Promise<ChannelOrg | null> {
  const t = toUserName.trim();
  if (!t) return null;
  return findUniqueChannelOrg("wechat", (c) => INBOUND_ID_KEYS.wechat.some((k) => String(c[k] ?? "").trim() === t), { toUserName: t });
}

/**
 * 邮件转发询盘：按收件别名（config.inboundAlias，形如 inq-xxxxxxxxxx）解析 org。
 * 只认 active 的 email 通道；同一别名出现在多条通道上（不应发生）一律拒绝，绝不猜测归属。
 */
export async function findTradeChannelOrgByInboundAlias(alias: string): Promise<(ChannelOrg & { allowlist: string[] }) | null> {
  const a = alias.trim().toLowerCase();
  if (!INBOUND_ALIAS_RE.test(a)) return null;
  const rows = await db.tradeChannel.findMany({
    where: { channel: "email", status: "active", config: { path: ["inboundAlias"], equals: a } },
    select: { id: true, orgId: true, config: true },
    take: 2,
  });
  if (rows.length !== 1) {
    if (rows.length > 1) logger.warn("trade.inbound.email_alias_ambiguous", { alias: a, count: rows.length });
    return null;
  }
  return { orgId: rows[0].orgId, channelId: rows[0].id, allowlist: readForwarderAllowlist(rows[0].config) };
}

/** provider → [按账号标识找通道, 标识缺失时的原因]；website_form 尚未实现 */
const FINDERS = new Map<TradeInboundProvider, [(id: string) => Promise<ChannelOrg | null>, string]>([
  ["email", [findTradeChannelOrgByInboundAlias, "missing_inbound_alias"]],
  ["whatsapp", [findTradeChannelOrgByWhatsAppPhoneNumberId, "missing_phone_number_id"]],
  ["wechat", [findTradeChannelOrgByWechatToUserName, "missing_to_user_name"]],
]);

/**
 * 统一入口：根据 provider + 账号标识解析 org（禁止信任 payload 内自定义 orgId）
 */
export async function resolveInboundTradeOrgId(input: {
  provider: TradeInboundProvider;
  /** WhatsApp: phone_number_id；微信: ToUserName；邮件：收件别名（inq-xxxxxxxxxx） */
  providerAccountId?: string | null;
}): Promise<ResolveOk | ResolveFail> {
  if (input.provider === "website_form") return { ok: false, reason: "provider_not_implemented" };
  const finder = FINDERS.get(input.provider);
  if (!finder) return { ok: false, reason: "unsupported_provider" };
  const id = input.providerAccountId?.trim() ?? "";
  if (!id) return { ok: false, reason: finder[1] };
  const row = await finder[0](id);
  return row ? { ok: true, orgId: row.orgId, channelId: row.channelId } : { ok: false, reason: "channel_not_found" };
}

export function logInboundOrgDenial(provider: TradeInboundProvider, reason: string, meta: Record<string, unknown>) {
  logger.warn("trade.inbound.org_denied", { provider, reason, ...meta });
}
