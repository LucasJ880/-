/**
 * 外贸客户服务工单 — 微信受理链路
 *
 * 职责：把国内外贸客户在微信里发来的自然语言需求，经 AI 分类 + 结构化提取，
 * 落成 TradeServiceRequest（归属客户 org），并生成给客户的确认回复。
 *
 * 隔离：
 * - org 解析复用 resolveInboundTradeOrgId（按通道配置反查客户 org，禁止信任 payload 内 orgId / default）。
 * - 落库强制走 service-request.ts 的 createServiceRequest（必带 orgId）。
 */

import { put } from "@vercel/blob";
import { createCompletion } from "@/lib/ai/client";
import { logger } from "@/lib/common/logger";
import {
  resolveInboundTradeOrgId,
  type TradeInboundProvider,
} from "./inbound-org";
import {
  createServiceRequest,
  assignToFulfillment,
  addServiceAsset,
  getOpenRequestForExternalUser,
  type ServiceRequestType,
  type ServiceRequestPriority,
} from "./service-request";

export type ServiceIntakeOrgResolution =
  | { ok: true; orgId: string; channelId: string }
  | { ok: false; reason: string };

/**
 * 反查微信受理来源对应的客户 org（webhook 类通道）。
 * 复用 trade 入站 org 解析，禁止信任 payload 内 orgId、禁止 default 兜底。
 */
export async function resolveServiceIntakeOrg(input: {
  provider: TradeInboundProvider;
  providerAccountId?: string | null;
}): Promise<ServiceIntakeOrgResolution> {
  const res = await resolveInboundTradeOrgId(input);
  if (!res.ok) return { ok: false, reason: res.reason };
  return { ok: true, orgId: res.orgId, channelId: res.channelId };
}

// ── AI 分类 + 结构化提取 ───────────────────────────────────────

interface ExtractedRequest {
  isActionable: boolean;
  requestType: ServiceRequestType;
  title: string;
  description: string;
  priority: ServiceRequestPriority;
  structuredSpec: Record<string, unknown>;
  reply: string;
}

const REQUEST_TYPE_VALUES: ServiceRequestType[] = [
  "design_image",
  "doc_summary",
  "meeting_minutes",
  "group_summary",
  "other",
];

const PRIORITY_VALUES: ServiceRequestPriority[] = ["low", "medium", "high", "urgent"];

const INTAKE_SYSTEM_PROMPT = `你是「青砚」外贸服务台的 AI 受理助手，正在通过微信与一家外贸公司的客户对话。
你的任务：判断客户这条消息是否是一个明确的、可以建单处理的服务需求，并提取结构化信息。

我们能处理的需求类型（requestType）：
- design_image：美工 / 产品图处理（出图、修图、换底、白底图、详情页主图、吊牌/包装设计等）
- doc_summary：文档处理 / 总结（资料整理、文档摘要、翻译要点等）
- meeting_minutes：会议记录 / 纪要整理
- group_summary：聊天群记录总结（客户会把导出的聊天记录或截图发来）
- other：与上面相关但不易归类的服务需求

判定规则：
- 仅当客户表达了一个具体、可执行的服务需求时，isActionable=true。
- 闲聊、问候、单纯咨询能力/价格、信息不足无法建单时，isActionable=false，并在 reply 里礼貌引导客户补充关键信息（要做什么、用途、数量、风格/尺寸/底色等）。
- 不要编造客户没有提供的信息；structuredSpec 只填客户明确给到或可合理归纳的字段，未知字段省略。

只输出一个 JSON 对象，不要任何额外文字、不要 markdown 代码块，结构如下：
{
  "isActionable": true,
  "requestType": "design_image",
  "title": "简短中文标题（<=20字）",
  "description": "对需求的客观转述（中文）",
  "priority": "low|medium|high|urgent",
  "structuredSpec": { "可选字段，例如": "productName, quantity, background, size, style, deadline, sourceImages, notes" },
  "reply": "给客户的简洁中文回复（手机阅读，短句分行）。若已建单，确认已受理并简述理解；若信息不足，引导补充。"
}`;

function tryParseExtracted(raw: string): Partial<ExtractedRequest> | null {
  let cleaned = raw.trim();
  const fenceStart = cleaned.indexOf("```");
  if (fenceStart !== -1) {
    const afterFence = cleaned.indexOf("\n", fenceStart);
    const fenceEnd = cleaned.lastIndexOf("```");
    if (afterFence !== -1 && fenceEnd > afterFence) {
      cleaned = cleaned.slice(afterFence + 1, fenceEnd).trim();
    }
  }
  try {
    return JSON.parse(cleaned) as Partial<ExtractedRequest>;
  } catch {
    return null;
  }
}

