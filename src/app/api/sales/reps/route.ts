import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import {
  resolveSalesOrgIdForRequest,
  resolveSalesScope,
} from "@/lib/sales/org-context";

/**
 * GET /api/sales/reps
 *
 * 返回"在当前组织有过客户记录"的销售用户列表（org_admin / admin 专用）——
 * 用于客户筛选 / 分析页的下拉选择。
 */
export const GET = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveSalesOrgIdForRequest(request, user);
  if (!orgRes.ok) return orgRes.response;
  const orgId = orgRes.orgId;
  // Security-1：需组织级客户读权限（销售经理 / 企业负责人），不再用 org_admin
  const scope = await resolveSalesScope(user, orgId, "sales.customer.read");
  if (!scope.allowed || scope.ownOnly) {
    return NextResponse.json(
      { error: "需要组织级销售数据权限", code: scope.reasonCode || "SCOPE_NOT_ORG" },
      { status: 403 },
    );
  }

  // 拉当前组织内"有客户的"用户，按客户数降序
  const groups = await db.salesCustomer.groupBy({
    by: ["createdById"],
    where: { archivedAt: null, orgId },
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
