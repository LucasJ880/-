/**
 * GET /api/agent-core/tools
 *
 * 列出当前登录用户可调用的 Agent Core 工具。
 * query: ?domain=trade — 按域过滤（仍需在用户可见范围内）
 *
 * PR1：按调用者的平台角色过滤（sales 看不到 trade/cockpit 等）。
 * PERM-4c4：岗位模式企业取岗位派生平台角色。
 * VIS-1c：按该企业模块过滤（与执行期同一映射、同一份 modulesJson），营销工具另要「品牌增长」入口。
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { registry } from "@/lib/agent-core";
import type { ToolDomain } from "@/lib/agent-core";
import { resolvePreferredOrgId } from "@/lib/organizations/active-org";
import { resolveEffectivePlatformRole } from "@/lib/rbac/effective-platform-role";
import { db } from "@/lib/db";
import { loadToolEntryGate } from "@/lib/agent-core/entry-gate-server";

export const GET = withAuth(async (request, _ctx, user) => {
  const domain = request.nextUrl.searchParams.get("domain") as ToolDomain | null;
  const { orgId } = await resolvePreferredOrgId(user.id, user.role);
  const [role, org, entryGate] = await Promise.all([
    resolveEffectivePlatformRole({ userId: user.id, orgId, platformRole: user.role }),
    orgId ? db.organization.findUnique({ where: { id: orgId }, select: { modulesJson: true } }) : null,
    loadToolEntryGate(user, orgId),
  ]);
  const tools = registry.list({
    domains: domain ? [domain] : undefined,
    role,
    modulesJson: org?.modulesJson ?? undefined,
    entryGate,
  });

  return NextResponse.json({
    total: tools.length,
    tools: tools.map((t) => ({
      name: t.name,
      domain: t.domain,
      description: t.description,
      risk: t.risk ?? "l0_read",
      allowRoles: t.allowRoles ?? ["admin"],
      parameters: t.parameters,
    })),
  });
});
