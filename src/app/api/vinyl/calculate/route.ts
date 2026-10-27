import { NextResponse, type NextRequest } from "next/server";
import { requireTenantContext } from "@/lib/tenancy";
import { calculateVinylItem } from "@/lib/vinyl/calculation-engine";
import {
  buildOrderContext,
  coerceItemInput,
  normalizeLouverSize,
} from "@/lib/vinyl/order-service";
import { VINYL_RULE_VERSION } from "@/lib/vinyl/frame-rules";

/**
 * POST /api/vinyl/calculate —— 即时试算，不入库
 * 录入界面实时预览裁切尺寸用；编码表按本组织配置解析。
 */
export async function POST(request: NextRequest) {
  const tenant = await requireTenantContext(request);
  if (tenant instanceof NextResponse) return tenant;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!Array.isArray(body?.items)) {
    return NextResponse.json({ error: "请提供 items 数组" }, { status: 400 });
  }

  const louverSize = normalizeLouverSize(body.louverSize);
  const ctx = await buildOrderContext(tenant.orgId, louverSize);
  const results = (body.items as Record<string, unknown>[])
    .map(coerceItemInput)
    .map((input) => calculateVinylItem(input, ctx));

  return NextResponse.json({ ruleVersion: VINYL_RULE_VERSION, louverSize, results });
}
