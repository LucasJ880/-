import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit/logger";
import {
  loadDiscountsDto,
  saveDiscountsForOrg,
  validateDiscountsInput,
  validateCostRatesInput,
  DTO_NUMERIC_KEYS,
  type DiscountsDto,
  type DiscountSavePatch,
} from "@/lib/blinds/discount-settings";
import { requireTenantContext } from "@/lib/tenancy";
import { canManageQuoteDiscountSettings } from "@/lib/blinds/discount-permissions";

const TARGET_TYPE = "quote_discount_settings";

function parseUnlockPlain(
  body: Record<string, unknown>,
  key: string,
):
  | { ok: true; value?: string | null }
  | { ok: false; error: string } {
  if (!Object.prototype.hasOwnProperty.call(body, key)) {
    return { ok: true };
  }
  const raw = body[key];
  if (raw === null || (typeof raw === "string" && raw.trim() === "")) {
    return { ok: true, value: null };
  }
  if (typeof raw !== "string") {
    return { ok: false, error: `${key} 必须是字符串或 null` };
  }
  const trimmed = raw.trim();
  if (trimmed.length < 3 || trimmed.length > 64) {
    return { ok: false, error: "解锁码长度需为 3~64 个字符" };
  }
  return { ok: true, value: trimmed };
}

/**
 * GET /api/sales/quote-settings/discounts
 * 永不返回解锁码明文或哈希
 */
export async function GET(request: Request) {
  const tenant = await requireTenantContext(request as import("next/server").NextRequest);
  if (tenant instanceof NextResponse) return tenant;

  const dto = await loadDiscountsDto(tenant.orgId);
  return NextResponse.json({
    ...dto,
    canEdit: canManageQuoteDiscountSettings(tenant.orgRole),
  });
}

/**
 * PUT /api/sales/quote-settings/discounts
 * body 可含 depositOverrideCode / lineDiscountUnlockCode（明文一次提交，落库为哈希）
 */
export async function PUT(request: Request) {
  const tenant = await requireTenantContext(request as import("next/server").NextRequest);
  if (tenant instanceof NextResponse) return tenant;

  if (!canManageQuoteDiscountSettings(tenant.orgRole)) {
    return NextResponse.json({ error: "仅企业负责人可修改折扣率" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  delete body.orgId;

  const parsed = validateDiscountsInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const depositParsed = parseUnlockPlain(body, "depositOverrideCode");
  if (!depositParsed.ok) {
    return NextResponse.json({ error: depositParsed.error }, { status: 400 });
  }
  const lineParsed = parseUnlockPlain(body, "lineDiscountUnlockCode");
  if (!lineParsed.ok) {
    return NextResponse.json({ error: lineParsed.error }, { status: 400 });
  }

  const patch: DiscountSavePatch = { ...parsed.value };
  if (body.costRates !== undefined) {
    const costParsed = validateCostRatesInput(body.costRates);
    if (!costParsed.ok) {
      return NextResponse.json({ error: costParsed.error }, { status: 400 });
    }
    patch.costRates = costParsed.value;
  }
  if (depositParsed.value !== undefined) {
    patch.depositOverrideCodePlain = depositParsed.value;
  }
  if (lineParsed.value !== undefined) {
    patch.lineDiscountUnlockCodePlain = lineParsed.value;
  }

  const before = await loadDiscountsDto(tenant.orgId);
  const after = await saveDiscountsForOrg({
    orgId: tenant.orgId,
    userId: tenant.userId,
    patch,
  });

  const diff: Record<string, { from: number; to: number }> = {};
  for (const k of DTO_NUMERIC_KEYS) {
    if (before[k] !== after[k]) {
      diff[k] = { from: before[k], to: after[k] };
    }
  }
  const costRatesChanged =
    JSON.stringify(before.costRates) !== JSON.stringify(after.costRates);
  const depositCodeChanged =
    before.hasDepositOverrideCode !== after.hasDepositOverrideCode ||
    depositParsed.value !== undefined;
  const lineCodeChanged =
    before.hasLineDiscountUnlockCode !== after.hasLineDiscountUnlockCode ||
    lineParsed.value !== undefined;

  if (Object.keys(diff).length > 0 || depositCodeChanged || lineCodeChanged || costRatesChanged) {
    await logAudit({
      userId: tenant.userId,
      orgId: tenant.orgId,
      action: "update",
      targetType: TARGET_TYPE,
      beforeData: {
        discounts: pickRates(before),
        version: before.version,
        hasDepositOverrideCode: before.hasDepositOverrideCode,
        hasLineDiscountUnlockCode: before.hasLineDiscountUnlockCode,
      },
      afterData: {
        discounts: pickRates(after),
        version: after.version,
        diff,
        ...(costRatesChanged ? { costRates: after.costRates } : {}),
        hasDepositOverrideCode: after.hasDepositOverrideCode,
        hasLineDiscountUnlockCode: after.hasLineDiscountUnlockCode,
        ...(depositCodeChanged ? { depositUnlockCodeChanged: true } : {}),
        ...(lineCodeChanged ? { lineDiscountUnlockCodeChanged: true } : {}),
      },
      request: request as import("next/server").NextRequest,
    });
  }

  return NextResponse.json({
    ...after,
    canEdit: true,
    changed:
      Object.keys(diff).length > 0 || depositCodeChanged || lineCodeChanged || costRatesChanged,
    diff,
  });
}

function pickRates(d: DiscountsDto) {
  const { updatedAt: _ua, updatedBy: _ub, ...rates } = d;
  return rates;
}