function normalize(parsed: Partial<ExtractedRequest> | null, fallbackContent: string): ExtractedRequest {
  const requestType = REQUEST_TYPE_VALUES.includes(parsed?.requestType as ServiceRequestType)
    ? (parsed!.requestType as ServiceRequestType)
    : "other";
  const priority = PRIORITY_VALUES.includes(parsed?.priority as ServiceRequestPriority)
    ? (parsed!.priority as ServiceRequestPriority)
    : "medium";
  const isActionable = parsed?.isActionable === true;
  const title = (parsed?.title ?? "").toString().trim() || fallbackContent.slice(0, 20) || "外贸服务需求";
  const description = (parsed?.description ?? "").toString().trim() || fallbackContent.trim();
  const structuredSpec =
    parsed?.structuredSpec && typeof parsed.structuredSpec === "object"
      ? (parsed.structuredSpec as Record<string, unknown>)
      : {};
  const reply =
    (parsed?.reply ?? "").toString().trim() ||
    (isActionable
      ? "已收到您的需求，我们会尽快安排处理。"
      : "您好，请补充一下具体需求（要做什么、用途、数量、风格/尺寸/底色等），方便我帮您建单。");
  return { isActionable, requestType, title, description, priority, structuredSpec, reply };
}

export async function classifyAndExtractRequest(content: string): Promise<ExtractedRequest> {
  try {
    const raw = await createCompletion({
      systemPrompt: INTAKE_SYSTEM_PROMPT,
      userPrompt: `客户消息：\n${content}`,
      mode: "structured",
      temperature: 0.2,
      timeoutMs: 20000,
    });
    return normalize(tryParseExtracted(raw), content);
  } catch (e) {
    // AI 不可用时兜底：不丢失客户需求，按 other 建单并提示人工跟进。
    logger.warn("trade.service_intake.classify_failed", {
      error: e instanceof Error ? e.message : String(e),
    });
    return {
      isActionable: true,
      requestType: "other",
      title: content.slice(0, 20) || "外贸服务需求",
      description: content.trim(),
      priority: "medium",
      structuredSpec: { _aiFallback: true },
      reply: "已收到您的消息，我们会尽快人工跟进确认需求细节。",
    };
  }
}

// ── 受理主入口 ─────────────────────────────────────────────────

export interface TradeServiceIntakeInput {
  /** 客户所属组织（必须由 resolveServiceIntakeOrg / 调用方安全解析得到，禁止信任客户输入） */
  orgId: string;
  channel: string; // personal_wechat | wecom
  externalUserId: string;
  externalUserName?: string | null;
  bindingId?: string | null;
  content: string;
  /** 可选：建单成功后自动桥接到的处理方组织（加拿大团队 org），经唯一 relay 写入 */
  autoFulfillmentOrgId?: string | null;
}

export interface TradeServiceIntakeResult {
  reply: string;
  requestId?: string;
  created: boolean;
  requestType?: ServiceRequestType;
}

/**
 * 受理一条微信入站消息：分类 → 结构化 → 建单（仅可执行需求）→ 返回客户回复。
 */
export async function handleTradeServiceIntake(
  input: TradeServiceIntakeInput,
): Promise<TradeServiceIntakeResult> {
  const orgId = (input.orgId ?? "").trim();
  if (!orgId || orgId === "default") {
    throw new Error("[service-intake] 非法 orgId，拒绝受理以保证租户隔离");
  }

  const extracted = await classifyAndExtractRequest(input.content);

  if (!extracted.isActionable) {
    return { reply: extracted.reply, created: false };
  }

  const request = await createServiceRequest({
    orgId,
    requestType: extracted.requestType,
    title: extracted.title,
    description: extracted.description,
    priority: extracted.priority,
    structuredSpec: {
      ...extracted.structuredSpec,
      _intake: {
        channel: input.channel,
        externalUserId: input.externalUserId,
        externalUserName: input.externalUserName ?? null,
        rawMessage: input.content,
      },
    },
    sourceChannel: input.channel,
    externalUserId: input.externalUserId,
    bindingId: input.bindingId ?? null,
  });

  logger.info("trade.service_intake.created", {
    orgId,
    requestId: request.id,
    requestType: request.requestType,
    channel: input.channel,
  });

  // 自动桥接到处理方组织（加拿大团队）。失败不阻断受理，工单仍留在客户 org 可后续手动指派。
  await maybeAutoBridge(orgId, request.id, input.autoFulfillmentOrgId);

  return {
    reply: extracted.reply,
    requestId: request.id,
    created: true,
    requestType: extracted.requestType,
  };
}

