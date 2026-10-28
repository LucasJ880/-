/**
 * PERM-4c3：平台角色压扁（纯函数规划；连库执行见 platform-role-collapse-run.ts）
 *
 * 把岗位模式企业 active 成员的旧平台角色（boss / manager / operations / sales / trade / admin）压成 user。
 * super_admin / user 不动；非 active 成员不动。PERM-6c 起 trade 纳入（外贸读点已按岗位，见残留清单 F 组）；
 * PERM-7b 起 admin 纳入（平台特权只认 super_admin，admin 已等同 user）。
 * 前置校验任一不满足 → 整批不写（D2 / D3）。前后角色存 AuditLog，--restore 按审计还原（D4）。
 */

export const COLLAPSIBLE_PLATFORM_ROLES = ["boss", "manager", "operations", "sales", "trade", "admin"] as const;

/**
 * 写库闸门（D1）：残留平台角色读点（docs/QINGYAN_PERM-4c3_RESIDUAL_ROLE_READS.md）收口前为 false，
 * 脚本只允许 --dry-run 与 --restore。PERM-4c5 收口 A / B / C / D1 / D5 后改为 true；外贸 D2–D4 与 F 组 PERM-6c 收口。
 */
export const PLATFORM_ROLE_COLLAPSE_READY = true;

export const RESIDUAL_ROLE_READS_DOC = "docs/QINGYAN_PERM-4c3_RESIDUAL_ROLE_READS.md";

export const COLLAPSE_AUDIT_ACTION = "authorization.platform_role.collapse";
export const RESTORE_AUDIT_ACTION = "authorization.platform_role.restore";

export type CollapseMember = {
  userId: string;
  email: string | null;
  platformRole: string;
  memberStatus: string;
  /** 该人在目标企业的 active 人类岗位绑定条数（系统模板绑定也算） */
  activeBindingCount: number;
};

export type OtherMembership = {
  userId: string;
  orgCode: string;
  /** 该企业是否岗位模式（行业包有岗位模板） */
  positionMode: boolean;
  status: string;
};

export type CollapseChange = { userId: string; email: string | null; fromRole: string };
export type CollapseSkip = { userId: string; email: string | null; role: string; reason: string };

export type CollapsePlan = {
  change: CollapseChange[];
  skipped: CollapseSkip[];
  /** 非空即整批拒绝（退出码 2） */
  blockers: string[];
};

function isCollapsible(role: string): boolean {
  return (COLLAPSIBLE_PLATFORM_ROLES as readonly string[]).includes(role);
}

function label(email: string | null, userId: string): string {
  return email ?? `(无邮箱 ${userId})`;
}

export function planCollapse(input: {
  orgCode: string;
  positionMode: boolean;
  members: CollapseMember[];
  otherMemberships: OtherMembership[];
}): CollapsePlan {
  const change: CollapseChange[] = [];
  const skipped: CollapseSkip[] = [];
  const blockers: string[] = [];

  if (!input.positionMode) {
    blockers.push(`企业 ${input.orgCode} 不是岗位模式（行业包无岗位模板），不能压扁`);
  }

  for (const m of input.members) {
    if (m.memberStatus !== "active") {
      skipped.push({ userId: m.userId, email: m.email, role: m.platformRole, reason: "非 active 成员" });
      continue;
    }
    if (!isCollapsible(m.platformRole)) {
      skipped.push({ userId: m.userId, email: m.email, role: m.platformRole, reason: "不在压扁范围" });
      continue;
    }
    change.push({ userId: m.userId, email: m.email, fromRole: m.platformRole });
    if (m.activeBindingCount <= 0) {
      blockers.push(`${label(m.email, m.userId)}：在 ${input.orgCode} 无 active 岗位绑定`);
    }
    const legacy = input.otherMemberships.filter(
      (o) => o.userId === m.userId && o.status === "active" && !o.positionMode,
    );
    for (const o of legacy) {
      blockers.push(`${label(m.email, m.userId)}：同时是旧模式企业 ${o.orgCode} 的 active 成员（平台角色跨企业共用）`);
    }
  }

  return { change, skipped, blockers };
}

export type CollapseAuditRecord = {
  userId: string;
  email: string | null;
  fromRole: string;
  createdAt: Date;
};

export type RestoreChange = { userId: string; email: string | null; toRole: string };

export function planRestore(input: {
  records: CollapseAuditRecord[];
  currentRoles: Record<string, string | undefined>;
}): { restore: RestoreChange[]; skipped: CollapseSkip[] } {
  const latest = new Map<string, CollapseAuditRecord>();
  for (const r of input.records) {
    const prev = latest.get(r.userId);
    if (!prev || r.createdAt.getTime() > prev.createdAt.getTime()) latest.set(r.userId, r);
  }
  const restore: RestoreChange[] = [];
  const skipped: CollapseSkip[] = [];
  for (const r of latest.values()) {
    const current = input.currentRoles[r.userId];
    if (current !== "user") {
      skipped.push({ userId: r.userId, email: r.email, role: current ?? "(用户不存在)", reason: "当前平台角色不是 user，不还原" });
      continue;
    }
    restore.push({ userId: r.userId, email: r.email, toRole: r.fromRole });
  }
  return { restore, skipped };
}

/** 输出行：只含邮箱与角色名（不含密码哈希 / token / 连接串） */
export function summarizeCollapse(plan: CollapsePlan): string[] {
  const lines: string[] = [];
  for (const c of plan.change) lines.push(`压扁 ${label(c.email, c.userId)}：${c.fromRole} → user`);
  for (const s of plan.skipped) lines.push(`跳过 ${label(s.email, s.userId)}（${s.role}）：${s.reason}`);
  for (const b of plan.blockers) lines.push(`阻断 ${b}`);
  lines.push(`待压扁 ${plan.change.length}，跳过 ${plan.skipped.length}，阻断 ${plan.blockers.length}`);
  return lines;
}

export function summarizeRestore(plan: { restore: RestoreChange[]; skipped: CollapseSkip[] }): string[] {
  const lines: string[] = [];
  for (const r of plan.restore) lines.push(`还原 ${label(r.email, r.userId)}：user → ${r.toRole}`);
  for (const s of plan.skipped) lines.push(`跳过 ${label(s.email, s.userId)}（${s.role}）：${s.reason}`);
  lines.push(`待还原 ${plan.restore.length}，跳过 ${plan.skipped.length}`);
  return lines;
}
