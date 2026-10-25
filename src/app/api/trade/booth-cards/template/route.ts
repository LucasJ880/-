/**
 * GET /api/trade/booth-cards/template — 下载展会速记卡录入模板（xlsx：表头 + 示例行 + 说明页）
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { BOOTH_CARD_ROLES, buildBoothCardTemplate } from "@/lib/trade/booth-cards";

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, BOOTH_CARD_ROLES);
  if (auth instanceof NextResponse) return auth;

  return new NextResponse(new Uint8Array(buildBoothCardTemplate()), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="booth-cards-template.xlsx"; filename*=UTF-8''${encodeURIComponent("展会速记卡模板.xlsx")}`,
      "Cache-Control": "no-store",
    },
  });
}
