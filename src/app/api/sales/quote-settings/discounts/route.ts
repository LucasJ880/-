import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { logAudit } from "@/lib/audit/logger";
import { db } from "@/lib/db";
import {
  loadDiscountsDto,
  validateDiscountsInput,
  DTO_NUMERIC_KEYS,
  type DiscountsDto,
} from "@/lib/blinds/discount-settings";

const TARGET_TYPE = "quote_discount_settings";

function isAdmin(role: string): boolean {
  return role === "admin" || role === "super_admin";
}

/**
 * GET /api/sales/quote-settings/discounts
 *
 * 所有已登录用户都能读取当前折扣率（Order Form / AI 工具 / 驾驶舱共用）
 */
export const GET = withAuth(async () => {
  const dto = await loadDiscountsDto();
  return NextResponse.json(dto);
});

/**
 * PUT /api/sales/quote-settings/discounts
 *
 * 仅 admin / super_admin 可写。每次写入自动记录审计日志（before/after/diff）。
 * body：{ zebra?: number, shangrila?: number, ..., honeycomb?: number }（0~1 之间）
 */
export const PUT = withAuth(async (request, _ctx, user) => {
  if (!isAdmin(user.role)) {
    return NextResponse.json({ error: "仅管理员可修改折扣率" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const parsed = validateDiscountsInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const before = await loadDiscountsDto();

  const updated = await db.quoteDiscountSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", ...parsed.value, updatedBy: user.id },
    update: { ...parsed.value, updatedBy: user.id },
  });

  const after: DiscountsDto = {
    zebra: updated.zebra,
    shangrila: updated.shangrila,
    cellular: updated.cellular,
    roller: updated.roller,
    drapery: updated.drapery,
    sheer: updated.sheer,
    shutters: updated.shutters,
    honeycomb: updated.honeycomb,
    promoWarnPct: updated.promoWarnPct,
    promoDangerPct: updated.promoDangerPct,
    promoMaxPct: updated.promoMaxPct,
    updatedAt: updated.updatedAt.toISOString(),
    updatedBy: updated.updatedBy,
  };

  // 审计：记录字段级 diff
  const diff: Record<string, { from: number; to: number }> = {};
  for (const k of DTO_NUMERIC_KEYS) {
    if (before[k] !== after[k]) {
      diff[k] = { from: before[k], to: after[k] };
    }
  }

  if (Object.keys(diff).length > 0) {
    await logAudit({
      userId: user.id,
      action: "update",
      targetType: TARGET_TYPE,
      beforeData: { discounts: pickRates(before) },
      afterData: { discounts: pickRates(after), diff },
      request,
    });
  }

  return NextResponse.json({ ...after, changed: Object.keys(diff).length > 0, diff });
});

function pickRates(d: DiscountsDto) {
  const { updatedAt: _ua, updatedBy: _ub, ...rates } = d;
  return rates;
}
