/**
 * 外贸入站消息 — 解析 orgId（禁止依赖 webhook body/query 中的 orgId，禁止落到 default）
 *
 * 当前 TradeChannel 无独立 providerAccountId 列，沿用各通道 config JSON：
 * - WhatsApp：`config.phoneNumberId` 须与 Meta webhook `metadata.phone_number_id` 一致
 * - 微信：`config.originalId`（或 `toUserName` / `ghId` / `wechatId`）须与入站 XML 的 ToUserName 一致
 *
 * 可选后续迁移（更小优先级）：在 TradeChannel 增加 `inboundKey String?` + `@@index([channel, inboundKey])`
 * 用于 O(1) 查询，避免扫 active 行；当前 MVP 安装规模下 `findMany + 内存比对` 可接受。
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/common/logger";

export type TradeInboundProvider = "whatsapp" | "wechat" | "email" | "website_form";

type ResolveOk = { ok: true; orgId: string; channelId: string };
type ResolveFail = { ok: false; reason: string };

/** 通过 WhatsApp Cloud API 的 phone_number_id 解析 org（config.phoneNumberId） */
export async function findTradeChannelOrgByWhatsAppPhoneNumberId(
  phoneNumberId: string,
): Promise<{ orgId: string; channelId: string } | null> {
  const pid = phoneNumberId.trim();
  if (!pid) return null;
  const rows = await db.tradeChannel.findMany({
    where: { channel: "whatsapp", status: "active" },
    select: { id: true, orgId: true, config: true },
  });
  for (const r of rows) {
    const c = r.config as Record<string, unknown>;
    if (String(c.phoneNumberId ?? "").trim() === pid) {
      return { orgId: r.orgId, channelId: r.id };
    }
  }
  logger.warn("trade.inbound.whatsapp_channel_not_found", { phoneNumberId: pid });
  return null;
}

/** 通过微信公众号接收 XML 的 ToUserName 解析 org（与 config 中 originalId/toUserName/ghId/wechatId 之一匹配） */
export async function findTradeChannelOrgByWechatToUserName(
  toUserName: string,
): Promise<{ orgId: string; channelId: string } | null> {
  const t = toUserName.trim();
  if (!t) return null;
  const rows = await db.tradeChannel.findMany({
    where: { channel: "wechat", status: "active" },
    select: { id: true, orgId: true, config: true },
  });
  for (const r of rows) {
    const c = r.config as Record<string, unknown>;
    const keys = ["originalId", "toUserName", "ghId", "wechatId"] as const;
    for (const k of keys) {
      if (String(c[k] ?? "").trim() === t) {
        return { orgId: r.orgId, channelId: r.id };
      }
    }
  }
  logger.warn("trade.inbound.wechat_channel_not_found", { toUserName: t });
  return null;
}

/**
 * 统一入口：根据 provider + 账号标识解析 org（禁止信任 payload 内自定义 orgId）
 */
export async function resolveInboundTradeOrgId(input: {
  provider: TradeInboundProvider;
  /** WhatsApp: phone_number_id；微信: ToUserName */
  providerAccountId?: string | null;
}): Promise<ResolveOk | ResolveFail> {
  if (input.provider === "email" || input.provider === "website_form") {
    return { ok: false, reason: "provider_not_implemented" };
  }
  const id = input.providerAccountId?.trim() ?? "";
  if (input.provider === "whatsapp") {
    if (!id) return { ok: false, reason: "missing_phone_number_id" };
    const row = await findTradeChannelOrgByWhatsAppPhoneNumberId(id);
    if (!row) return { ok: false, reason: "channel_not_found" };
    return { ok: true, orgId: row.orgId, channelId: row.channelId };
  }
  if (input.provider === "wechat") {
    if (!id) return { ok: false, reason: "missing_to_user_name" };
    const row = await findTradeChannelOrgByWechatToUserName(id);
    if (!row) return { ok: false, reason: "channel_not_found" };
    return { ok: true, orgId: row.orgId, channelId: row.channelId };
  }
  return { ok: false, reason: "unsupported_provider" };
}

export function logInboundOrgDenial(provider: TradeInboundProvider, reason: string, meta: Record<string, unknown>) {
  logger.warn("trade.inbound.org_denied", { provider, reason, ...meta });
}

/** Gmail / 企业邮入站：后续用 connected mailbox 或 channelId 映射 org（占位） */
export async function resolveInboundTradeOrgFromEmailStub(): Promise<ResolveFail> {
  return { ok: false, reason: "email_inbound_not_implemented" };
}

/** 官网表单：后续用 formId / channelId 映射 org（占位） */
export async function resolveInboundTradeOrgFromWebsiteFormStub(): Promise<ResolveFail> {
  return { ok: false, reason: "website_form_inbound_not_implemented" };
}
