import { db } from "@/lib/db";
import type { PaginatedResult, PaginationParams } from "@/lib/common/types";
import { normalizePagination } from "@/lib/common/validation";

// ============================================================
// Users 服务层
// ============================================================

export interface UserListItem {
  id: string;
  email: string;
  name: string;
  nickname: string | null;
  avatar: string | null;
  role: string;
  status: string;
  authProvider: string;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface UserDetail extends UserListItem {
  phone: string | null;
  updatedAt: Date;
  _count: {
    orgMemberships: number;
    projectMemberships: number;
  };
}

const USER_LIST_SELECT = {
  id: true,
  email: true,
  name: true,
  nickname: true,
  avatar: true,
  role: true,
  status: true,
  authProvider: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

const USER_DETAIL_SELECT = {
  ...USER_LIST_SELECT,
  phone: true,
  updatedAt: true,
  canEditCustomers: true,
  _count: {
    select: {
      orgMemberships: true,
      projectMemberships: true,
    },
  },
} as const;

/** 获取用户列表（仅平台管理员使用） */
export async function listUsers(
  params: PaginationParams & { status?: string; search?: string }
): Promise<PaginatedResult<UserListItem>> {
  const { page, pageSize, skip } = normalizePagination(params.page, params.pageSize);

  const where: Record<string, unknown> = {};
  if (params.status) where.status = params.status;
  if (params.search) {
    where.OR = [
      { email: { contains: params.search, mode: "insensitive" } },
      { name: { contains: params.search, mode: "insensitive" } },
      { nickname: { contains: params.search, mode: "insensitive" } },
    ];
  }

  const [data, total] = await Promise.all([
    db.user.findMany({
      where,
      select: USER_LIST_SELECT,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
    }),
    db.user.count({ where }),
  ]);

  return {
    data: data as UserListItem[],
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

/** 获取用户详情 */
export async function getUserById(userId: string): Promise<UserDetail | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: USER_DETAIL_SELECT,
  });
  return user as UserDetail | null;
}

/** 通过 email 查找用户 */
export async function getUserByEmail(email: string) {
  return db.user.findUnique({ where: { email } });
}

/** 更新用户最后登录时间 */
export async function updateLastLogin(userId: string): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { lastLoginAt: new Date() },
  });
}

/** 更新用户状态 */
export async function updateUserStatus(
  userId: string,
  status: string
): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { status },
  });
}

/** 更新用户平台角色 */
export async function updateUserRole(
  userId: string,
  role: string
): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { role },
  });
}

/** 更新用户资料 */
export async function updateUserProfile(
  userId: string,
  data: { name?: string; nickname?: string; avatar?: string; phone?: string }
): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data,
  });
}
