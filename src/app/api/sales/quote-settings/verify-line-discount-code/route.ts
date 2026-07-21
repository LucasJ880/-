/**
 * POST /api/sales/quote-settings/verify-line-discount-code
 * 与当前企业 lineDiscountUnlockCodeHash 做 bcrypt 比对；永不回传输入码或哈希。
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import { requireTenantContext } from "@/lib/tenancy";
import {
  unlockCodeAuditSafe,
  verifyUnlockCode,
} from "@/lib/blinds/unlock-code";

export async function POST(request: Request) {
  const tenant = await requireTenantContext(request as import("next/server").NextRequest);
  if (tenant instanceof NextResponse) return tenant;

  const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code.trim() : "";

  if (!code) {
    return NextResponse.json({ ok: false, error: "请输入解锁码" }, { status: 400 });
  }

  const row = await db.quoteDiscountSettings.findUnique({
    where: { orgId: tenant.orgId },
    select: { lineDiscountUnlockCodeHash: true, version: true },
  });

  const hash = row?.lineDiscountUnlockCodeHash ?? null;
  const configured = !!(hash && hash.length > 0);
  const matched = configured ? await verifyUnlockCode(code, hash) : false;

  await logAudit({
    userId: tenant.userId,
    orgId: tenant.orgId,
    action: matched ? "line_discount_code_verified" : "line_discount_code_failed",
    targetType: "quote_discount_settings",
    afterData: unlockCodeAuditSafe({
      configured,
      matched,
      orgId: tenant.orgId,
    }),
    request: request as import("next/server").NextRequest,
  }).catch(() => {});

  if (!configured) {
    return NextResponse.json(
      {
        ok: false,
        error: "本企业尚未配置行折扣解锁码，请联系企业管理员在折扣设置中配置",
      },
      { status: 403 },
    );
  }

  if (!matched) {
    return NextResponse.json({ ok: false, error: "解锁码不正确" }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