/** 自动桥接：建单后把工单经唯一 relay 指派给处理方 org。失败仅告警不抛错。 */
async function maybeAutoBridge(
  orgId: string,
  requestId: string,
  autoFulfillmentOrgId?: string | null,
): Promise<void> {
  const fulfillmentOrgId = (autoFulfillmentOrgId ?? "").trim();
  if (!fulfillmentOrgId || fulfillmentOrgId === orgId) return;
  try {
    await assignToFulfillment({ requestId, ownerOrgId: orgId, fulfillmentOrgId });
  } catch (e) {
    logger.warn("trade.service_intake.auto_bridge_failed", {
      orgId,
      requestId,
      fulfillmentOrgId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

// ── 图片受理（落输入素材）─────────────────────────────────────

const INTAKE_BLOB_PREFIX = "trade-service";
const MAX_INTAKE_IMAGE_BYTES = 15 * 1024 * 1024;

export interface TradeServiceImageIntakeInput {
  orgId: string;
  channel: string;
  externalUserId: string;
  externalUserName?: string | null;
  bindingId?: string | null;
  media: { bytes: Buffer; mimeType: string; fileName?: string };
  autoFulfillmentOrgId?: string | null;
}

/**
 * 受理一条图片消息：上传 Blob → 关联到该客户该用户的开放工单（无则建 design_image 单）→ 落 input 资产。
 */
export async function handleTradeServiceImageIntake(
  input: TradeServiceImageIntakeInput,
): Promise<TradeServiceIntakeResult> {
  const orgId = (input.orgId ?? "").trim();
  if (!orgId || orgId === "default") {
    throw new Error("[service-intake] 非法 orgId，拒绝受理图片");
  }

  const { bytes, mimeType } = input.media;
  if (!bytes || bytes.length === 0) {
    return { reply: "图片内容为空，请重新发送。", created: false };
  }
  if (bytes.length > MAX_INTAKE_IMAGE_BYTES) {
    return { reply: "图片太大（超过 15MB），请压缩后再发。", created: false };
  }
  if (!mimeType.startsWith("image/")) {
    return { reply: "暂时只能处理图片素材，请发送图片。", created: false };
  }

  // 1. 上传 Blob
  const ext = mimeType.includes("jpeg") ? "jpg" : mimeType.includes("webp") ? "webp" : "png";
  const ts = Date.now();
  const pathname = `${INTAKE_BLOB_PREFIX}/${orgId}/intake/${ts}_${input.externalUserId.replace(
    /[^a-zA-Z0-9._-]/g,
    "_",
  )}.${ext}`;
  let fileUrl: string;
  try {
    const blob = await put(pathname, bytes, { access: "public", contentType: mimeType });
    fileUrl = blob.url;
  } catch (e) {
    logger.error("trade.service_image_intake.upload_failed", {
      orgId,
      error: e instanceof Error ? e.message : String(e),
    });
    return { reply: "图片暂存失败，请稍后再发一次。", created: false };
  }

  // 2. 关联开放工单；无则建单
  let request = await getOpenRequestForExternalUser(orgId, input.externalUserId);
  let created = false;
  if (!request) {
    request = await createServiceRequest({
      orgId,
      requestType: "design_image",
      title: "客户图片需求",
      description: "客户通过微信发来图片素材，待补充具体处理要求。",
      structuredSpec: {
        _intake: {
          channel: input.channel,
          externalUserId: input.externalUserId,
          externalUserName: input.externalUserName ?? null,
          source: "image",
        },
      },
      sourceChannel: input.channel,
      externalUserId: input.externalUserId,
      bindingId: input.bindingId ?? null,
    });
    created = true;
    await maybeAutoBridge(orgId, request.id, input.autoFulfillmentOrgId);
  }

  // 3. 落 input 资产
  try {
    await addServiceAsset({
      requestId: request.id,
      orgId,
      kind: "input",
      fileUrl,
      fileName: `intake_${ts}.${ext}`,
      mimeType,
      meta: { source: "wechat_intake", externalUserId: input.externalUserId },
    });
  } catch (e) {
    logger.error("trade.service_image_intake.asset_failed", {
      orgId,
      requestId: request.id,
      error: e instanceof Error ? e.message : String(e),
    });
    return { reply: "图片已收到，但关联需求时出错了，请稍后联系我们。", created };
  }

  logger.info("trade.service_image_intake.attached", {
    orgId,
    requestId: request.id,
    created,
  });

  const reply = created
    ? "已收到您的图片并为您建单。请补充一下具体处理要求（用途、底色、尺寸、风格等），我们会尽快出图。"
    : `已收到图片，已加到需求「${request.title}」里。`;

  return { reply, requestId: request.id, created, requestType: "design_image" };
}

// ── 通道接线 ───────────────────────────────────────────────────

export interface TradeIntakeInboundMessage {
  channel: string;
  externalUserId: string;
  externalUserName?: string | null;
  content: string;
  messageType?: string;
  externalMsgId?: string;
  media?: { bytes: Buffer; mimeType: string; fileName?: string };
}

/**
 * 生成一个绑定到「某个客户 org」的入站消息处理器，用于挂到外贸客户专属微信通道
 * 适配器的 onMessage 上（该适配器本身按客户 org 实例化，业务模式 = 外贸受理）。
 *
 * 与面向内部员工的 messaging/gateway.handleInboundMessage 完全解耦：
 * - 这里不查 WeChatBinding（外贸客户不是青砚内部用户）。
 * - orgId 在工厂创建时固定为客户 org，消息内容无法篡改归属。
 *
 * @param clientOrgId 客户所属组织（由通道配置安全解析得到）。
 * @param sendReply   通过该通道把回复发回客户的回调（通常封装 adapter.sendText）。
 * @param options.autoFulfillmentOrgId 可选：建单后自动桥接到的处理方组织（加拿大团队 org）。
 */
export interface TradeIntakeHandlerDeps {
  handleText?: typeof handleTradeServiceIntake;
  handleImage?: typeof handleTradeServiceImageIntake;
}

export function createTradeIntakeMessageHandler(
  clientOrgId: string,
  sendReply: (to: string, content: string) => Promise<void>,
  options?: { autoFulfillmentOrgId?: string | null; deps?: TradeIntakeHandlerDeps },
): (msg: TradeIntakeInboundMessage) => Promise<void> {
  const orgId = (clientOrgId ?? "").trim();
  if (!orgId || orgId === "default") {
    throw new Error("[service-intake] createTradeIntakeMessageHandler 需要合法 clientOrgId");
  }
  const autoFulfillmentOrgId = options?.autoFulfillmentOrgId ?? null;
  const handleText = options?.deps?.handleText ?? handleTradeServiceIntake;
  const handleImage = options?.deps?.handleImage ?? handleTradeServiceImageIntake;

  // 进程内幂等：长轮询游标已防止跨轮重投，这里再兜底防止同批/瞬时重试重复建单。
  const seen = new Set<string>();
  const markSeen = (id?: string): boolean => {
    if (!id) return false;
    if (seen.has(id)) return true;
    seen.add(id);
    if (seen.size > 2000) seen.delete(seen.values().next().value as string);
    return false;
  };

  return async (msg: TradeIntakeInboundMessage) => {
    if (markSeen(msg.externalMsgId)) {
      logger.info("trade.service_intake.duplicate_skipped", { orgId, msgId: msg.externalMsgId });
      return;
    }

    const messageType = msg.messageType ?? "text";
    let reply: string | null = null;

    try {
      if (messageType === "image" && msg.media) {
        const result = await handleImage({
          orgId,
          channel: msg.channel,
          externalUserId: msg.externalUserId,
          externalUserName: msg.externalUserName ?? null,
          media: msg.media,
          autoFulfillmentOrgId,
        });
        reply = result.reply;
      } else if (messageType === "text") {
        const content = (msg.content ?? "").trim();
        if (!content) return;
        const result = await handleText({
          orgId,
          channel: msg.channel,
          externalUserId: msg.externalUserId,
          externalUserName: msg.externalUserName ?? null,
          content,
          autoFulfillmentOrgId,
        });
        reply = result.reply;
      } else {
        return; // 语音/文件等暂不处理
      }
    } catch (e) {
      logger.error("trade.service_intake.failed", {
        orgId,
        error: e instanceof Error ? e.message : String(e),
      });
      reply = "抱歉，受理出错了，请稍后再发一次，或换种方式描述需求。";
    }

    if (!reply) return;
    try {
      await sendReply(msg.externalUserId, reply);
    } catch (e) {
      logger.warn("trade.service_intake.reply_failed", {
        orgId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };
}
