/**
 * 企业微信回调接收 API
 *
 * GET  — URL 验证（回显解密后的 echostr）
 * POST — 接收消息推送（验签 + 解密 + 按网关业务模式路由）
 *
 * 平台级（默认）：
 *   URL 可省略 org，或使用 ?org=platform；凭证读平台网关；
 *   业务组织由 WeChatBinding → activeOrg 解析。
 * 组织级（兼容）：
 *   ?org=<真实ORG_ID> 仍可用，凭证读该组织网关。
 */

import { after, NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  handleInboundMessage,
  attachAdapterInbound,
} from "@/lib/messaging/gateway";
import { WeComAdapter, parseWeComMessageXml } from "@/lib/messaging/adapters/wecom";
import {
  isPlatformWecomOrgKey,
  resolveWecomCredentialOrgId,
} from "@/lib/messaging/platform-wecom";
import type { InboundMessage } from "@/lib/messaging/types";

export const maxDuration = 60;

// 注意：每次都要新建 Response（Response body 是一次性流，复用会在第二个请求返回空体）。
function ok(): NextResponse {
  return NextResponse.json({ errcode: 0, errmsg: "ok" });
}

/**
 * 企业微信回调 URL 验证
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const msgSignature = searchParams.get("msg_signature") ?? "";
  const timestamp = searchParams.get("timestamp") ?? "";
  const nonce = searchParams.get("nonce") ?? "";
  const echostr = searchParams.get("echostr") ?? "";
  const credentialOrgId = resolveWecomCredentialOrgId(searchParams.get("org"));

  const gateway = await db.weChatGateway.findUnique({
    where: { orgId_channel: { orgId: credentialOrgId, channel: "wecom" } },
  });

  if (!gateway?.callbackToken || !gateway?.encodingKey) {
    return new NextResponse("not configured", { status: 404 });
  }

  const adapter = new WeComAdapter(credentialOrgId);
  await adapter.loadConfig();
  const plain = adapter.verifyCallback(msgSignature, timestamp, nonce, echostr);

  if (plain === null) {
    return new NextResponse("signature mismatch", { status: 403 });
  }

  return new NextResponse(plain, { status: 200 });
}

/**
 * 接收企业微信消息推送
 */
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const queryOrg = searchParams.get("org");
  const credentialOrgId = resolveWecomCredentialOrgId(queryOrg);
  const msgSignature = searchParams.get("msg_signature") ?? "";
  const timestamp = searchParams.get("timestamp") ?? "";
  const nonce = searchParams.get("nonce") ?? "";

  try {
    const body = await req.text();

    const gateway = await db.weChatGateway.findUnique({
      where: { orgId_channel: { orgId: credentialOrgId, channel: "wecom" } },
    });
    if (!gateway?.encodingKey || !gateway?.callbackToken) return ok();

    const adapter = new WeComAdapter(credentialOrgId);
    const loaded = await adapter.loadConfig();
    if (!loaded) return ok();

    // 验签 + 解密内层消息 XML
    const plainXml = adapter.decryptCallback(body, msgSignature, timestamp, nonce);
    if (!plainXml) {
      console.warn(
        "[WeCom Callback] signature/decrypt failed for credential org",
        credentialOrgId,
      );
      return ok();
    }

    const parsed = parseWeComMessageXml(plainXml);
    const msgType = parsed.MsgType;
    const fromUser = parsed.FromUserName;
    if (!fromUser) return ok();

    // 仅处理文本 / 图片；事件、语音、文件等暂忽略（回 ok）。
    let inbound: InboundMessage | null = null;

    // 组织级回调可带业务 org；平台级留给 binding 解析
    const hintOrgId = isPlatformWecomOrgKey(queryOrg)
      ? undefined
      : credentialOrgId;

    if (msgType === "text" && parsed.Content) {
      inbound = {
        channel: "wecom",
        externalUserId: fromUser,
        content: parsed.Content,
        messageType: "text",
        externalMsgId: parsed.MsgId,
        timestamp: new Date(
          parseInt(parsed.CreateTime || "0", 10) * 1000 || Date.now(),
        ),
        orgId: hintOrgId,
      };
    } else if (msgType === "image" && parsed.MediaId) {
      const media = await adapter.downloadMedia(parsed.MediaId);
      if (!media) {
        console.warn("[WeCom Callback] media download failed", parsed.MediaId);
        return ok();
      }
      inbound = {
        channel: "wecom",
        externalUserId: fromUser,
        content: "",
        messageType: "image",
        externalMsgId: parsed.MsgId,
        timestamp: new Date(
          parseInt(parsed.CreateTime || "0", 10) * 1000 || Date.now(),
        ),
        media: { bytes: media.bytes, mimeType: media.mimeType },
        orgId: hintOrgId,
      };
    }

    if (!inbound) return ok();

    // trade_intake 仍需明确业务 org（组织级回调）；平台网关不做外贸受理
    if (gateway.mode === "trade_intake") {
      if (isPlatformWecomOrgKey(queryOrg) || !hintOrgId) {
        console.warn(
          "[WeCom Callback] trade_intake requires ?org=<真实组织ID>",
        );
        return ok();
      }
      await attachAdapterInbound(adapter, {
        orgId: hintOrgId,
        mode: gateway.mode,
        fulfillmentOrgId: gateway.fulfillmentOrgId,
      });
      const handler = adapter.getMessageHandler();
      if (handler) await handler(inbound);
      return ok();
    }

    after(async () => {
      try {
        await handleInboundMessage(inbound);
      } catch (e) {
        console.error("[WeCom Callback] async handle failed:", e);
      }
    });

    return ok();
  } catch (e) {
    console.error("[WeCom Callback] Error:", e);
    return ok();
  }
}
