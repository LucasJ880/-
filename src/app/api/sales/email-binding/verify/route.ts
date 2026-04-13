import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { verifySMTP } from "@/lib/email/sender";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

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
}
