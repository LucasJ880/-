/**
 * POST /api/trade/webhook/website — 独立站询盘表单接入
 *
 * 鉴权：website 通道密钥（header x-qingyan-webhook-secret / ?secret= / body.secret）
 * 载荷：JSON 或 form-urlencoded / multipart（字段见 website-inquiry.ts）
 * 跨域：网站前端直接 fetch，故放开 CORS（密钥 + 蜜罐防滥用）
 */

import { NextRequest, NextResponse } from "next/server";
import {
  ingestWebsiteInquiry,
  normalizeInquiry,
  resolveWebsiteChannelBySecret,
} from "@/lib/trade/website-inquiry";

export const runtime = "nodejs";
export const maxDuration = 120;

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
    return json(
      {
        ok: true,
        prospectId: result.prospectId,
        duplicate: result.duplicate,
        opportunityId: result.spine.ok ? result.spine.opportunityId : null,
        spine: result.spine.ok ? "ok" : result.spine.code,
      },
      200,
      origin,
    );
  } catch (err) {
    console.error("[website-inquiry] ingest failed:", err);
    return json({ error: "server error" }, 500, origin);
  }
}
