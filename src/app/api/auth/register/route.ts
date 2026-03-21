import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { createSession, setSessionCookie } from "@/lib/auth/session";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";
import { DEFAULT_ENVIRONMENTS } from "@/lib/common/constants";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { email, password, name } = body as {
    email?: string;
    password?: string;
    name?: string;
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

  const existing = await db.user.findUnique({ where: { email } });

  if (existing?.passwordHash) {
    return NextResponse.json({ error: "该邮箱已注册" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const now = new Date();
  const displayName = name || email.split("@")[0];

  let user;
  let isNewUser = false;

  if (existing && !existing.passwordHash) {
    user = await db.user.update({
      where: { id: existing.id },
      data: {
        passwordHash,
        name: name || existing.name,
        lastLoginAt: now,
      },
    });
  } else {
    user = await db.user.create({
      data: {
        email,
        passwordHash,
        name: displayName,
        role: "user",
        status: "active",
      },
    });
    isNewUser = true;
  }

  if (isNewUser) {
    try {
      await bootstrapNewUser(user.id, displayName);
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
 * 为新注册用户创建：
 * 1. 个人工作区（组织）
 * 2. 默认项目 + test / prod 环境
 * 3. 将用户设为 org_admin 和 project_admin
 */
async function bootstrapNewUser(userId: string, displayName: string) {
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
  });
}
