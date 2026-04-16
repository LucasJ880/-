import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { createSession, setSessionCookie } from "@/lib/auth/session";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";
import { checkRateLimitAsync } from "@/lib/common/rate-limit";

const LOGIN_RATE_LIMIT = {
  name: "auth-login",
  windowMs: 60_000,
  maxRequests: 10,
} as const;

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = await checkRateLimitAsync(LOGIN_RATE_LIMIT, ip);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "请求过于频繁，请稍后再试" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }
  const { email, password } = body as {
    email?: string;
    password?: string;
  };

  if (!email || !password) {
    return NextResponse.json(
      { error: "请输入邮箱和密码" },
      { status: 400 }
    );
  }

  const user = await db.user.findUnique({ where: { email } });

  if (!user || !user.passwordHash) {
    return NextResponse.json(
      { error: "邮箱或密码错误" },
      { status: 401 }
    );
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return NextResponse.json(
      { error: "邮箱或密码错误" },
      { status: 401 }
    );
  }

  if (user.status !== "active") {
    return NextResponse.json({ error: "账号已停用" }, { status: 403 });
  }

  await db.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

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
    action: AUDIT_ACTIONS.LOGIN,
    targetType: AUDIT_TARGETS.USER,
    targetId: user.id,
    request,
  });

  return response;
}
