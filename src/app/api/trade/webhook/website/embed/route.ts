/**
 * POST /api/trade/webhook/website/embed — 青砚托管嵌入表单（public/embed/inquiry.js）的提交入口
 *
 * 鉴权（公开 key 模式）：请求头 x-qingyan-form-key = website 通道的公开 key（qyk_…），
 * 且 Origin 必须与该通道 allowedOrigins 中的某一项精确相等（scheme + host[:port]）。
 * 公开 key 写在网页里、Origin 可被非浏览器伪造，所以挡滥用的是：蜜罐 + 限流（数据库计数：每组织 × 访客 IP
 * 10 分钟、每组织每小时 / 每天；另有按通道 × IP 的请求次数粗筛）。访客 IP 只以 HMAC 存进收据载荷 meta.ipHash。
 * 路径在 /api/trade/webhook/* 下，middleware 已放行（PUBLIC_PATHS），鉴权完全在本路由内。
 *
 * CORS：只回显通过校验的来源（预检时为任一已启用嵌入表单的通道白名单里的来源）；key / 来源不对的响应不带 CORS 头。
 * 响应：成功只有 { ok: true, receiptId }——不返回线索 / 商机 / 是否重复等内部信息（防枚举）。
 * 入站与站点后端转发同一条链路（收据来源 embed，事件 id emb:<浏览器 uuid>），FDE 走 after()，请求里没有 LLM。
 * 主干未建成（SPINE_FAILED / INCOMPLETE）时返回 503，脚本用同一事件 id 重试即可补齐（收据幂等）。
 */

import { NextRequest, NextResponse } from "next/server";
import { checkRateLimitAsync } from "@/lib/common/rate-limit";
import {
  EMBED_KEY_HEADER,
  EMBED_MAX_BODY_BYTES,
  countEmbedSubmissions,
  decoyReceiptId,
  embedIpHash,
  isOriginRegisteredForEmbed,
  resolveWebsiteChannelByPublicKey,
  toEmbedInquiryRaw,
} from "@/lib/trade/embed-intake";
import { EMBED_ATTEMPT_LIMIT, decideEmbedRateLimit } from "@/lib/trade/embed-rate-limit";
import { originAllowed } from "@/lib/trade/website-channel-credentials";
import { ingestWebsiteInquiry, normalizeInquiry } from "@/lib/trade/website-inquiry";
import { EMBED_INQUIRY_SOURCE, findReceiptByEventId } from "@/lib/trade/website-inquiry-receipts";

export const runtime = "nodejs";
// 与 /api/trade/webhook/website 相同：after() 里的 FDE 计入本函数的 maxDuration（见 docs/QINGYAN_WEBSITE_INTAKE_ASYNC.md §9）
export const maxDuration = 300;

function corsHeaders(allowedOrigin: string | null): Record<string, string> {
  const h: Record<string, string> = { Vary: "Origin" };
  if (allowedOrigin) {
    h["Access-Control-Allow-Origin"] = allowedOrigin;
    h["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    h["Access-Control-Allow-Headers"] = `content-type, ${EMBED_KEY_HEADER}`;
    // 白名单删掉某个来源后，浏览器缓存的预检最多 10 分钟内失效
    h["Access-Control-Max-Age"] = "600";
  }
  return h;
}

function reply(body: Record<string, unknown>, status: number, allowedOrigin: string | null, extra?: Record<string, string>) {
  return NextResponse.json(body, {
    status,
    headers: { ...corsHeaders(allowedOrigin), "Cache-Control": "no-store", ...(extra ?? {}) },
  });
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  const registered = await isOriginRegisteredForEmbed(origin).catch(() => false);
  return new NextResponse(null, { status: 204, headers: corsHeaders(registered ? origin : null) });
}

async function readPayload(request: NextRequest): Promise<Record<string, unknown> | null> {
  const ct = request.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const body = await request.json().catch(() => null);
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  }
  if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    if (!form) return null;
    const out: Record<string, unknown> = {};
    form.forEach((value, k) => {
      if (typeof value === "string") out[k] = value;
    });
    return out;
  }
  return null;
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const key = request.headers.get(EMBED_KEY_HEADER)?.trim() ?? "";

  const channel = key ? await resolveWebsiteChannelByPublicKey(key) : null;
  if (!channel) {
    return reply({ ok: false, error: "invalid_key" }, 401, null);
  }
  if (!originAllowed(origin, channel.allowedOrigins)) {
    return reply({ ok: false, error: "origin_not_allowed" }, 403, null);
  }
  // 以下响应都回显这个已精确匹配的来源，脚本才能读到错误并提示访客
  const allowOrigin = origin;

  const ipHash = embedIpHash(request.headers, channel);
  const attempt = await checkRateLimitAsync(EMBED_ATTEMPT_LIMIT, `${channel.id}:${ipHash}`);
  if (!attempt.allowed) {
    return reply({ ok: false, error: "rate_limited" }, 429, allowOrigin, {
      "Retry-After": String(Math.max(1, Math.ceil(attempt.retryAfterMs / 1000))),
    });
  }

  if (Number(request.headers.get("content-length") ?? "0") > EMBED_MAX_BODY_BYTES) {
    return reply({ ok: false, error: "payload_too_large" }, 413, allowOrigin);
  }
  const payload = await readPayload(request);
  if (!payload) {
    return reply({ ok: false, error: "invalid_body" }, 400, allowOrigin);
  }

  const raw = toEmbedInquiryRaw(payload);
  const normalized = normalizeInquiry(raw);
  // 蜜罐命中：对机器人假装成功（形似真实的收据 id），不落库、不计数
  if (normalized.ok && normalized.value.honeypotTripped) {
    return reply({ ok: true, receiptId: decoyReceiptId() }, 200, allowOrigin);
  }
  // 嵌入表单要求邮箱（回复草稿按邮件发出）
  if (!normalized.ok || !normalized.value.email) {
    const code = String(raw.email ?? "").trim() ? "invalid_email" : "email_required";
    return reply({ ok: false, error: code }, 400, allowOrigin);
  }

  try {
    const inquiry = normalized.value;
    // 同一事件的重试（网络中断 / 503 后用同一 uuid 重发）不占限额：它不会新建收据
    const known = await findReceiptByEventId(channel.orgId, inquiry.eventId, EMBED_INQUIRY_SOURCE);
    if (!known) {
      const decision = decideEmbedRateLimit(await countEmbedSubmissions(channel.orgId, ipHash, new Date()));
      if (!decision.allowed) {
        return reply({ ok: false, error: "rate_limited" }, 429, allowOrigin, { "Retry-After": String(decision.retryAfterSec) });
      }
    }

    // deferred：FDE 交给 after()，请求路径里没有 LLM
    const result = await ingestWebsiteInquiry(channel.orgId, inquiry, {
      origin: { kind: "embed" },
      fdeMode: "deferred",
      receiptMeta: { ipHash },
    });
    if (!result.spine.ok && !result.busy) {
      // Trade 线索已落库但主干未建成：让脚本用同一事件 id 重试补齐（不暴露内部原因）
      return reply({ ok: false, error: "temporarily_unavailable" }, 503, allowOrigin, { "Retry-After": "5" });
    }
    return reply({ ok: true, receiptId: result.receiptId }, 200, allowOrigin);
  } catch (err) {
    console.error("[embed-inquiry] ingest failed:", err instanceof Error ? err.message : err);
    return reply({ ok: false, error: "server_error" }, 500, allowOrigin);
  }
}
