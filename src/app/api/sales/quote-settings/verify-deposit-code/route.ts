/**
 * POST /api/sales/quote-settings/verify-deposit-code
 *
 * 销售在 Order Form Part B 低于定金最低阈值时，输入老板设置的解锁码。
 * 后端校验成功即返回 { ok: true }，前端把"本单已解锁"标记加到保存请求里。
 *
 * 设计：
 * - 明文比对（MVP；code 本身已写在 QuoteDiscountSettings，仅 admin 可读/写）
 * - 失败不泄露 code 是否存在，统一返回"校验失败"
 * - 命中/失败都写最小审计日志
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";

export const POST = withAuth(async (request, _ctx, user) => {
  const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code.trim() : "";

  if (!code) {
    return NextResponse.json({ ok: false, error: "请输入解锁码" }, { status: 400 });
  }

  const row = await db.quoteDiscountSettings.findUnique({
    where: { id: "singleton" },
    select: { depositOverrideCode: true },
  });

  const configured = row?.depositOverrideCode ?? "";
  const ok = configured.length > 0 && configured === code;

  await logAudit({
    userId: user.id,
    action: ok ? "deposit_code_verified" : "deposit_code_failed",
    targetType: "quote_discount_settings",
    request,
  }).catch(() => { /* 审计失败不影响主流程 */ });

  if (!ok) {
    return NextResponse.json({ ok: false, error: "解锁码不正确" }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
});
