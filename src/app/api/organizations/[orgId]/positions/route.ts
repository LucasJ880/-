/**
 * PERM-7：岗位绑定界面接口（只认平台 super_admin）
 *
 * GET  — 企业岗位模式、可绑岗位（active RoleProfile，分行业包岗位 / 系统模板）、成员与数字员工的 active 绑定
 * PUT  — 设置一个主体（HUMAN / DIGITAL_EMPLOYEE）在本企业的完整岗位集合；dryRun 只返回差异
 *        校验 / 差异 / 写入 / 审计与 scripts/bind-positions.ts 同一套（position-binding + position-binding-service），
 *        区别：界面编辑完整集合（集合外的 active 绑定都停用，含系统模板），脚本 --prune 只动行业包岗位。
 *        岗位模式企业不能停掉最后一个人类 owner 绑定（409 LAST_OWNER_BINDING）。
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePlatformSuperAdmin } from "@/lib/auth/guards";
import { DIGITAL_EMPLOYEE_POSITION_KEYS } from "@/lib/authorization/digital-employee";
import {
  OWNER_POSITION_KEY,
  parsePrincipalType,
  planBindingDiff,
  validateBindings,
  validateDigitalEmployeeBindings,
  wouldRemoveLastOwnerBinding,
  type ValidateResult,
} from "@/lib/authorization/position-binding";
import { executeBindingPlan, loadBindingContext } from "@/lib/authorization/position-binding-service";
import { hasPositionTemplates, profilesForIndustryPack } from "@/lib/authorization/role-defaults";

type RouteCtx = { params: Promise<{ orgId: string }> };

async function loadOrg(orgId: string) {
  return db.organization.findUnique({ where: { id: orgId }, select: { id: true, name: true, industryPackId: true } });
}

function activeKeysByPrincipal(rows: Array<{ principalId: string; status: string; roleProfile: { key: string } }>) {
  const out = new Map<string, string[]>();
  for (const r of rows) {
    if (r.status !== "active") continue;
    out.set(r.principalId, [...(out.get(r.principalId) ?? []), r.roleProfile.key].sort());
  }
  return out;
}

export async function GET(request: NextRequest, ctx: RouteCtx) {
  const auth = await requirePlatformSuperAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const { orgId } = await ctx.params;
  const org = await loadOrg(orgId);
  if (!org) return NextResponse.json({ error: "组织不存在" }, { status: 404 });

  const packKeys = new Set(profilesForIndustryPack(org.industryPackId).map((p) => p.key));
  const [human, digital, members, agents] = await Promise.all([
    loadBindingContext(orgId, "HUMAN"),
    loadBindingContext(orgId, "DIGITAL_EMPLOYEE"),
    db.organizationMember.findMany({
      where: { orgId, status: "active" },
      orderBy: { joinedAt: "asc" },
      select: { userId: true, role: true, user: { select: { name: true, email: true } } },
    }),
    db.agent.findMany({
      where: { status: "active", project: { orgId } },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, createdBy: { select: { name: true, email: true } } },
    }),
  ]);
  const humanKeys = activeKeysByPrincipal(human.existingRows);
  const digitalKeys = activeKeysByPrincipal(digital.existingRows);
  const known = new Set(human.profiles.map((p) => p.key));

  return NextResponse.json({
    org: { id: org.id, name: org.name, positionMode: hasPositionTemplates(org.industryPackId) },
    profiles: human.profiles.map((p) => ({ key: p.key, name: p.name, group: packKeys.has(p.key) ? "pack" : "system" })),
    members: members.map((m) => ({
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      orgRole: m.role,
      keys: humanKeys.get(m.userId) ?? [],
    })),
    digitalEmployees: agents.map((a) => ({
      agentId: a.id,
      name: a.name,
      sponsor: a.createdBy?.name || a.createdBy?.email || null,
      keys: digitalKeys.get(a.id) ?? [],
    })),
    digitalAllowedKeys: DIGITAL_EMPLOYEE_POSITION_KEYS.filter((k) => known.has(k)),
  });
}

export async function PUT(request: NextRequest, ctx: RouteCtx) {
  const auth = await requirePlatformSuperAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const { orgId } = await ctx.params;
  const org = await loadOrg(orgId);
  if (!org) return NextResponse.json({ error: "组织不存在" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as
    | { principalType?: unknown; principalId?: unknown; keys?: unknown; dryRun?: unknown }
    | null;
  const principalType = parsePrincipalType(typeof body?.principalType === "string" ? body.principalType : null);
  const principalId = typeof body?.principalId === "string" ? body.principalId.trim() : "";
  const keys = Array.isArray(body?.keys) && body.keys.every((k) => typeof k === "string") ? [...new Set(body.keys as string[])] : null;
  if (!principalType || !principalId || !keys) {
    return NextResponse.json({ error: "需要 principalType（HUMAN / DIGITAL_EMPLOYEE）、principalId 与岗位 key 数组" }, { status: 400 });
  }

  const bctx = await loadBindingContext(orgId, principalType);
  const knownProfileKeys = [...bctx.profileIdByKey.keys()];
  let validated: ValidateResult;
  if (principalType === "DIGITAL_EMPLOYEE") {
    const agent = await db.agent.findUnique({
      where: { id: principalId },
      select: { id: true, name: true, status: true, project: { select: { orgId: true } } },
    });
    validated = validateDigitalEmployeeBindings({
      file: { bindings: { [principalId]: keys } },
      orgId,
      knownProfileKeys,
      allowedPositionKeys: DIGITAL_EMPLOYEE_POSITION_KEYS,
      agentsById: agent ? { [agent.id]: { id: agent.id, name: agent.name, status: agent.status, orgId: agent.project.orgId } } : {},
    });
  } else {
    const member = await db.organizationMember.findUnique({
      where: { orgId_userId: { orgId, userId: principalId } },
      select: { userId: true, status: true, user: { select: { email: true } } },
    });
    if (!member) return NextResponse.json({ error: "校验失败", errors: [`${principalId}：不是本企业成员`] }, { status: 400 });
    const email = member.user.email.toLowerCase();
    validated = validateBindings({
      file: { bindings: { [email]: keys } },
      knownProfileKeys,
      membersByEmail: { [email]: { userId: member.userId, status: member.status } },
    });
  }
  if (!validated.ok) return NextResponse.json({ error: "校验失败", errors: validated.errors }, { status: 400 });

  // 界面编辑的是完整集合：集合外的 active 绑定（含系统模板）都停用
  const plan = planBindingDiff({
    desired: validated.resolved,
    existing: bctx.existingRows.map((r) => ({ userId: r.principalId, profileKey: r.roleProfile.key, status: r.status })),
    prune: true,
    prunableKeys: knownProfileKeys,
  });

  const positionMode = hasPositionTemplates(org.industryPackId);
  if (positionMode && principalType === "HUMAN" && plan.deactivate.some((d) => d.profileKey === OWNER_POSITION_KEY)) {
    // 其他仍是 active 成员、且持未过期 active owner 绑定的人
    const otherOwnerIds = (
      await db.principalRoleBinding.findMany({
        where: {
          orgId,
          principalType: "HUMAN",
          status: "active",
          principalId: { not: principalId },
          roleProfile: { key: OWNER_POSITION_KEY },
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: { principalId: true },
      })
    ).map((b) => b.principalId);
    const otherActiveOwnerCount = otherOwnerIds.length
      ? await db.organizationMember.count({ where: { orgId, status: "active", userId: { in: otherOwnerIds } } })
      : 0;
    if (wouldRemoveLastOwnerBinding({ positionMode, principalType, plan, otherActiveOwnerCount })) {
      return NextResponse.json(
        { error: "不能停用本企业最后一个老板岗位（否则无人有管理层权限）", code: "LAST_OWNER_BINDING", plan },
        { status: 409 },
      );
    }
  }

  if (body?.dryRun === true) return NextResponse.json({ plan, dryRun: true });

  const applied = await executeBindingPlan({ orgId, actorUserId: auth.user.id, principalType, plan, ctx: bctx, via: "console" });
  return NextResponse.json({ plan, applied });
}
