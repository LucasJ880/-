/**
 * GET /api/cron/aivora-sync
 *
 * Vercel Cron 每小时调用：从 Aivora 拉取新成片入库（幂等）。
 * 资产归属组织由 AIVORA_ORG_ID 指定（单公司使用，显式配置避免猜测）。
 * 鉴权方式：Bearer CRON_SECRET
 */

import { NextRequest, NextResponse } from "next/server";
import { syncAivoraVideosForOrg } from "@/lib/operations/service";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgId = process.env.AIVORA_ORG_ID;
  if (!orgId) {
    return NextResponse.json({ skipped: true, reason: "AIVORA_ORG_ID 未配置" });
  }

  try {
    const result = await syncAivoraVideosForOrg(orgId);
    return NextResponse.json({ syncedAt: new Date().toISOString(), ...result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "同步失败" },
      { status: 502 },
    );
  }
}
