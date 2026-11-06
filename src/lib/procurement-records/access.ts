/**
 * PROC-1 接口鉴权（spec「组织隔离与权限」）。
 *
 * - 组织级：orgId 只作选择，必须经 resolveRequestOrgIdForUser 校验为本人 active 成员（平台管理员须显式指定），
 *   再按最低组织角色判定；
 * - 申请级：按服务端载入行上的 orgId 校验成员关系；非成员一律 404（不泄露存在性），角色不足 403；
 * - 暗合并闸关闭：读接口 200 available:false，写接口 503，对新表零访问。
 */

import { NextResponse } from "next/server";
import type { AuthUser } from "@/lib/auth";
import { getOrgMembership } from "@/lib/auth";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { db } from "@/lib/db";
import { hasOrgRole, isSuperAdmin, type OrgRole } from "@/lib/rbac/roles";
import { isProcurementSchemaReady, SCHEMA_NOT_READY } from "./flags";

export type MinRole = Extract<OrgRole, "org_viewer" | "org_member" | "org_admin">;

export function schemaGate(kind: "read" | "write"): NextResponse | null {
  if (isProcurementSchemaReady()) return null;
  return kind === "read"
    ? NextResponse.json({ available: false, reason: SCHEMA_NOT_READY })
    : NextResponse.json({ available: false, reason: SCHEMA_NOT_READY, error: "采购情报与资料申请尚未启用（迁移未确认）" }, { status: 503 });
}

export interface OrgAccess {
  user: AuthUser;
  orgId: string;
  orgRole: string;
}

export async function requireProcurementOrg(user: AuthUser, orgIdParam: string | null | undefined, minRole: MinRole): Promise<OrgAccess | NextResponse> {
  const res = await resolveRequestOrgIdForUser(user, orgIdParam ?? null);
  if (!res.ok) return res.response;
  if (isSuperAdmin(user.role)) return { user, orgId: res.orgId, orgRole: "org_admin" };
  const m = await getOrgMembership(user.id, res.orgId);
  if (!m || m.status !== "active") return NextResponse.json({ error: "无权访问该组织" }, { status: 403 });
  if (!hasOrgRole(m.role, minRole)) return NextResponse.json({ error: `需要 ${minRole} 及以上组织角色` }, { status: 403 });
  return { user, orgId: res.orgId, orgRole: m.role };
}

export interface RequestAccess extends OrgAccess {
  request: { id: string; orgId: string; projectId: string | null; status: string };
}

export async function requireRequestAccess(user: AuthUser, requestId: string, minRole: MinRole): Promise<RequestAccess | NextResponse> {
  const req = await db.recordsRequest.findUnique({ where: { id: requestId }, select: { id: true, orgId: true, projectId: true, status: true } });
  if (!req) return NextResponse.json({ error: "申请不存在" }, { status: 404 });
  if (isSuperAdmin(user.role)) return { user, orgId: req.orgId, orgRole: "org_admin", request: req };
  const m = await getOrgMembership(user.id, req.orgId);
  if (!m || m.status !== "active") return NextResponse.json({ error: "申请不存在" }, { status: 404 });
  if (!hasOrgRole(m.role, minRole)) return NextResponse.json({ error: `需要 ${minRole} 及以上组织角色` }, { status: 403 });
  return { user, orgId: req.orgId, orgRole: m.role, request: req };
}

export async function requireInstrumentAccess(user: AuthUser, instrumentId: string, minRole: MinRole): Promise<(OrgAccess & { instrumentId: string }) | NextResponse> {
  const inst = await db.procurementInstrument.findUnique({ where: { id: instrumentId }, select: { id: true, orgId: true } });
  if (!inst) return NextResponse.json({ error: "采购工具不存在" }, { status: 404 });
  if (isSuperAdmin(user.role)) return { user, orgId: inst.orgId, orgRole: "org_admin", instrumentId: inst.id };
  const m = await getOrgMembership(user.id, inst.orgId);
  if (!m || m.status !== "active") return NextResponse.json({ error: "采购工具不存在" }, { status: 404 });
  if (!hasOrgRole(m.role, minRole)) return NextResponse.json({ error: `需要 ${minRole} 及以上组织角色` }, { status: 403 });
  return { user, orgId: inst.orgId, orgRole: m.role, instrumentId: inst.id };
}

/** 服务层错误 → HTTP 响应 */
export function serviceResponse(r: { ok: false; status: number; code: string; message: string; detail?: unknown }) {
  return NextResponse.json({ error: r.message, code: r.code, ...(r.detail !== undefined ? { detail: r.detail } : {}) }, { status: r.status });
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const b = await request.json().catch(() => null);
  return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
}
