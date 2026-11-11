/**
 * RFQ-AUTO-3 个人开关「自动起草的轮次带跟进授权」（DB 侧）
 *
 * 两个功能开关（跟进授权、自动起草）对该组织都打开时这个开关才存在；任一关闭 → 读出来永远是关，设置接口不可用。
 * 本文件不发信、不建审批卡：它只决定之后自动起草的卡「带不带」授权；授权仍然写在卡上、由人批准才生效。
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/logger";
import { isRfqAutoDraftEnabledForOrg } from "./auto-draft-flags";
import { AUTO_DRAFT_OPTIN_AUDIT_ACTION, readAutoDraftFollowUpOptIn, withAutoDraftFollowUpOptIn } from "./auto-followup-optin";
import { isRfqFollowUpPreapprovalEnabledForOrg } from "./followup-flags";

/** 这个组织里有没有这个个人开关（两个功能开关都打开） */
export function isAutoDraftFollowUpOptInAvailable(orgId: string | null | undefined): boolean {
  return isRfqFollowUpPreapprovalEnabledForOrg(orgId) && isRfqAutoDraftEnabledForOrg(orgId);
}

/** 自动起草时用：触发起草的这个人有没有开启。功能开关任一关闭 → false，且不查库。 */
export async function loadAutoDraftFollowUpOptIn(orgId: string, userId: string): Promise<boolean> {
  if (!isAutoDraftFollowUpOptInAvailable(orgId)) return false;
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { settingsJson: true } });
  return readAutoDraftFollowUpOptIn(org?.settingsJson ?? null, userId);
}

export type SetOptInResult =
  | { ok: true; enabled: boolean; changed: boolean }
  | { ok: false; errorCode: "DISABLED" | "ORG_NOT_FOUND"; message: string };

/**
 * 开启 / 关闭本人的开关。调用方负责项目写权限与「userId 就是登录的那个人」。
 * 状态变了才写库、才写审计；两者在同一个事务里（审计写不进去，开关也不变）。
 * 事务里先锁住组织这一行再读改写，避免与同时发生的另一次设置互相覆盖。
 */
export async function setAutoDraftFollowUpOptIn(input: { orgId: string; projectId: string; userId: string; enabled: boolean; now?: Date }): Promise<SetOptInResult> {
  if (!isAutoDraftFollowUpOptInAvailable(input.orgId)) return { ok: false, errorCode: "DISABLED", message: "这个开关还没有对你的组织开放。" };
  const now = input.now ?? new Date();
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Organization" WHERE id = ${input.orgId} FOR UPDATE`;
    const org = await tx.organization.findUnique({ where: { id: input.orgId }, select: { settingsJson: true } });
    if (!org) return { ok: false as const, errorCode: "ORG_NOT_FOUND" as const, message: "没找到这个组织。" };
    const { changed, next } = withAutoDraftFollowUpOptIn(org.settingsJson, input.userId, input.enabled, now);
    if (!changed) return { ok: true as const, enabled: readAutoDraftFollowUpOptIn(org.settingsJson, input.userId), changed: false };
    await tx.organization.update({ where: { id: input.orgId }, data: { settingsJson: next as Prisma.InputJsonValue } });
    await writeAuditLog(tx, {
      userId: input.userId,
      orgId: input.orgId,
      projectId: input.projectId,
      action: AUTO_DRAFT_OPTIN_AUDIT_ACTION,
      targetType: "user",
      targetId: input.userId,
      beforeData: { enabled: !input.enabled },
      afterData: { enabled: input.enabled },
    });
    return { ok: true as const, enabled: input.enabled, changed: true };
  });
}
