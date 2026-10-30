/**
 * GET /api/trade/booth-cards/template — 下载展会速记卡录入模板（xlsx：表头 + 示例行 + 说明页）
 */

import { NextRequest, NextResponse } from "next/server";
import { buildBoothCardTemplate } from "@/lib/trade/booth-cards";
import { TRADE_READ_KEYS, requireTradePermission } from "@/lib/trade/access";

export async function GET(request: NextRequest) {
  const auth = await requireTradePermission(request, TRADE_READ_KEYS);
  if (auth instanceof NextResponse) return auth;

  return new NextResponse(new Uint8Array(buildBoothCardTemplate()), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="booth-cards-template.xlsx"; filename*=UTF-8''${encodeURIComponent("展会速记卡模板.xlsx")}`,
      "Cache-Control": "no-store",
    },
  });
}
