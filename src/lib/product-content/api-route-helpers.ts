import { NextResponse } from "next/server";
import type { AuthUser } from "@/lib/auth";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";

export async function resolveProductContentOrg(
  user: AuthUser,
  orgId?: string | null,
) {
  return resolveRequestOrgIdForUser(user, orgId);
}

/** 将 service 层中文错误映射为 HTTP 响应 */
export function mapProductContentError(err: unknown): NextResponse | null {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("无权访问该组织")) {
    return NextResponse.json({ error: msg }, { status: 403 });
  }
  if (msg.includes("不存在")) {
    return NextResponse.json({ error: msg }, { status: 404 });
  }
  if (
    msg.includes("不允许") ||
    msg.includes("无法") ||
    msg.includes("缺少") ||
    msg.includes("尚未") ||
    msg.includes("请") ||
    msg.includes("已处理") ||
    msg.includes("待")
  ) {
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  return null;
}

export async function withProductContentHandler<T>(
  fn: () => Promise<T>,
): Promise<NextResponse | T> {
  try {
    return await fn();
  } catch (err) {
    const mapped = mapProductContentError(err);
    if (mapped) return mapped;
    throw err;
  }
}
