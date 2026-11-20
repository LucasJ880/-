/**
 * CHAIN-2c 谁能更换项目负责人（纯函数 + 固定文字；页面也用，不依赖 db）
 *
 * 项目负责人自动拥有项目财务特权（src/lib/project-finance/access.ts）。为不让本身没有财务特权的人
 * 通过换负责人拿到它：
 *   - 换给别人：平台超级管理员、当前负责人、管理者（组织项目 = 本组织 org_admin 以上；执行项目 = 能管理执行项目的人）、
 *     有财务特权的人（平台超级管理员或在本组织持组织范围 project.finance.manage）；
 *   - 换给自己：只有有财务特权的人；
 *   - 新负责人与当前相同 → 不算更换。
 * 判定读取在 owner-change-access.ts（服务端）。
 */

export const OWNER_CHANGE_TEXT = {
  forbiddenOrg: "只有项目负责人、组织管理员、持「管理项目财务」权限的人或平台管理员能更换项目负责人。",
  forbiddenPersonal: "这是个人项目，只有项目负责人或平台管理员能更换负责人。",
  selfOrg: "不能把自己设为负责人：需要「管理项目财务」权限。可以请项目负责人或组织管理员把负责人交给你。",
  selfPersonal: "不能把自己设为负责人：请项目负责人把负责人交给你。",
  invalidOrg: "新的负责人必须是本组织在用的成员。",
  invalidPersonal: "新的负责人必须是在用的用户。",
  conflict: "负责人刚被别人改过，请刷新后看清现在的负责人再操作。",
  /** 成员卡片上的说明（不能换 / 不能换给自己时各一句） */
  hintCannotChangeOrg: "只有项目负责人、组织管理员、持「管理项目财务」权限的人或平台管理员能更换负责人。",
  hintCannotChangePersonal: "这是个人项目，只有项目负责人或平台管理员能更换负责人。",
  hintCannotSelfOrg: "把自己设为负责人需要「管理项目财务」权限；可以请项目负责人或组织管理员把负责人交给你。",
  hintCannotSelfPersonal: "要成为负责人，请项目负责人把负责人交给你。",
} as const;

export type OwnerChangeCode = "OWNER_CHANGE_FORBIDDEN" | "OWNER_SELF_ASSIGN_FORBIDDEN" | "OWNER_INVALID" | "OWNER_CONFLICT";

export type OwnerChangeActor = {
  actorUserId: string;
  /** 平台超级管理员 */
  isSuperAdmin: boolean;
  /** 有财务特权：平台超级管理员，或在项目组织持组织范围 project.finance.manage（与 resolveFinancePrivilege(user, orgId, null).privileged 同口径） */
  hasFinancePrivilege: boolean;
  /** 管理者：组织项目 = 本组织 org_admin 以上的有效成员；执行项目 = 能管理执行项目的人；个人项目恒为 false */
  isManager: boolean;
  /** 项目是否属于组织（个人项目 false：只用文字区分） */
  hasOrg: boolean;
};

export type OwnerChangeDecision =
  | { ok: true; changed: boolean }
  | { ok: false; status: 403; code: OwnerChangeCode; messageZh: string };

export function decideOwnerChange(actor: OwnerChangeActor, currentOwnerId: string, targetUserId: string): OwnerChangeDecision {
  if (targetUserId === currentOwnerId) return { ok: true, changed: false };
  const isCurrentOwner = actor.actorUserId === currentOwnerId;
  const toSelf = targetUserId === actor.actorUserId;
  if (toSelf) {
    if (actor.isSuperAdmin || actor.hasFinancePrivilege) return { ok: true, changed: true };
    return { ok: false, status: 403, code: "OWNER_SELF_ASSIGN_FORBIDDEN", messageZh: actor.hasOrg ? OWNER_CHANGE_TEXT.selfOrg : OWNER_CHANGE_TEXT.selfPersonal };
  }
  if (actor.isSuperAdmin || actor.hasFinancePrivilege || isCurrentOwner || (actor.hasOrg && actor.isManager)) return { ok: true, changed: true };
  return { ok: false, status: 403, code: "OWNER_CHANGE_FORBIDDEN", messageZh: actor.hasOrg ? OWNER_CHANGE_TEXT.forbiddenOrg : OWNER_CHANGE_TEXT.forbiddenPersonal };
}

/** 成员接口给页面的两个标记：canChange = 能把负责人换成别人，canSelfAssign = 能把自己设为负责人（都已含「能修改本项目」） */
export function ownerChangeFlags(actor: OwnerChangeActor, currentOwnerId: string, canEditProject: boolean): { canChange: boolean; canSelfAssign: boolean } {
  if (!canEditProject) return { canChange: false, canSelfAssign: false };
  const other = decideOwnerChange(actor, currentOwnerId, `__someone_else__:${actor.actorUserId}`);
  const self = actor.actorUserId === currentOwnerId ? { ok: false } : decideOwnerChange(actor, currentOwnerId, actor.actorUserId);
  return { canChange: other.ok, canSelfAssign: self.ok };
}

/** 新负责人是否合格：在用的用户；项目属于组织时还要是该组织的有效成员 */
export function checkNewOwner(input: { hasOrg: boolean; userActive: boolean; orgMemberActive: boolean }):
  | { ok: true }
  | { ok: false; status: 400; code: "OWNER_INVALID"; messageZh: string } {
  if (!input.userActive || (input.hasOrg && !input.orgMemberActive)) {
    return { ok: false, status: 400, code: "OWNER_INVALID", messageZh: input.hasOrg ? OWNER_CHANGE_TEXT.invalidOrg : OWNER_CHANGE_TEXT.invalidPersonal };
  }
  return { ok: true };
}

/** 成员卡片的说明：不能换给别人 → 第一句；能换但不能换给自己、且自己不是负责人 → 第二句；否则不写 */
export function ownerChangeHint(flags: { canChange: boolean; canSelfAssign: boolean }, opts: { hasOrg: boolean; isCurrentOwner: boolean; canManage: boolean }): string | null {
  if (!opts.canManage) return null;
  if (!flags.canChange) return opts.hasOrg ? OWNER_CHANGE_TEXT.hintCannotChangeOrg : OWNER_CHANGE_TEXT.hintCannotChangePersonal;
  if (!flags.canSelfAssign && !opts.isCurrentOwner) return opts.hasOrg ? OWNER_CHANGE_TEXT.hintCannotSelfOrg : OWNER_CHANGE_TEXT.hintCannotSelfPersonal;
  return null;
}
