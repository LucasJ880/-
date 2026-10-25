/**
 * Trade 消息通道 — 统一服务层
 *
 * 支持通道: WhatsApp (Cloud API / Twilio), 微信公众号, 企业微信
 * 职责:
 * 1. 通道配置管理
 * 2. 统一发送接口
 * 3. Webhook 消息接收
 * 4. 消息记录
 */

import type { Prisma, TradeChannel } from "@prisma/client";
import { db } from "@/lib/db";
import {
  SECRET_ROTATION_GRACE_MS,
  ensureWebsiteCredentialConfig,
  maskChannelConfig,
  maskCredential,
  readWebsiteCredentials,
  rotatePublicKeyConfig,
  rotateSecretConfig,
} from "./website-channel-credentials";

// ── Channel Config ──────────────────────────────────────────

export interface ChannelConfig {
  orgId: string;
  channel: "whatsapp" | "wechat" | "wechat_work" | "website";
  name: string;
  config: Record<string, string>;
}

export async function upsertChannel(input: ChannelConfig) {
  return db.tradeChannel.upsert({
    where: { orgId_channel: { orgId: input.orgId, channel: input.channel } },
    create: {
      orgId: input.orgId,
      channel: input.channel,
      name: input.name,
      config: input.config,
    },
    update: {
      name: input.name,
      config: input.config,
      status: "active",
    },
  });
}

/**
 * 网站询盘通道：凭证（服务端密钥、嵌入表单公开 key、IP 盐）全部由服务端生成；
 * 重复保存沿用已有凭证与来源白名单，避免已部署的代码失效。外贸渠道页与平台入驻向导共用这一条创建路径。
 * 调用方提交的 config 不写入（website 通道没有可由调用方填写的字段，凭证更不能由调用方指定）。
 */
export async function upsertWebsiteChannel(input: {
  orgId: string;
  name: string;
  config?: Record<string, unknown>;
}) {
  const existing = await getChannel(input.orgId, "website");
  const config = ensureWebsiteCredentialConfig(existing?.config) as Prisma.InputJsonValue;
  return db.tradeChannel.upsert({
    where: { orgId_channel: { orgId: input.orgId, channel: "website" } },
    create: { orgId: input.orgId, channel: "website", name: input.name, config },
    update: { name: input.name, config, status: "active" },
  });
}

/** 通道对外视图：凭证只显示末 4 位（所有通道），服务端专用字段不出现 */
export function toChannelView(ch: TradeChannel) {
  return {
    id: ch.id,
    orgId: ch.orgId,
    channel: ch.channel,
    name: ch.name,
    status: ch.status,
    config: maskChannelConfig(ch.config),
    webhookSecret: ch.webhookSecret ? maskCredential(ch.webhookSecret) : null,
    lastSyncAt: ch.lastSyncAt,
    createdAt: ch.createdAt,
    updatedAt: ch.updatedAt,
  };
}

/**
 * website 通道的完整凭证视图——只给能管理通道的角色（见 channel-access.ts）。
 * 旧密钥本身不返回，只返回宽限期到期时间（仍有效时）。
 */
export function websiteCredentialView(config: unknown, now: Date = new Date()) {
  const c = readWebsiteCredentials(config);
  const prevExp = c.secretPrev && c.secretPrevExpiresAt ? Date.parse(c.secretPrevExpiresAt) : NaN;
  return {
    secret: c.secret,
    secretPrevExpiresAt: Number.isFinite(prevExp) && prevExp > now.getTime() ? c.secretPrevExpiresAt : null,
    publicKey: c.publicKey,
    allowedOrigins: c.allowedOrigins,
    embedReady: !!c.publicKey && c.allowedOrigins.length > 0,
  };
}

export async function listChannels(orgId: string) {
  const channels = await db.tradeChannel.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
  });
  return channels.map(toChannelView);
}

/** 单个通道：所有角色拿到掩码视图；website 通道且 canManage 时附带完整凭证 */
export async function getChannelView(orgId: string, channel: string, opts: { canManage: boolean; now?: Date }) {
  const ch = await getChannel(orgId, channel);
  if (!ch) return null;
  return {
    ...toChannelView(ch),
    canManage: opts.canManage,
    ...(ch.channel === "website" && opts.canManage ? { website: websiteCredentialView(ch.config, opts.now) } : {}),
  };
}

export class WebsiteChannelError extends Error {
  constructor(
    public code: "NOT_FOUND" | "CONCURRENT_UPDATE",
    message: string,
  ) {
    super(message);
  }
}

/**
 * 改 website 通道 config（读 → 变换 → 按 updatedAt 比较并交换，冲突重读重试）。
 * 两个管理员同时轮换 / 改白名单时不会互相覆盖。
 */
