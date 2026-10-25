/**
 * GET /api/trade/webhook/website/status?eventId=… — 网站询盘处理状态（只读）
 *
 * 鉴权：只认 header x-qingyan-webhook-secret（website 通道密钥）；不接受 ?secret= 或请求体，
 * 免得密钥进访问日志。组织由密钥在服务端解析，调用方无法指定或跨组织查询。
 * 路径在 /api/trade/webhook/* 下，middleware 已放行（PUBLIC_PATHS），鉴权完全在本路由内。
 *
 * 返回与 POST 同一套快照字段（receiptId / prospectId / opportunityId / spine / complete / fde{status, terminal, …}），
 * 外加 receiptStatus。只读：不认领收据、不增加 attempts、不安排或执行 FDE。
 * 只给服务端调用（站点后端轮询），不开放 CORS。
 */

import { NextRequest, NextResponse } from "next/server";
import { readWebsiteInquiryStatus, resolveWebsiteChannelBySecret, websiteWebhookBody } from "@/lib/trade/website-inquiry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 与 normalizeInquiry 对 eventId 的清洗一致（折叠空白、截到 120 字符），否则长 id 查不到收据 */
const EVENT_ID_MAX = 120;

export async function GET(request: NextRequest) {
  const secret = request.headers.get("x-qingyan-webhook-secret")?.trim() ?? "";
  const channel = await resolveWebsiteChannelBySecret(secret);
  if (!channel) {
    return NextResponse.json({ error: "invalid secret" }, { status: 401 });
  }

  const eventId = (request.nextUrl.searchParams.get("eventId") ?? "").replace(/\s+/g, " ").trim().slice(0, EVENT_ID_MAX);
  if (!eventId) {
    return NextResponse.json({ error: "eventId required" }, { status: 400 });
  }

  try {
    const status = await readWebsiteInquiryStatus(channel.orgId, eventId);
    if (!status) {
      return NextResponse.json({ ok: false, eventId, error: "unknown event" }, { status: 404 });
    }
    return NextResponse.json({ ...websiteWebhookBody(status), receiptStatus: status.receiptStatus });
  } catch (err) {
    console.error("[website-inquiry] status read failed:", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
