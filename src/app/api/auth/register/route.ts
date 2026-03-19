import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { createSession, setSessionCookie } from "@/lib/auth/session";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";

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

  let user;
  if (existing && !existing.passwordHash) {
    // 已有种子用户但尚未设置密码 → 升级为真实账号，保留原有数据
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
        name: name || email.split("@")[0],
        role: "user",
        status: "active",
      },
    });
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
