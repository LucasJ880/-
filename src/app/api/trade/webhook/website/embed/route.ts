/**
 * POST /api/trade/webhook/website/embed — 青砚托管嵌入表单（public/embed/inquiry.js）的提交入口
 *
 * 鉴权完全在本路由内（middleware 放行 /api/trade/webhook/*）：请求头公开 key（x-qingyan-form-key）+ Origin 与该通道
 * allowedOrigins 精确相等；CORS 只回显通过校验的来源（预检按 ?k=<公开 key> 定位通道）。挡滥用的是蜜罐 + 限流。
 * 成功只回 { ok, receiptId }（防枚举）；入站与站点后端转发同一条链路（收据来源 embed），FDE 走 after()，请求里没有 LLM。
 * 状态码与重试语义（400 / 429 / 503 / 拒收按"已收到"返回 200）见 docs/QINGYAN_INTAKE_WEBHOOK.md §3.5。
 */

import { NextRequest, NextResponse } from "next/server";
import { checkRateLimitAsync } from "@/lib/common/rate-limit";
import {
  EMBED_ATTEMPT_LIMIT,
  EMBED_KEY_HEADER,
  EMBED_KEY_QUERY,
  EMBED_MAX_BODY_BYTES,
  countEmbedSubmissions,
  decideEmbedRateLimit,
  decoyReceiptId,
  embedIpHash,
  hasInquiryContent,
  isPermanentSpineRejection,
  preflightAllowedOrigin,
  readInquiryPayload,
  resolveWebsiteChannelByPublicKey,
  toEmbedInquiryRaw,
} from "@/lib/trade/embed-intake";
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
  const key = request.nextUrl.searchParams.get(EMBED_KEY_QUERY);
  const allowed = await preflightAllowedOrigin(origin, key).catch(() => null);
  return new NextResponse(null, { status: 204, headers: corsHeaders(allowed) });
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
  const payload = await readInquiryPayload(request);
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
  // 没有任何需求内容：主干会拒收（EMPTY_MESSAGE），在入站前挡下，不建线索、不通知
  if (!hasInquiryContent(normalized.value)) {
    return reply({ ok: false, error: "message_required" }, 400, allowOrigin);
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
      if (isPermanentSpineRejection(result.spine)) {
        // 主干拒收：重试同一事件不会变好；Trade 线索与销售通知已落库，对访客按"已收到"处理（不暴露内部原因）
        console.warn("[embed-inquiry] revenue spine rejected the inquiry; trade lead kept:", "intakeCode" in result.spine ? result.spine.intakeCode : result.spine.code);
      } else {
        // 暂时失败（抛错 / 未建成）：让脚本用同一事件 id 重试补齐
        return reply({ ok: false, error: "temporarily_unavailable" }, 503, allowOrigin, { "Retry-After": "5" });
      }
    }
    return reply({ ok: true, receiptId: result.receiptId }, 200, allowOrigin);
  } catch (err) {
    console.error("[embed-inquiry] ingest failed:", err instanceof Error ? err.message : err);
    return reply({ ok: false, error: "server_error" }, 500, allowOrigin);
  }
}
