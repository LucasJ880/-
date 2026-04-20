import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getSessionFromRequest, verifySession } from "./session";

// ============================================================
// 认证抽象层 — 真实 session 实现
// ============================================================

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  nickname: string | null;
  avatar: string | null;
  role: string;
  status: string;
  /** admin 可开关的"是否允许修改客户信息"权限；admin 视为 true */
  canEditCustomers: boolean;
}

/**
 * 从请求中获取当前登录用户
 *
 * 1. 从 HttpOnly cookie 中读取 JWT
 * 2. 验证签名与过期时间
 * 3. 根据 JWT 中的 userId 查询数据库获取最新用户信息
 * 4. 校验用户状态
 */
export async function getCurrentUser(
  request?: NextRequest
): Promise<AuthUser | null> {
  if (!request) return null;

  const token = getSessionFromRequest(request);
  if (!token) return null;

  const payload = await verifySession(token);
  if (!payload?.sub) return null;

  try {
    const user = await db.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user || user.status !== "active") return null;

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      nickname: user.nickname,
      avatar: user.avatar,
      role: user.role,
      status: user.status,
      canEditCustomers: user.canEditCustomers ?? true,
    };
  } catch (err) {
    console.error("[auth] DB lookup failed for user", payload.sub, err);
    throw err;
  }
}

/**
 * 获取用户在指定组织中的成员信息
 */
export async function getOrgMembership(userId: string, orgId: string) {
  return db.organizationMember.findUnique({
    where: { orgId_userId: { orgId, userId } },
  });
}

/**
 * 获取用户在指定项目中的成员信息
 */
export async function getProjectMembership(
  userId: string,
  projectId: string
) {
  return db.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
  });
}
