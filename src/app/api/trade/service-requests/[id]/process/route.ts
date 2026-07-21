/**
 * 外贸客户服务工单 — 处理方出图（Image Edit / ModelRegistry.image）
 *
 * POST /api/trade/service-requests/[id]/process
 *   body: { inputAssetId, prompt }
 *
 * 调用方须为工单的处理方 org（fulfillmentOrgId）。
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { resolveTradeOrgId } from "@/lib/trade/access";
import { runDesignImageForRequest } from "@/lib/trade/fulfillment";

export const maxDuration = 120;

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const { id } = await ctx.params;
  const inputAssetId = (body.inputAssetId as string | undefined)?.trim();
  const prompt = (body.prompt as string | undefined)?.trim();
  if (!inputAssetId || !prompt) {
    return NextResponse.json({ error: "缺少 inputAssetId 或 prompt" }, { status: 400 });
  }

  try {
    const asset = await runDesignImageForRequest({
      requestId: id,
      fulfillmentOrgId: orgRes.orgId,
      inputAssetId,
      prompt,
      createdById: auth.user.id,
    });
    return NextResponse.json({ ok: true, asset }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "出图失败" },
      { status: 400 },
    );
  }
}
