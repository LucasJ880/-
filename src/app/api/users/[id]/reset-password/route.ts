/**
 * POST /api/users/[id]/reset-password
 * 平台管理员为任意用户设置新密码（看不到、也不返回旧密码）。
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { isSuperAdmin } from "@/lib/rbac/roles";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";
import {
  setUserPasswordHash,
  validateNewPassword,
} from "@/lib/users/password";

export const POST = withAuth<{ id: string }>(async (request, ctx, actor) => {
  if (!isSuperAdmin(actor.role)) {
    return NextResponse.json({ error: "仅平台管理员可重置他人密码" }, { status: 403 });
  }

  const { id } = await ctx.params;
  if (id === actor.id) {
    return NextResponse.json(
      { error: "请到「设置 → 账号与企业」修改自己的密码" },
      { status: 400 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const newPassword =
    typeof body.newPassword === "string" ? body.newPassword : "";
  const confirmPassword =
    typeof body.confirmPassword === "string" ? body.confirmPassword : newPassword;

  const validationError = validateNewPassword(newPassword);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }
  if (newPassword !== confirmPassword) {
    return NextResponse.json({ error: "两次输入的新密码不一致" }, { status: 400 });
  }

  const target = await db.user.findUnique({
    where: { id },
    select: { id: true, email: true, status: true, role: true },
  });
  if (!target || target.status === "deleted") {
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }

  await setUserPasswordHash(id, newPassword);

  await logAudit({
    userId: actor.id,
    action: AUDIT_ACTIONS.PASSWORD_RESET,
    targetType: AUDIT_TARGETS.USER,
    targetId: id,
    afterData: { resetBy: actor.id, targetEmail: target.email },
    request,
  });

  return NextResponse.json({
    ok: true,
    message: `已为 ${target.email} 设置新密码（请私下告知对方，系统不会保存明文）`,
  });
});
