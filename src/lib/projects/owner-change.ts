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
  forbiddenOrg: "只有项目负责人、组织管理员、持「管理项目财务」权限的人或平台管理员能更换项目负责人。请找现在的主负责人或组织管理员。",
  forbiddenPersonal: "这是个人项目，只有项目负责人或平台管理员能更换负责人。",
  selfOrg: "你不能把自己设为主负责人（需要「管理项目财务」权限），可以请现在的主负责人或另一位组织管理员交给你。",
  selfPersonal: "不能把自己设为负责人：请项目负责人把负责人交给你。",
  invalidOrg: "新负责人必须是本组织的有效成员（账号没停用、没离开组织），请换一位。",
  invalidPersonal: "新负责人的账号已停用，请换一位。",
  conflict: "负责人刚被别人换过了，请刷新页面，看清现在的负责人再操作。",
  /** 项目团队卡片上的说明（只有组织项目会出现：个人项目能修改的只有负责人与平台管理员） */
  hintCannotChange: "你不能更换主负责人。需要更换，请找现在的主负责人或组织管理员。",
  hintCannotSelf: "你不能把自己设为主负责人（需要「管理项目财务」权限），可以请现在的主负责人或另一位组织管理员交给你。",
  /** 换主负责人前的确认；调用人是现在的负责人时多一句 */
  confirm: (name: string) => `把主负责人换成「${name}」？`,
  confirmOwnerSuffix: "换完后你不能自己改回来，要请新的主负责人或组织管理员交还。",
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

/**
 * 项目团队卡片的说明：不能换给别人 → 第一句；能换但不能换给自己、且自己不是负责人 → 第二句；否则不写。
 * 个人项目不写（能修改个人项目的只有负责人与平台管理员，两句都不会出现）。
 */
export function ownerChangeHint(flags: { canChange: boolean; canSelfAssign: boolean }, opts: { hasOrg: boolean; isCurrentOwner: boolean; canManage: boolean }): string | null {
  if (!opts.canManage || !opts.hasOrg) return null;
  if (!flags.canChange) return OWNER_CHANGE_TEXT.hintCannotChange;
  if (!flags.canSelfAssign && !opts.isCurrentOwner) return OWNER_CHANGE_TEXT.hintCannotSelf;
  return null;
}

/** 换主负责人前的确认 */
export function ownerChangeConfirm(name: string, callerIsCurrentOwner: boolean): string {
  return callerIsCurrentOwner ? `${OWNER_CHANGE_TEXT.confirm(name)}${OWNER_CHANGE_TEXT.confirmOwnerSuffix}` : OWNER_CHANGE_TEXT.confirm(name);
}
