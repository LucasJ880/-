import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { createSession, setSessionCookie } from "@/lib/auth/session";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";
import { DEFAULT_ENVIRONMENTS } from "@/lib/common/constants";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }
  const { email, password, name, inviteCode } = body as {
    email?: string;
    password?: string;
    name?: string;
    inviteCode?: string;
  };

  if (!email || !password) {
    return NextResponse.json({ error: "邮箱和密码为必填项" }, { status: 400 });
  }

  if (password.length < 6) {
    return NextResponse.json(
      { error: "密码长度至少 6 位" },
      { status: 400 }
    );
  }

  if (!inviteCode || !inviteCode.trim()) {
    return NextResponse.json({ error: "邀请码为必填项" }, { status: 400 });
  }

  const invite = await db.inviteCode.findUnique({
    where: { code: inviteCode.trim().toUpperCase() },
  });

  if (!invite || !invite.isActive) {
    return NextResponse.json({ error: "邀请码无效或已停用" }, { status: 400 });
  }

  if (invite.maxUses !== null && invite.usedCount >= invite.maxUses) {
    return NextResponse.json({ error: "邀请码已达使用上限" }, { status: 400 });
  }

  if (invite.expiresAt && new Date() > invite.expiresAt) {
    return NextResponse.json({ error: "邀请码已过期" }, { status: 400 });
  }

  const assignedRole = invite.role;

  const existing = await db.user.findUnique({ where: { email } });

  if (existing?.passwordHash) {
    return NextResponse.json({ error: "该邮箱已注册" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const displayName = name || email.split("@")[0];

  let user;
  let isNewUser = false;

  if (existing && !existing.passwordHash) {
    user = await db.user.update({
      where: { id: existing.id },
      data: {
        passwordHash,
        name: name || existing.name,
        role: assignedRole,
        inviteCodeId: invite.id,
        lastLoginAt: new Date(),
      },
    });
  } else {
    user = await db.user.create({
      data: {
        email,
        passwordHash,
        name: displayName,
        role: assignedRole,
        inviteCodeId: invite.id,
        status: "active",
      },
    });
    isNewUser = true;
  }

  await db.inviteCode.update({
    where: { id: invite.id },
    data: { usedCount: { increment: 1 } },
  });

  if (isNewUser) {
    try {
      await bootstrapNewUser(user.id, displayName, assignedRole);
    } catch (err) {
      console.error("[register] bootstrap failed:", err);
    }
  }

  const token = await createSession({
    sub: user.id,
    email: user.email,
    role: user.role,
  });

  const response = NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
  });

  setSessionCookie(response, token);

  await logAudit({
    userId: user.id,
    action: existing ? AUDIT_ACTIONS.LOGIN : AUDIT_ACTIONS.CREATE,
    targetType: AUDIT_TARGETS.USER,
    targetId: user.id,
    request,
  });

  return response;
}

/**
 * 根据角色 bootstrap 不同的初始数据
 * - admin/user: 创建组织 + 默认项目 + 环境
 * - sales/trade: 仅创建组织（不需要项目管理模块）
 */
async function bootstrapNewUser(userId: string, displayName: string, role: string) {
  const orgCode = `personal-${userId.slice(0, 8)}`;

  await db.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        name: `${displayName}的工作区`,
        code: orgCode,
        ownerId: userId,
        planType: "free",
      },
    });

    await tx.organizationMember.create({
      data: {
        orgId: org.id,
        userId,
        role: "org_admin",
        status: "active",
      },
    });

    if (role === "admin" || role === "user") {
      const project = await tx.project.create({
        data: {
          orgId: org.id,
          name: "我的第一个项目",
          description: "这是系统自动创建的默认项目，你可以在这里管理 Prompt、知识库和环境配置。",
          ownerId: userId,
          status: "active",
        },
      });

      await tx.projectMember.create({
        data: {
          projectId: project.id,
          userId,
          role: "project_admin",
          status: "active",
        },
      });

      for (const env of DEFAULT_ENVIRONMENTS) {
        await tx.environment.create({
          data: {
            projectId: project.id,
            name: env.name,
            code: env.code,
          },
        });
      }
    }
  });
}
