/**
 * CHAIN-3 进口线索接口的权限（判定顺序固定）：
 *   未登录 401 → 不能读本项目、或不是该组织有效成员（平台超级管理员除外）404 → 开关关 404 → 写接口不能修改本项目 403。
 * 项目读 / 写权限本身不看组织成员身份（项目负责人、项目成员记录都能单独放行），这里补上。
 */

import { NextRequest, NextResponse } from "next/server";
import { requireProjectReadAccess, requireProjectWriteAccess, type ProjectAccessContext } from "@/lib/projects/access";
import { isSuperAdmin } from "@/lib/rbac/roles";
import { isImportLeadsEnabledForOrg } from "./flags";

const notFound = () => NextResponse.json({ error: "项目不存在" }, { status: 404 });

export type ImportLeadsAccess = { access: ProjectAccessContext; orgId: string; canEdit: boolean };

export async function requireImportLeadsRead(request: NextRequest, projectId: string): Promise<ImportLeadsAccess | NextResponse> {
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access.status === 401 ? access : notFound();
  if (!isSuperAdmin(access.user.role) && !access.orgRole) return notFound();
  const orgId = access.project.orgId;
  if (!orgId || !isImportLeadsEnabledForOrg(orgId)) return notFound();
  const write = await requireProjectWriteAccess(request, projectId);
  return { access, orgId, canEdit: !(write instanceof NextResponse) };
}

export async function requireImportLeadsWrite(request: NextRequest, projectId: string): Promise<ImportLeadsAccess | NextResponse> {
  const read = await requireImportLeadsRead(request, projectId);
  if (read instanceof NextResponse) return read;
  if (!read.canEdit) return NextResponse.json({ error: "无权修改该项目" }, { status: 403 });
  return read;
}

/** 读请求体（文字上限略高于导入上限，超出的照导入上限的说法回） */
export async function readJsonBody(request: NextRequest, maxBytes: number): Promise<Record<string, unknown> | "TOO_LARGE" | null> {
  const raw = await request.text().catch(() => "");
  if (new TextEncoder().encode(raw).length > maxBytes) return "TOO_LARGE";
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
