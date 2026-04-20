import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { isSuperAdmin } from "@/lib/rbac/roles";

/**
 * GET /api/sales/reps
 *
 * 返回"有过客户记录"的销售用户列表（admin 专用）——
 * 用于客户筛选 / 分析页的下拉选择。
 */
export const GET = withAuth(async (_req, _ctx, user) => {
  if (!isSuperAdmin(user.role)) {
    return NextResponse.json({ error: "仅管理员可访问" }, { status: 403 });
  }

  // 拉所有"有客户的"用户，按客户数降序
  const groups = await db.salesCustomer.groupBy({
    by: ["createdById"],
    where: { archivedAt: null },
    _count: { _all: true },
    orderBy: { _count: { createdById: "desc" } },
  });

  const ids = groups.map((g) => g.createdById);
  if (ids.length === 0) {
    return NextResponse.json({ reps: [] });
  }

  const users = await db.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, email: true, role: true },
  });
  const userMap = new Map(users.map((u) => [u.id, u]));

  const reps = groups
    .map((g) => {
      const u = userMap.get(g.createdById);
      if (!u) return null;
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        customerCount: g._count._all,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return NextResponse.json({ reps });
});
