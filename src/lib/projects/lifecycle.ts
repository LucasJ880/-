/**
 * 项目生命周期过滤（与 RBAC / intake 可见性分离）
 *
 * Active View：status=active 且 abandonedAt=null
 * 历史/归档/放弃：通过明确 lifecycle 参数查询，不改 Prisma schema
 */

export type ProjectLifecycleFilter =
  | "active"
  | "completed"
  | "archived"
  | "abandoned"
  | "all";

export const PROJECT_LIFECYCLE_FILTERS: ProjectLifecycleFilter[] = [
  "active",
  "completed",
  "archived",
  "abandoned",
  "all",
];

export function isProjectLifecycleFilter(
  value: string | null | undefined
): value is ProjectLifecycleFilter {
  return (
    value === "active" ||
    value === "completed" ||
    value === "archived" ||
    value === "abandoned" ||
    value === "all"
  );
}

/** Active View：仍需行动的项目 */
export function isActionableProject(project: {
  status: string;
  abandonedAt?: Date | string | null;
}): boolean {
  return project.status === "active" && project.abandonedAt == null;
}

/**
 * Prisma where 片段：仅生命周期，不含 RBAC。
 * `all` 返回 {}（不加约束）。
 */
export function buildProjectLifecycleWhere(
  filter: ProjectLifecycleFilter = "active"
): Record<string, unknown> {
  switch (filter) {
    case "active":
      return { status: "active", abandonedAt: null };
    case "completed":
      return { status: "completed" };
    case "archived":
      return { status: "archived" };
    case "abandoned":
      return {
        OR: [{ status: "abandoned" }, { abandonedAt: { not: null } }],
      };
    case "all":
      return {};
    default:
      return { status: "active", abandonedAt: null };
  }
}

export function projectLifecycleLabel(status: string, abandonedAt?: Date | string | null): string {
  if (status === "abandoned" || abandonedAt != null) return "已放弃";
  if (status === "completed") return "已完成";
  if (status === "archived") return "已归档";
  if (status === "active") return "进行中";
  return status || "未知";
}
