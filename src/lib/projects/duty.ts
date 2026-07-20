/**
 * 项目业务身份（面向用户）
 * - owner / 主负责人：各节点全量跟进
 * - purchaser / 主采购人：各节点全量跟进
 * - participant / 参与者：知情权，主要关注截标日；开标日全员通知
 *
 * 与 RBAC 的 project_admin/operator/viewer 解耦：后者管权限，本字段管职责。
 */

export const PROJECT_DUTIES = ["owner", "purchaser", "participant"] as const;
export type ProjectDuty = (typeof PROJECT_DUTIES)[number];

export const PROJECT_DUTY_LABELS: Record<ProjectDuty, string> = {
  owner: "主负责人",
  purchaser: "主采购人",
  participant: "参与者",
};

export function isValidProjectDuty(v: string): v is ProjectDuty {
  return (PROJECT_DUTIES as readonly string[]).includes(v);
}

export function resolveProjectDuty(
  userId: string,
  ownerId: string,
  purchaserId: string | null | undefined
): ProjectDuty {
  if (userId === ownerId) return "owner";
  if (purchaserId && userId === purchaserId) return "purchaser";
  return "participant";
}

/** 主负责人 / 主采购人：需把控关键节点 */
export function isProjectController(
  userId: string,
  ownerId: string,
  purchaserId: string | null | undefined
): boolean {
  const duty = resolveProjectDuty(userId, ownerId, purchaserId);
  return duty === "owner" || duty === "purchaser";
}

export function dutyToMemberRole(duty: ProjectDuty): string {
  if (duty === "owner") return "project_admin";
  if (duty === "purchaser") return "operator";
  return "viewer";
}
