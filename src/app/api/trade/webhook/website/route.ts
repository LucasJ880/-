/**
 * POST /api/trade/webhook/website — 独立站询盘表单接入
 *
 * 鉴权：website 通道密钥（header x-qingyan-webhook-secret / ?secret= / body.secret）
 * 载荷：JSON 或 form-urlencoded / multipart（字段见 website-inquiry.ts）
 * 跨域：网站前端直接 fetch，故放开 CORS（密钥 + 蜜罐防滥用）
 * 重放：同 eventId / 窗口内同正文 → 不新建对象，返回既有 ID 并补齐缺失的主干 / FDE（站点超时重发安全）
 */

import { NextRequest, NextResponse } from "next/server";
import {
  ingestWebsiteInquiry,
  normalizeInquiry,
  resolveWebsiteChannelBySecret,
} from "@/lib/trade/website-inquiry";

export const runtime = "nodejs";
// 同步链：Trade 询盘 → Revenue Spine → FDE（RFQ 抽取 LLM ≤25s + 草稿润色 LLM ≤20s + 数十次 DB 往返）。
// 隔离分支远程实测 FDE 89–92s、全链 123–141s（含本机→Neon 时延），120s 上限过紧；站点侧转发预算 305s（略大于此值）。
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
    const result = await ingestWebsiteInquiry(channel.orgId, normalized.value);
    // fde：优先 SalesAction 真实状态快照；否则本次运行结果。HTTP 200 ≠ 全链完成，调用方按字段判定。
    const fde = result.fdeState
      ? { status: result.fdeState.status, agentRunId: result.fdeState.agentRunId, pendingActionId: result.fdeState.pendingActionId }
      : result.fde
        ? { status: result.fde.ok ? "completed" : "failed", agentRunId: result.fde.agentRunId, pendingActionId: result.fde.pendingActionId, ...(result.fde.errorCode ? { errorCode: result.fde.errorCode } : {}) }
        : null;
    return json(
      {
        ok: true,
        eventId: normalized.value.eventId || null,
        prospectId: result.prospectId,
        messageId: result.messageId,
        duplicate: result.duplicate,
        replay: result.replay,
        recovered: result.recovered,
        opportunityId: result.spine.ok ? result.spine.opportunityId : null,
        spine: result.spine.ok ? (result.spine.replay ? "replay" : "ok") : result.spine.code,
        fde,
      },
      200,
      origin,
    );
  } catch (err) {
    console.error("[website-inquiry] ingest failed:", err);
    return json({ error: "server error" }, 500, origin);
  }
}
