import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/guards";
import { isSuperAdmin } from "@/lib/rbac/roles";
import { getUserById, updateUserProfile, updateUserStatus, updateUserRole } from "@/lib/users/service";
import { validateUserProfile, isValidUserStatus } from "@/lib/users/validation";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";
import { db } from "@/lib/db";

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * GET /api/users/[id]
 * super_admin 可查看任意用户；普通用户只能查看自己
 */
export async function GET(request: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params;

  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const { user: currentUser } = auth;

  if (currentUser.id !== id && !isSuperAdmin(currentUser.role)) {
    return NextResponse.json({ error: "无权查看该用户信息" }, { status: 403 });
  }

  const user = await getUserById(id);
  if (!user) {
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }

  return NextResponse.json({ user });
}

/**
 * PATCH /api/users/[id]
 * 更新用户基础信息 / 状态
 * - 用户本人可更新自己的 name/nickname/avatar/phone
 * - super_admin 可额外更新 status/role
 */
export async function PATCH(request: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params;

  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const { user: currentUser } = auth;

  const isSelf = currentUser.id === id;
  const isAdmin = isSuperAdmin(currentUser.role);

  if (!isSelf && !isAdmin) {
    return NextResponse.json({ error: "无权修改该用户信息" }, { status: 403 });
  }

  const targetUser = await getUserById(id);
  if (!targetUser) {
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const profileUpdates: { name?: string; nickname?: string; avatar?: string; phone?: string } = {};
  let hasProfileUpdate = false;

  if (body.name !== undefined) {
    profileUpdates.name = String(body.name).trim();
    hasProfileUpdate = true;
  }
  if (body.nickname !== undefined) {
    profileUpdates.nickname = String(body.nickname).trim();
    hasProfileUpdate = true;
  }
  if (body.avatar !== undefined) {
    profileUpdates.avatar = String(body.avatar).trim();
    hasProfileUpdate = true;
  }
  if (body.phone !== undefined) {
    profileUpdates.phone = String(body.phone).trim();
    hasProfileUpdate = true;
  }

  if (hasProfileUpdate) {
    const validation = validateUserProfile(profileUpdates);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.errors.join("; ") },
        { status: 400 }
      );
    }
  }

  const beforeData: Record<string, unknown> = {};
  const afterData: Record<string, unknown> = {};

  if (hasProfileUpdate) {
    beforeData.name = targetUser.name;
    beforeData.nickname = targetUser.nickname;
    beforeData.phone = targetUser.phone;

    await updateUserProfile(id, profileUpdates);

    Object.assign(afterData, profileUpdates);
  }

  if (body.status !== undefined && isAdmin) {
    const newStatus = String(body.status);
    if (!isValidUserStatus(newStatus)) {
      return NextResponse.json({ error: "无效的用户状态" }, { status: 400 });
    }
    if (id === currentUser.id && newStatus !== "active") {
      return NextResponse.json(
        { error: "不能停用自己的账号" },
        { status: 400 }
      );
    }

    beforeData.status = targetUser.status;
    afterData.status = newStatus;

    await updateUserStatus(id, newStatus);
  } else if (body.status !== undefined && !isAdmin) {
    return NextResponse.json(
      { error: "仅管理员可修改用户状态" },
      { status: 403 }
    );
  }

  if (body.role !== undefined && isAdmin) {
    const validRoles = ["admin", "sales", "trade", "user"];
    const newRole = String(body.role);
    if (!validRoles.includes(newRole)) {
      return NextResponse.json(
        { error: `无效角色，可选: ${validRoles.join(", ")}` },
        { status: 400 }
      );
    }
    beforeData.role = targetUser.role;
    afterData.role = newRole;
    await updateUserRole(id, newRole);
  } else if (body.role !== undefined && !isAdmin) {
    return NextResponse.json(
      { error: "仅管理员可修改用户角色" },
      { status: 403 }
    );
  }

  // 老板开关"允许该销售修改客户信息" —— 仅 admin 可改
  if (body.canEditCustomers !== undefined) {
    if (!isAdmin) {
      return NextResponse.json(
        { error: "仅管理员可修改客户编辑权限" },
        { status: 403 },
      );
    }
    const nextValue = Boolean(body.canEditCustomers);
    beforeData.canEditCustomers = (targetUser as { canEditCustomers?: boolean }).canEditCustomers ?? true;
    afterData.canEditCustomers = nextValue;
    await db.user.update({ where: { id }, data: { canEditCustomers: nextValue } });
  }

  if (Object.keys(afterData).length === 0) {
    return NextResponse.json({ error: "没有可更新的字段" }, { status: 400 });
  }

  await logAudit({
    userId: currentUser.id,
    action: AUDIT_ACTIONS.UPDATE,
    targetType: AUDIT_TARGETS.USER,
    targetId: id,
    beforeData,
    afterData,
    request,
  });

  const updatedUser = await getUserById(id);
  return NextResponse.json({ user: updatedUser });
}
