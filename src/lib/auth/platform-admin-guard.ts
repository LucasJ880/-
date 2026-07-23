/**
 * 平台管理员 API / 页面门禁
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  isPlatformAdmin,
  PLATFORM_ADMIN_ERROR_MESSAGE,
  PLATFORM_ADMIN_REQUIRED,
} from "@/lib/rbac/platform-admin";

const COOKIE_NAME = "qy_session";

export function platformAdminForbiddenResponse(): NextResponse {
  return NextResponse.json(
    {
      error: PLATFORM_ADMIN_ERROR_MESSAGE,
      code: PLATFORM_ADMIN_REQUIRED,
    },
    { status: 403 },
  );
}

/** 已拿到 user 时的快速拒绝 */
export function denyUnlessPlatformAdmin(user: {
  role: string;
}): NextResponse | null {
  if (!isPlatformAdmin(user)) return platformAdminForbiddenResponse();
  return null;
}

/** RSC / layout：非平台管理员 redirect（不依赖客户端 useEffect） */
export async function requirePlatformAdminPage(
  fallbackPath = "/",
): Promise<{ id: string; role: string }> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) redirect("/login");

  const payload = await verifySession(token);
  if (!payload?.sub) redirect("/login");

  const user = await db.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, role: true, status: true },
  });
  if (!user || user.status !== "active") redirect("/login");
  if (!isPlatformAdmin(user.role)) redirect(fallbackPath);
  return { id: user.id, role: user.role };
}

/** API requirePlatformAdmin 定义在 guards.ts，此处再导出避免循环依赖 */
export { requirePlatformAdmin } from "@/lib/auth/guards";
