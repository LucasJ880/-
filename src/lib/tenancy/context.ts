/**
 * 统一 Tenant Context — 包装现有 org helpers，不另起第二套鉴权系统。
 *
 * 默认 requireMembership=true：平台超管若无 OrganizationMember 则 403。
 * 运维白名单路由可传 allowPlatformBypass。
 */

import { NextRequest, NextResponse } from "next/server";
import type { AuthUser } from "@/lib/auth";
import { getOrgMembership } from "@/lib/auth";
import { requireAuth } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { isSuperAdmin } from "@/lib/rbac/roles";
import { resolveTradeOrgId } from "@/lib/trade/access";

export type TenantContext = {
  userId: string;
  orgId: string;
  orgSlug?: string;
  orgRole: string;
  workspaceIds?: string[];
  isPlatformAdmin: boolean;
  user: AuthUser;
};

export type RequireTenantOptions = {
  /** 默认 true：必须是 active OrganizationMember */
  requireMembership?: boolean;
  /** true 时平台超管可无 membership 进入（仅运维白名单） */
  allowPlatformBypass?: boolean;
  /** 覆盖 query/body 的 orgId */
  bodyOrgId?: string | null;
  /** 是否加载 Workspace 成员 id 列表 */
  loadWorkspaces?: boolean;
};

function isNextResponse(v: unknown): v is NextResponse {
  return v instanceof NextResponse;
}

async function loadOrgMeta(orgId: string) {
  return db.organization.findUnique({
    where: { id: orgId },
    select: { id: true, code: true, status: true },
  });
}

async function loadWorkspaceIds(userId: string, orgId: string): Promise<string[]> {
  try {
    const rows = await db.workspaceMember.findMany({
      where: {
        userId,
        status: "active",
        workspace: { orgId, status: "active" },
      },
      select: { workspaceId: true },
    });
    return rows.map((r) => r.workspaceId);
  } catch {
    // Workspace 表尚未迁移时降级
    return [];
  }
}

/**
 * 从已认证用户 + 请求解析 TenantContext。
 * orgId 来自 query/body，并校验成员关系（或平台 bypass）。
 */
export async function getTenantContext(
  request: NextRequest,
  user: AuthUser,
  opts?: RequireTenantOptions,
): Promise<TenantContext | NextResponse> {
  const requireMembership = opts?.requireMembership !== false;
  const allowPlatformBypass = opts?.allowPlatformBypass === true;
  const isPlatformAdmin = isSuperAdmin(user.role);

  const resolved = await resolveTradeOrgId(request, user, {
    bodyOrgId: opts?.bodyOrgId,
  });
  if (!resolved.ok) return resolved.response;

  const orgId = resolved.orgId;
  const org = await loadOrgMeta(orgId);
  if (!org || org.status === "archived") {
    return NextResponse.json({ error: "组织不存在或已归档" }, { status: 404 });
  }

  const membership = await getOrgMembership(user.id, orgId);
  const activeMember = membership?.status === "active" ? membership : null;

  if (requireMembership) {
    if (!activeMember) {
      if (isPlatformAdmin && allowPlatformBypass) {
        // 运维旁路：标记为平台身份，orgRole 用 org_admin 仅表示能力上限
        const workspaceIds = opts?.loadWorkspaces
          ? await loadWorkspaceIds(user.id, orgId)
          : undefined;
        return {
          userId: user.id,
          orgId,
          orgSlug: org.code,
          orgRole: "org_admin",
          workspaceIds,
          isPlatformAdmin: true,
          user,
        };
      }
      return NextResponse.json({ error: "无权访问该组织" }, { status: 403 });
    }
  } else if (!activeMember && !(isPlatformAdmin && allowPlatformBypass)) {
    return NextResponse.json({ error: "无权访问该组织" }, { status: 403 });
  }

  const workspaceIds = opts?.loadWorkspaces
    ? await loadWorkspaceIds(user.id, orgId)
    : undefined;

  return {
    userId: user.id,
    orgId,
    orgSlug: org.code,
    orgRole: activeMember?.role ?? (isPlatformAdmin ? "org_admin" : "org_member"),
    workspaceIds,
    isPlatformAdmin,
    user,
  };
}

/** 认证 + TenantContext（业务 API 推荐入口） */
export async function requireTenantContext(
  request: NextRequest,
  opts?: RequireTenantOptions,
): Promise<TenantContext | NextResponse> {
  const auth = await requireAuth(request);
  if (isNextResponse(auth)) return auth;
  return getTenantContext(request, auth.user, opts);
}

/** 校验用户对 workspace 的访问（骨架：成员或 org_admin） */
export async function requireWorkspaceAccess(
  tenant: TenantContext,
  workspaceId: string,
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const ws = await db.workspace.findFirst({
    where: { id: workspaceId, orgId: tenant.orgId },
    select: { id: true },
  });
  if (!ws) {
    return {
      ok: false,
      response: NextResponse.json({ error: "工作空间不存在" }, { status: 404 }),
    };
  }
  if (tenant.orgRole === "org_admin" || tenant.isPlatformAdmin) {
    return { ok: true };
  }
  const m = await db.workspaceMember.findFirst({
    where: {
      workspaceId,
      userId: tenant.userId,
      status: "active",
    },
  });
  if (!m) {
    return {
      ok: false,
      response: NextResponse.json({ error: "无权访问该工作空间" }, { status: 403 }),
    };
  }
  return { ok: true };
}

/** 校验项目属于当前 org（可选再校验 workspace） */
export async function requireProjectAccess(
  tenant: TenantContext,
  projectId: string,
): Promise<{ ok: true; project: { id: string; orgId: string | null; workspaceId: string | null } } | { ok: false; response: NextResponse }> {
  const project = await db.project.findFirst({
    where: { id: projectId, orgId: tenant.orgId },
    select: { id: true, orgId: true, workspaceId: true },
  });
  if (!project) {
    return {
      ok: false,
      response: NextResponse.json({ error: "项目不存在" }, { status: 404 }),
    };
  }
  return { ok: true, project };
}
