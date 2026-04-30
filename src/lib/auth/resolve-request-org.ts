/**
 * 从用户成员关系解析「当前组织」上下文（简报、Agent 等）
 * 规则对齐外贸 resolveTradeOrgId：不信任随意默认第一个组织；管理员须显式 orgId。
 */

import { NextResponse } from "next/server";
import type { AuthUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/rbac/roles";

export type RequestOrgResolution =
  | { ok: true; orgId: string }
  | { ok: false; response: NextResponse };

function orgMissing(): NextResponse {
  return NextResponse.json(
    { error: "缺少 orgId，或您属于多个组织请在请求中指定 orgId" },
    { status: 400 },
  );
}

function forbiddenOrg(): NextResponse {
  return NextResponse.json({ error: "无权访问该组织" }, { status: 403 });
}

async function listActiveOrgIdsForUser(userId: string): Promise<string[]> {
  const rows = await db.organizationMember.findMany({
    where: { userId, status: "active" },
    select: { orgId: true },
  });
  return rows.map((r) => r.orgId);
}

/**
 * @param bodyOrgId — 请求体中的 orgId（已 trim 的可直接传入）
 */
export async function resolveRequestOrgIdForUser(
  user: AuthUser,
  bodyOrgId?: string | null,
): Promise<RequestOrgResolution> {
  const explicit = (bodyOrgId ?? "").trim() || null;

  if (isAdmin(user.role)) {
    if (!explicit) {
      return { ok: false, response: orgMissing() };
    }
    const org = await db.organization.findUnique({
      where: { id: explicit },
      select: { id: true },
    });
    if (!org) {
      return {
        ok: false,
        response: NextResponse.json({ error: "组织不存在" }, { status: 400 }),
      };
    }
    return { ok: true, orgId: explicit };
  }

  const memberships = await listActiveOrgIdsForUser(user.id);
  if (memberships.length === 0) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "未加入任何组织，无法继续" },
        { status: 403 },
      ),
    };
  }

  if (explicit) {
    if (!memberships.includes(explicit)) {
      return { ok: false, response: forbiddenOrg() };
    }
    return { ok: true, orgId: explicit };
  }

  if (memberships.length === 1) {
    return { ok: true, orgId: memberships[0] };
  }

  return { ok: false, response: orgMissing() };
}
