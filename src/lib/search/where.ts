/**
 * 全局搜索（GET /api/search）的查询条件，纯函数。
 *
 * 可见范围与关键词条件一律用 AND 组合：两边都可能带 OR，若用对象展开再写 OR 键，后者会覆盖前者，
 * 范围条件被整段丢掉（修复前任务搜索即如此：任何登录用户都能搜到其他企业的任务）。
 *
 * projectWhere 为 buildProjectVisibilityWhere 的结果；null 表示平台 super_admin（不加范围）。
 */

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
