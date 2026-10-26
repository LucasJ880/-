/**
 * POST /api/trade/webhook/website — 独立站询盘表单接入（站点后端转发）
 *
 * 鉴权：website 通道密钥（header x-qingyan-webhook-secret；兼容旧接入的 ?secret= / body.secret）。
 * 载荷：JSON 或 form-urlencoded / multipart（字段见 docs/QINGYAN_INTAKE_WEBHOOK.md §1）。
 * 跨域：放开的 CORS 只为兼容旧版渠道页那段把密钥写在网页里的前端代码；新接入用服务器转发或嵌入表单（./embed）。
 * 请求内只做到 Revenue Spine intake 就返回，FDE 由 after() 在响应之后执行；事件身份、重发与响应契约见
 * docs/QINGYAN_WEBSITE_INTAKE_ASYNC.md §2–§4。
 */

import { NextRequest, NextResponse } from "next/server";
import { readInquiryPayload } from "@/lib/trade/embed-intake";
import {
  ingestWebsiteInquiry,
  normalizeInquiry,
  resolveWebsiteChannelBySecret,
  websiteWebhookBody,
} from "@/lib/trade/website-inquiry";

export const runtime = "nodejs";
// 请求路径（收据 + Trade + Revenue Spine intake）只有 DB 往返；after() 里的 FDE（RFQ 抽取 LLM ≤25s +
// 草稿润色 LLM ≤20s + 数十次 DB 往返，远程实测 89–92s）同样计入本函数的 maxDuration，所以保持 300。
// 与之耦合：FDE 认领过期 FDE_CLAIM_STALE_MS、收据处理过期 RECEIPT_PROCESSING_STALE_MS 都必须大于 300 s。
export const maxDuration = 300;

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-qingyan-webhook-secret",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body: unknown, status: number, origin: string | null) {
  return NextResponse.json(body, { status, headers: corsHeaders(origin) });
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request.headers.get("origin")),
  });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const payload = (await readInquiryPayload(request)) ?? {};

  const secret =
    request.headers.get("x-qingyan-webhook-secret")?.trim() ||
    new URL(request.url).searchParams.get("secret")?.trim() ||
    (typeof payload.secret === "string" ? payload.secret.trim() : "");

  const channel = await resolveWebsiteChannelBySecret(secret);
  if (!channel) {
    return json({ error: "invalid secret" }, 401, origin);
  }

  const normalized = normalizeInquiry(payload);
  if (!normalized.ok) {
    return json({ error: normalized.error }, 400, origin);
  }
  // 蜜罐命中：对机器人假装成功，不落库
  if (normalized.value.honeypotTripped) {
    return json({ ok: true }, 200, origin);
  }

  try {
    // deferred：FDE 交给 after()（默认调度器）；HTTP 保持 200（不是 202）以兼容既有站点桥接
    const result = await ingestWebsiteInquiry(channel.orgId, normalized.value, { fdeMode: "deferred" });
    // fde 取自真实记录（SalesAction / AgentRun / PendingAction）；terminal 告诉调用方是否还需继续恢复。
    // HTTP 200 不代表全链完成：调用方按 spine / opportunityId / complete / fde.terminal 判定。
    return json(websiteWebhookBody(result), 200, origin);
  } catch (err) {
    console.error("[website-inquiry] ingest failed:", err);
    return json({ error: "server error" }, 500, origin);
  }
}