async function mutateWebsiteChannelConfig(
  orgId: string,
  mutate: (config: unknown) => Record<string, unknown>,
): Promise<TradeChannel> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const ch = await getChannel(orgId, "website");
    if (!ch) throw new WebsiteChannelError("NOT_FOUND", "网站询盘通道不存在，请先添加");
    const next = mutate(ch.config) as Prisma.InputJsonValue;
    const res = await db.tradeChannel.updateMany({
      where: { id: ch.id, orgId, updatedAt: ch.updatedAt },
      data: { config: next },
    });
    if (res.count === 1) return db.tradeChannel.findUniqueOrThrow({ where: { id: ch.id } });
  }
  throw new WebsiteChannelError("CONCURRENT_UPDATE", "通道配置正被同时修改，请刷新后重试");
}

/** 轮换服务端密钥：新密钥立即生效；旧密钥在宽限期（默认 72 小时）内仍被 webhook / 状态接口接受 */
export function rotateWebsiteChannelSecret(orgId: string, now: Date = new Date(), graceMs: number = SECRET_ROTATION_GRACE_MS) {
  return mutateWebsiteChannelConfig(orgId, (c) => rotateSecretConfig(c, now, graceMs));
}

/** 启用嵌入表单：补齐公开 key（已有则不变） */
export function enableWebsiteChannelEmbed(orgId: string) {
  return mutateWebsiteChannelConfig(orgId, (c) => ensureWebsiteCredentialConfig(c));
}

/** 轮换嵌入表单公开 key：立即生效 */
export function rotateWebsiteChannelPublicKey(orgId: string, now: Date = new Date()) {
  return mutateWebsiteChannelConfig(orgId, (c) => rotatePublicKeyConfig(c, now));
}

/** 设置嵌入表单来源白名单（调用方已规范化：精确 scheme + host[:port]） */
export function setWebsiteChannelAllowedOrigins(orgId: string, origins: string[]) {
  return mutateWebsiteChannelConfig(orgId, (c) => ({ ...ensureWebsiteCredentialConfig(c), allowedOrigins: [...origins] }));
}

export async function getChannel(orgId: string, channel: string) {
  return db.tradeChannel.findUnique({
    where: { orgId_channel: { orgId, channel } },
  });
}

export async function deleteChannel(orgId: string, channel: string) {
  return db.tradeChannel.delete({
    where: { orgId_channel: { orgId, channel } },
  });
}

// ── Unified Send ────────────────────────────────────────────

export interface SendMessageInput {
  orgId: string;
  prospectId: string;
  channel: "whatsapp" | "wechat" | "wechat_work";
  to: string;
  content: string;
}

export async function sendChannelMessage(input: SendMessageInput) {
  const channelConfig = await db.tradeChannel.findUnique({
    where: { orgId_channel: { orgId: input.orgId, channel: input.channel } },
  });

  if (!channelConfig || channelConfig.status !== "active") {
    throw new Error(`通道 ${input.channel} 未配置或未激活`);
  }

  const config = channelConfig.config as Record<string, string>;
  let externalId: string | undefined;

  switch (input.channel) {
    case "whatsapp":
      externalId = await sendWhatsApp(config, input.to, input.content);
      break;
    case "wechat":
      externalId = await sendWechat(config, input.to, input.content);
      break;
    case "wechat_work":
      externalId = await sendWechatWork(config, input.to, input.content);
      break;
  }

  const message = await db.tradeMessage.create({
    data: {
      prospectId: input.prospectId,
      direction: "outbound",
      channel: input.channel,
      content: input.content,
    },
  });

  await db.tradeProspect.update({
    where: { id: input.prospectId },
    data: { lastContactAt: new Date() },
  });

  return { message, externalId };
}

// ── WhatsApp Cloud API ──────────────────────────────────────

async function sendWhatsApp(
  config: Record<string, string>,
  to: string,
  content: string,
): Promise<string | undefined> {
  const { accessToken, phoneNumberId } = config;
  if (!accessToken || !phoneNumberId) {
    throw new Error("WhatsApp 配置缺少 accessToken 或 phoneNumberId");
  }

  const res = await fetch(
    `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: to.replace(/[^0-9]/g, ""),
        type: "text",
        text: { body: content },
      }),
    },
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`WhatsApp 发送失败: ${err}`);
  }

  const data = await res.json();
  return data.messages?.[0]?.id;
}

// ── WeChat Official Account ─────────────────────────────────

async function sendWechat(
  config: Record<string, string>,
  to: string,
  content: string,
): Promise<string | undefined> {
  const { appId, appSecret } = config;
  if (!appId || !appSecret) {
    throw new Error("微信配置缺少 appId 或 appSecret");
  }

  const tokenRes = await fetch(
    `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`,
  );
  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;
  if (!accessToken) throw new Error("获取微信 access_token 失败");

  const res = await fetch(
    `https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${accessToken}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        touser: to,
        msgtype: "text",
        text: { content },
      }),
    },
  );

  const data = await res.json();
  if (data.errcode && data.errcode !== 0) {
    throw new Error(`微信发送失败: ${data.errmsg}`);
  }
  return data.msgid?.toString();
}

