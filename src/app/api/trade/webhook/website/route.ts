/**
 * POST /api/trade/webhook/website — 独立站询盘表单接入
 *
 * 鉴权：website 通道密钥（header x-qingyan-webhook-secret / ?secret= / body.secret）
 * 载荷：JSON 或 form-urlencoded / multipart（字段见 website-inquiry.ts）
 * 跨域：保留放开的 CORS，只为兼容旧版渠道页那段把密钥写在网页里的前端代码；新接入请用服务器转发
 *   （密钥只在服务器上）或嵌入表单（./embed，公开 key + 来源白名单 + 限流），见 docs/QINGYAN_INTAKE_WEBHOOK.md
 * 事件身份：eventId 在任何业务写入前落收据（WebsiteInquiryReceipt），重发按事件逐项补齐缺失步骤；
 * 同一事件并发到达时后到者返回 busy 不并行执行。响应字段是真实记录，不由 HTTP 状态推断。
 *
 * 异步入站：请求内只做 收据 → Trade 线索/消息 → Revenue Spine（客户/商机/互动/行动）就返回 HTTP 200，
 * 请求路径里没有 LLM。FDE（研究/RFQ 抽取/评分/草稿，约 90 s、2 次 LLM）由 after() 在响应之后执行，
 * 执行前原子认领（与重发、cron 互斥，同一 FDE 不会跑两次）。首个响应 fde.status=queued、terminal=false、
 * complete=false；FDE 到终态后，同一 eventId 重发或 GET ./status 返回 complete=true、fde.terminal=true。
 * 重发从不在请求内执行 FDE：FDE 可重跑且未被认领时只用 after() 安排。
 */

import { NextRequest, NextResponse } from "next/server";
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

async function readPayload(request: NextRequest): Promise<Record<string, unknown>> {
  const ct = request.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const body = await request.json().catch(() => null);
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  }
  const form = await request.formData().catch(() => null);
  if (!form) return {};
  const out: Record<string, unknown> = {};
  form.forEach((value, key) => {
    if (typeof value === "string") out[key] = value;
  });
  return out;
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const payload = await readPayload(request);

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
