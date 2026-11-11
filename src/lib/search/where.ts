/**
 * 全局搜索（GET /api/search）的查询条件，纯函数。
 *
 * 可见范围与关键词条件一律用 AND 组合：两边都可能带 OR，若用对象展开再写 OR 键，后者会覆盖前者，
 * 范围条件被整段丢掉（修复前任务搜索即如此：任何登录用户都能搜到其他企业的任务）。
 *
 * projectWhere 为 buildProjectVisibilityWhere 的结果；null 表示平台 super_admin（不加范围）。
 *
 * VIS-1c（spec search/global-search「项目结果的范围」）：项目结果另收窄为本人打得开的项目——
 * 只在项目详情页对其放行时搜，且只搜详情页读判定（requireProjectReadAccess）会放行的项目。
 */

import { canOpenHref } from "@/lib/navigation/landing";
import type { RouteGateContext } from "@/lib/navigation/filter-context";

export type SearchWhere = Record<string, unknown>;

function keywordWhere(fields: readonly string[], q: string): SearchWhere {
  return { OR: fields.map((f) => ({ [f]: { contains: q } })) };
}

/** 任务：可见项目里的任务，或本人创建的无项目任务；再按标题 / 描述匹配关键词 */
export function buildTaskSearchWhere(projectWhere: SearchWhere | null, userId: string, q: string): SearchWhere {
  const keyword = keywordWhere(["title", "description"], q);
  if (!projectWhere) return keyword;
  return {
    AND: [{ OR: [{ project: projectWhere }, { projectId: null, creatorId: userId }] }, keyword],
  };
}

/** 项目：可见项目里按名称 / 描述匹配关键词 */
export function buildProjectSearchWhere(projectWhere: SearchWhere | null, q: string): SearchWhere {
  const keyword = keywordWhere(["name", "description"], q);
  if (!projectWhere) return keyword;
  return { AND: [projectWhere, keyword] };
}

/** 项目详情页的探测路径（动态段用占位 id） */
export const PROJECT_DETAIL_PROBE = "/projects/_";

/** 是否搜项目：项目详情页经路由门对其放行（平台 super_admin 一律放行，判定输入缺失一律不放行） */
export function shouldSearchProjects(ctx: RouteGateContext | null): boolean {
  return canOpenHref(PROJECT_DETAIL_PROBE, ctx);
}

/**
 * 项目结果的读范围，与详情页读判定同口径：已分发，且本人负责（不限企业）、
 * 本人在该项目所属企业为 org_admin / org_owner（adminOrgIds），或本人是项目 active 成员。
 */
export function buildReadableProjectWhere(userId: string, adminOrgIds: readonly string[]): SearchWhere {
  return {
    intakeStatus: "dispatched",
    OR: [
      { ownerId: userId },
      ...(adminOrgIds.length ? [{ orgId: { in: [...adminOrgIds] } }] : []),
      { members: { some: { userId, status: "active" } } },
    ],
  };
}
