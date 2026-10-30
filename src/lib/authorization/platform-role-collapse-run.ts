/**
 * PERM-4c3：平台角色压扁执行器（连库）。scripts/collapse-platform-roles.ts 只做参数解析与环境闸。
 * 退出码：0 成功 / 1 拒绝（执行者不是平台管理员、写库闸门关闭）/ 2 输入或前置校验错误。
 */

import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/logger";
import { hasPositionTemplates } from "@/lib/authorization/role-defaults";
import {
  COLLAPSE_AUDIT_ACTION,
  RESIDUAL_ROLE_READS_DOC,
  RESTORE_AUDIT_ACTION,
  planCollapse,
  planRestore,
  summarizeCollapse,
  summarizeRestore,
  type CollapseAuditRecord,
} from "./platform-role-collapse";

const VIA = "scripts/collapse-platform-roles.ts";
const RELOGIN_HINT = "提醒：被修改的成员需重新登录，页面中间件读的是登录时签发的角色";

export type CollapseRunInput = {
  orgCode: string;
  actorEmail: string;
  dryRun: boolean;
  restore: boolean;
  /** 写库闸门（脚本传 PLATFORM_ROLE_COLLAPSE_READY；测试可覆盖） */
  ready: boolean;
};

export type CollapseRunResult = { exitCode: 0 | 1 | 2; lines: string[] };

function parseAfter(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function runPlatformRoleCollapse(input: CollapseRunInput): Promise<CollapseRunResult> {
  const lines: string[] = [];

  const actor = await db.user.findUnique({
    where: { email: input.actorEmail.toLowerCase() },
    select: { id: true, role: true, email: true },
  });
  if (!actor || actor.role !== "super_admin") {
    return { exitCode: 1, lines: ["拒绝：执行者必须是平台管理员（super_admin）"] };
  }

  const org = await db.organization.findUnique({
    where: { code: input.orgCode },
    select: { id: true, code: true, name: true, industryPackId: true },
  });
  if (!org) return { exitCode: 2, lines: [`找不到企业 code=${input.orgCode}`] };

  const mode = input.restore ? "还原" : input.dryRun ? "dry-run" : "执行";
  lines.push(`企业 ${org.code}（${org.name}）执行者 ${actor.email}（${mode}）`);

  if (input.restore) return restore(org.id, actor.id, input.dryRun, lines);

  const members = await db.organizationMember.findMany({
    where: { orgId: org.id },
    select: { userId: true, status: true, user: { select: { email: true, role: true } } },
  });
  const userIds = members.map((m) => m.userId);
  const now = new Date();
  const [bindings, others] = await Promise.all([
    db.principalRoleBinding.findMany({
      where: {
        orgId: org.id,
        principalType: "HUMAN",
        principalId: { in: userIds },
        status: "active",
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { principalId: true },
    }),
    db.organizationMember.findMany({
      where: { userId: { in: userIds }, orgId: { not: org.id } },
      select: { userId: true, status: true, org: { select: { code: true, industryPackId: true } } },
    }),
  ]);
  const bindingCount = new Map<string, number>();
  for (const b of bindings) bindingCount.set(b.principalId, (bindingCount.get(b.principalId) ?? 0) + 1);

  const plan = planCollapse({
    orgCode: org.code,
    positionMode: hasPositionTemplates(org.industryPackId),
    members: members.map((m) => ({
      userId: m.userId,
      email: m.user.email,
      platformRole: m.user.role,
      memberStatus: m.status,
      activeBindingCount: bindingCount.get(m.userId) ?? 0,
    })),
    otherMemberships: others.map((o) => ({
      userId: o.userId,
      orgCode: o.org.code,
      positionMode: hasPositionTemplates(o.org.industryPackId),
      status: o.status,
    })),
  });
  lines.push(...summarizeCollapse(plan));

  if (plan.blockers.length > 0) {
    lines.push("前置校验未通过，整批未写入");
    return { exitCode: 2, lines };
  }
  if (input.dryRun) return { exitCode: 0, lines };
  if (!input.ready) {
    lines.push(`拒绝写入：写库闸门 PLATFORM_ROLE_COLLAPSE_READY 关闭（残留平台角色读点未收口，见 ${RESIDUAL_ROLE_READS_DOC}）；只允许 --dry-run 与 --restore`);
    return { exitCode: 1, lines };
  }
  if (plan.change.length === 0) return { exitCode: 0, lines };

  await db.$transaction(async (tx) => {
    for (const c of plan.change) {
      await tx.user.update({ where: { id: c.userId }, data: { role: "user" } });
      await writeAuditLog(tx, {
        userId: actor.id,
        orgId: org.id,
        action: COLLAPSE_AUDIT_ACTION,
        targetType: "user",
        targetId: c.userId,
        beforeData: { role: c.fromRole },
        afterData: { email: c.email, fromRole: c.fromRole, toRole: "user", via: VIA },
      });
    }
  });
  lines.push(`已压扁 ${plan.change.length} 人`, RELOGIN_HINT);
  return { exitCode: 0, lines };
}

async function restore(orgId: string, actorId: string, dryRun: boolean, lines: string[]): Promise<CollapseRunResult> {
  const rows = await db.auditLog.findMany({
    where: { orgId, action: COLLAPSE_AUDIT_ACTION, targetType: "user" },
    select: { targetId: true, afterData: true, createdAt: true },
  });
  const records: CollapseAuditRecord[] = [];
  for (const r of rows) {
    const after = parseAfter(r.afterData);
    if (!r.targetId || typeof after.fromRole !== "string") continue;
    records.push({
      userId: r.targetId,
      email: typeof after.email === "string" ? after.email : null,
      fromRole: after.fromRole,
      createdAt: r.createdAt,
    });
  }
  const users = await db.user.findMany({
    where: { id: { in: [...new Set(records.map((r) => r.userId))] } },
    select: { id: true, role: true },
  });
  const plan = planRestore({
    records,
    currentRoles: Object.fromEntries(users.map((u) => [u.id, u.role])),
  });
  lines.push(...summarizeRestore(plan));
  if (dryRun || plan.restore.length === 0) return { exitCode: 0, lines };

  await db.$transaction(async (tx) => {
    for (const r of plan.restore) {
      await tx.user.update({ where: { id: r.userId }, data: { role: r.toRole } });
      await writeAuditLog(tx, {
        userId: actorId,
        orgId,
        action: RESTORE_AUDIT_ACTION,
        targetType: "user",
        targetId: r.userId,
        beforeData: { role: "user" },
        afterData: { email: r.email, fromRole: "user", toRole: r.toRole, via: VIA },
      });
    }
  });
  lines.push(`已还原 ${plan.restore.length} 人`, RELOGIN_HINT);
  return { exitCode: 0, lines };
}
