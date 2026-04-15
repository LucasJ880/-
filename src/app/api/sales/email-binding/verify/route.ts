import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { verifySMTP } from "@/lib/email/sender";

export const POST = withAuth(async (_request, _ctx, user) => {
  const binding = await db.emailBinding.findUnique({ where: { userId: user.id } });
  if (!binding) {
    return NextResponse.json({ error: "请先保存邮箱配置" }, { status: 400 });
  }

  const result = await verifySMTP({
    smtpHost: binding.smtpHost || "",
    smtpPort: binding.smtpPort || 587,
    smtpUser: binding.smtpUser || "",
    smtpPass: binding.smtpPass || "",
    useTls: binding.useTls,
  });

  if (result.ok) {
    await db.emailBinding.update({
      where: { userId: user.id },
      data: { verified: true, verifiedAt: new Date(), lastError: null },
    });
    return NextResponse.json({ verified: true });
  }

  await db.emailBinding.update({
    where: { userId: user.id },
    data: { verified: false, lastError: result.error },
  });

  return NextResponse.json({ verified: false, error: result.error });
});
