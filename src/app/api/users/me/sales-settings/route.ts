import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";

/**
 * GET  /api/users/me/sales-settings
 * PUT  /api/users/me/sales-settings  { salesRepInitials: string }
 *
 * 存储销售个人配置，目前只含 Sales Rep 代号。
 * 代号规则：1–4 个字符，建议大写字母/数字，用于报价单编号自动拼接。
 */

export const GET = withAuth(async (_req, _ctx, user) => {
  const u = await db.user.findUnique({
    where: { id: user.id },
    select: { salesRepInitials: true },
  });
  return NextResponse.json({
    salesRepInitials: u?.salesRepInitials ?? "",
  });
});

export const PUT = withAuth(async (req, _ctx, user) => {
  const body = (await req.json().catch(() => null)) as
    | { salesRepInitials?: unknown }
    | null;
  const raw =
    typeof body?.salesRepInitials === "string" ? body.salesRepInitials : "";
  const initials = raw.trim().toUpperCase().slice(0, 4);

  if (initials && !/^[A-Z0-9]{1,4}$/.test(initials)) {
    return NextResponse.json(
      { error: "代号只能是 1-4 个字母或数字" },
      { status: 400 },
    );
  }

  await db.user.update({
    where: { id: user.id },
    data: { salesRepInitials: initials || null },
  });

  return NextResponse.json({ salesRepInitials: initials });
});