// ── WeCom (企业微信) ────────────────────────────────────────

async function sendWechatWork(
  config: Record<string, string>,
  to: string,
  content: string,
): Promise<string | undefined> {
  const { corpId, corpSecret, agentId } = config;
  if (!corpId || !corpSecret) {
    throw new Error("企业微信配置缺少 corpId 或 corpSecret");
  }

  const tokenRes = await fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corpId}&corpsecret=${corpSecret}`,
  );
  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;
  if (!accessToken) throw new Error("获取企业微信 access_token 失败");

  const res = await fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${accessToken}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        touser: to,
        msgtype: "text",
        agentid: Number(agentId ?? 0),
        text: { content },
      }),
    },
  );

  const data = await res.json();
  if (data.errcode && data.errcode !== 0) {
    throw new Error(`企业微信发送失败: ${data.errmsg}`);
  }
  return data.msgid?.toString();
}

// ── Webhook: Process Inbound ────────────────────────────────

export interface InboundMessage {
  channel: "whatsapp" | "wechat" | "wechat_work" | "website";
  from: string;
  content: string;
  externalId?: string;
  timestamp?: Date;
}

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  wechat: "微信",
  wechat_work: "企业微信",
  website: "官网",
};

/** 陌生来信建线索时的占位公司名——同一发信人再次来信可据此匹配回同一线索 */
export function inboundPlaceholderCompanyName(channel: string, from: string): string {
  return `${CHANNEL_LABEL[channel] ?? channel} ${from}`.trim();
}

export async function processInboundMessage(orgId: string, msg: InboundMessage) {
  const placeholder = inboundPlaceholderCompanyName(msg.channel, msg.from);
  let prospect = await db.tradeProspect.findFirst({
    where: {
      orgId,
      OR: [{ contactEmail: msg.from }, { companyName: placeholder }],
    },
    select: { id: true, companyName: true, stage: true },
  });

  // 陌生发信人：不再丢弃，建成新询盘（归集到「渠道询盘」活动）并通知销售
  let created = false;
  if (!prospect) {
    const { ensureInquiryCampaign } = await import("@/lib/trade/website-inquiry");
    const campaignId = await ensureInquiryCampaign(orgId, "渠道询盘");
    const row = await db.tradeProspect.create({
      data: {
        campaignId,
        orgId,
        companyName: placeholder,
        contactEmail: msg.from.includes("@") ? msg.from : undefined,
        contactName: msg.from.includes("@") ? undefined : msg.from,
        source: msg.channel,
        stage: "new",
      },
      select: { id: true, companyName: true, stage: true },
    });
    await db.tradeCampaign.update({
      where: { id: campaignId },
      data: { totalProspects: { increment: 1 } },
    });
    prospect = row;
    created = true;
  }

  const message = await db.tradeMessage.create({
    data: {
      prospectId: prospect.id,
      direction: "inbound",
      channel: msg.channel,
      content: msg.content,
    },
  });

  const now = new Date();
  await db.tradeProspect.update({
    where: { id: prospect.id },
    data: {
      lastContactAt: now,
      // 买家主动来信 → 进当日待回复队列
      nextFollowUpAt: now,
      ...(["new", "discovered", "researched", "qualified", "contacted", "outreach_sent", "follow_up", "no_response"].includes(prospect.stage)
        ? { stage: "replied" }
        : {}),
    },
  });

  try {
    const { scheduleInquiryAnalysis } = await import("@/lib/trade/inquiry-analysis");
    await scheduleInquiryAnalysis({
      orgId,
      prospectId: prospect.id,
      messageId: message.id,
      content: msg.content,
      channel: msg.channel,
      meta: {
        email: msg.from.includes("@") ? msg.from : null,
        companyName: prospect.companyName,
        phone: msg.from.includes("@") ? null : msg.from,
      },
    });
  } catch (err) {
    console.warn("[channel-service] analysis schedule failed:", err);
  }

  try {
    const { notifyInquiryMembers } = await import("@/lib/trade/website-inquiry");
    await notifyInquiryMembers(orgId, {
      title: `${CHANNEL_LABEL[msg.channel] ?? msg.channel}来信：${prospect.companyName}`,
      summary: msg.content.replace(/\s+/g, " ").slice(0, 140),
      prospectId: prospect.id,
      source: msg.channel,
      sourceKey: `channel-inbound:${message.id}`,
    });
  } catch (err) {
    console.warn("[channel-service] notify failed:", err);
  }

  return { matched: !created, created, prospectId: prospect.id, messageId: message.id };
}
