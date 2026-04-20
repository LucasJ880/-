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
export const GET = withAuth(async (_req, _ctx, user) => {
  const dto = await loadDiscountsDto({ isAdmin: isAdmin(user.role) });
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

  // 额外：depositOverrideCode（字符串）由管理员单独维护，不走 validateDiscountsInput
  // 空字符串视为"清空"
  let codePatch: { depositOverrideCode: string | null } | undefined;
  if (Object.prototype.hasOwnProperty.call(body, "depositOverrideCode")) {
    const raw = body.depositOverrideCode;
    if (raw === null || (typeof raw === "string" && raw.trim() === "")) {
      codePatch = { depositOverrideCode: null };
    } else if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (trimmed.length < 3 || trimmed.length > 64) {
        return NextResponse.json(
          { error: "定金解锁码长度需为 3~64 个字符" },
          { status: 400 },
        );
      }
      codePatch = { depositOverrideCode: trimmed };
    } else {
      return NextResponse.json({ error: "depositOverrideCode 必须是字符串或 null" }, { status: 400 });
    }
  }

  const before = await loadDiscountsDto({ isAdmin: true });

  const updated = await db.quoteDiscountSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", ...parsed.value, ...codePatch, updatedBy: user.id },
    update: { ...parsed.value, ...codePatch, updatedBy: user.id },
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
    depositWarnPct: updated.depositWarnPct,
    depositMinPct: updated.depositMinPct,
    depositOverrideCode: updated.depositOverrideCode,
    hasDepositOverrideCode: !!updated.depositOverrideCode,
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
  // code 变更只记录"是否变化"，不落明文到审计
  const codeChanged =
    (before.depositOverrideCode ?? null) !== (after.depositOverrideCode ?? null);

  if (Object.keys(diff).length > 0 || codeChanged) {
    await logAudit({
      userId: user.id,
      action: "update",
      targetType: TARGET_TYPE,
      beforeData: { discounts: pickRates(before) },
      afterData: {
        discounts: pickRates(after),
        diff,
        ...(codeChanged ? { depositOverrideCodeChanged: true } : {}),
      },
      request,
    });
  }

  return NextResponse.json({ ...after, changed: Object.keys(diff).length > 0 || codeChanged, diff });
});

function pickRates(d: DiscountsDto) {
  const { updatedAt: _ua, updatedBy: _ub, depositOverrideCode: _code, ...rates } = d;
  return rates;
}
