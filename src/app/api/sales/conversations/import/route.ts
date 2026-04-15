/**
 * 销售对话导入 API
 *
 * POST /api/sales/conversations/import
 *
 * 支持两种导入模式：
 * 1. rawText + channel → 自动解析对话格式
 * 2. messages (预结构化) → 直接导入
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import {
  parseWechatConversation,
  parseGenericConversation,
  parseEmailThread,
  detectLanguage,
  extractTopicTags,
  type Channel,
  type RawMessage,
} from "@/lib/ai/sales-conversation";

interface ImportBody {
  customerId: string;
  opportunityId?: string;
  channel: Channel;
  rawText?: string;
  messages?: RawMessage[];
  summary?: string;
  staffNames?: string[];
  outcome?: string;
}

const VALID_CHANNELS = new Set([
  "wechat",
  "xiaohongshu",
  "facebook",
  "email",
  "phone",
  "in_person",
  "other",
]);

export const POST = withAuth(async (request, _ctx, user) => {
  const body: ImportBody = await request.json();

  if (!body.customerId) {
    return NextResponse.json({ error: "缺少 customerId" }, { status: 400 });
  }
  if (!body.channel || !VALID_CHANNELS.has(body.channel)) {
    return NextResponse.json(
      { error: `无效渠道，可选: ${[...VALID_CHANNELS].join(", ")}` },
      { status: 400 }
    );
  }
  if (!body.rawText && !body.messages) {
    return NextResponse.json(
      { error: "需提供 rawText 或 messages" },
      { status: 400 }
    );
  }

  const customer = await db.salesCustomer.findUnique({
    where: { id: body.customerId },
    select: { id: true, createdById: true },
  });
  if (!customer) {
    return NextResponse.json({ error: "客户不存在" }, { status: 404 });
  }

  let messages: RawMessage[];
  let language: string;
  let topicTags: string[];

  if (body.rawText) {
    const parsed = parseByChannel(
      body.rawText,
      body.channel,
      body.staffNames
    );
    messages = parsed.messages;
    language = parsed.language;
    topicTags = parsed.topicTags;
  } else {
    messages = body.messages!;
    const allText = messages.map((m) => m.content).join(" ");
    language = detectLanguage(allText);
    topicTags = extractTopicTags(allText);
  }

  if (messages.length === 0) {
    return NextResponse.json(
      { error: "未能解析出任何消息，请检查格式" },
      { status: 400 }
    );
  }

  const summary =
    body.summary ||
    generateAutoSummary(messages, body.channel, language);

  const typeMap: Record<string, string> = {
    wechat: "wechat",
    xiaohongshu: "note",
    facebook: "note",
    email: "email",
    phone: "phone_call",
    in_person: "in_person",
    other: "note",
  };

  const interaction = await db.customerInteraction.create({
    data: {
      customerId: body.customerId,
      opportunityId: body.opportunityId || null,
      type: typeMap[body.channel] || "note",
      direction: "inbound",
      summary,
      content: messages.map((m) => `[${m.role}] ${m.content}`).join("\n"),
      channel: body.channel,
      language,
      rawMessages: JSON.stringify(messages),
      topicTags: topicTags.join(","),
      outcome: body.outcome || null,
      createdById: user.id,
    },
  });

  return NextResponse.json(
    {
      id: interaction.id,
      messageCount: messages.length,
      language,
      topicTags,
      summary,
    },
    { status: 201 }
  );
});

function parseByChannel(
  rawText: string,
  channel: Channel,
  staffNames?: string[]
) {
  switch (channel) {
    case "wechat":
      return parseWechatConversation(rawText, staffNames);
    case "email":
      return parseEmailThread(rawText);
    case "xiaohongshu":
    case "facebook":
    default:
      return parseGenericConversation(rawText, channel);
  }
}

function generateAutoSummary(
  messages: RawMessage[],
  channel: string,
  language: string
): string {
  const customerMsgs = messages.filter((m) => m.role === "customer");
  const staffMsgs = messages.filter((m) => m.role === "staff");

  const channelLabel: Record<string, string> = {
    wechat: "微信",
    xiaohongshu: "小红书",
    facebook: "Facebook",
    email: "邮件",
    phone: "电话",
    in_person: "到店",
  };

  const langLabel = language === "zh" ? "中文" : language === "en" ? "英文" : "中英混合";
  const ch = channelLabel[channel] || channel;
  const firstCustomerMsg = customerMsgs[0]?.content.slice(0, 80) || "";

  return `${ch}对话（${langLabel}，${customerMsgs.length}条客户消息，${staffMsgs.length}条回复）：${firstCustomerMsg}`;
}
