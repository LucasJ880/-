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

import { db } from "@/lib/db";

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

export async function listChannels(orgId: string) {
  const channels = await db.tradeChannel.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
  });
  return channels.map((ch) => ({
    ...ch,
    config: maskConfig(ch.config as Record<string, string>),
  }));
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

function maskConfig(config: Record<string, string>): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const [key, val] of Object.entries(config)) {
    if (typeof val === "string" && val.length > 8) {
      masked[key] = val.slice(0, 4) + "****" + val.slice(-4);
    } else {
      masked[key] = "****";
    }
  }
  return masked;
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
