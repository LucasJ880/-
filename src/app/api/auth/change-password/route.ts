/**
 * POST /api/auth/change-password
 * 当前登录用户修改自己的密码（需验证旧密码；无密码账号可首次设置）。
 * 永不回传明文或哈希。
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";
import {
  setUserPasswordHash,
  validateNewPassword,
  verifyPassword,
} from "@/lib/users/password";

export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json().catch(() => ({}));
  const currentPassword =
    typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword =
    typeof body.newPassword === "string" ? body.newPassword : "";
  const confirmPassword =
    typeof body.confirmPassword === "string" ? body.confirmPassword : "";

  const validationError = validateNewPassword(newPassword);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }
  if (newPassword !== confirmPassword) {
    return NextResponse.json({ error: "两次输入的新密码不一致" }, { status: 400 });
  }

  const row = await db.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true, authProvider: true },
  });
  if (!row) {
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }

  if (row.passwordHash) {
    if (!currentPassword) {
      return NextResponse.json({ error: "请输入当前密码" }, { status: 400 });
    }
    const ok = await verifyPassword(currentPassword, row.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: "当前密码不正确" }, { status: 400 });
    }
    const same = await verifyPassword(newPassword, row.passwordHash);
    if (same) {
      return NextResponse.json(
        { error: "新密码不能与当前密码相同" },
        { status: 400 },
      );
    }
  }

  await setUserPasswordHash(user.id, newPassword);

  await logAudit({
    userId: user.id,
    action: AUDIT_ACTIONS.PASSWORD_CHANGE,
    targetType: AUDIT_TARGETS.USER,
    targetId: user.id,
    afterData: { changed: true, hadPassword: Boolean(row.passwordHash) },
    request,
  });

  return NextResponse.json({
    ok: true,
    message: row.passwordHash ? "密码已更新" : "密码已设置",
  });
});
