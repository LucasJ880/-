/**
 * CHAIN-3 进口线索接口的权限（判定顺序固定）：
 *   未登录 401 → 不能读本项目、或不是该组织有效成员（平台超级管理员除外）404 → 开关关 404 → 写接口不能修改本项目 403；
 *   CHAIN-3c：「是不是同一家」的裁决与撤回只限组织管理员（含组织所有者；平台超级管理员按既有规则），其他人 403。
 * 项目读 / 写权限本身不看组织成员身份（项目负责人、项目成员记录都能单独放行），这里补上。
 */

import { NextRequest, NextResponse } from "next/server";
import { requireProjectReadAccess, requireProjectWriteAccess, type ProjectAccessContext } from "@/lib/projects/access";
import { hasOrgRole, isSuperAdmin } from "@/lib/rbac/roles";
import { isImportLeadsEnabledForOrg } from "./flags";
import { IMPORT_LEADS_TEXT } from "./aggregate-pure";

export const NO_STORE = { "Cache-Control": "private, no-store" } as const;
const notFound = () => NextResponse.json({ error: "项目不存在" }, { status: 404, headers: NO_STORE });

export type ImportLeadsAccess = { access: ProjectAccessContext; orgId: string; canEdit: boolean; canDecideAliases: boolean };

/** CHAIN-3c：组织管理员 = 平台超级管理员；或本组织有效成员且组织角色不低于 org_admin（与授标记录的确认 / 撤回同一口径） */
export function isOrgAdminFor(access: Pick<ProjectAccessContext, "user" | "orgRole">): boolean {
  return isSuperAdmin(access.user.role) || (!!access.orgRole && hasOrgRole(access.orgRole, "org_admin"));
}

export async function requireImportLeadsRead(request: NextRequest, projectId: string): Promise<ImportLeadsAccess | NextResponse> {
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access.status === 401 ? access : notFound();
  if (!isSuperAdmin(access.user.role) && !access.orgRole) return notFound();
  const orgId = access.project.orgId;
  if (!orgId || !isImportLeadsEnabledForOrg(orgId)) return notFound();
  const write = await requireProjectWriteAccess(request, projectId);
  return { access, orgId, canEdit: !(write instanceof NextResponse), canDecideAliases: isOrgAdminFor(access) };
}

export async function requireImportLeadsWrite(request: NextRequest, projectId: string): Promise<ImportLeadsAccess | NextResponse> {
  const read = await requireImportLeadsRead(request, projectId);
  if (read instanceof NextResponse) return read;
  if (!read.canEdit) return NextResponse.json({ error: "无权修改该项目" }, { status: 403, headers: NO_STORE });
  return read;
}

/** CHAIN-3c：裁决与撤回——读权限门之后只看是不是组织管理员 */
export async function requireImportLeadsAliasDecide(request: NextRequest, projectId: string): Promise<ImportLeadsAccess | NextResponse> {
  const read = await requireImportLeadsRead(request, projectId);
  if (read instanceof NextResponse) return read;
  if (!read.canDecideAliases) return NextResponse.json({ error: IMPORT_LEADS_TEXT.notOrgAdmin, code: "NOT_ORG_ADMIN" }, { status: 403, headers: NO_STORE });
  return read;
}

/** 读请求体（文字上限略高于导入上限，超出的照导入上限的说法回） */
export async function readJsonBody(request: NextRequest, maxBytes: number): Promise<Record<string, unknown> | "TOO_LARGE" | null> {
  // 先看声明的长度，超了不读（避免把几百 MB 读进内存）；没声明的照读，读完再按字节数判
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) return "TOO_LARGE";
  // 没声明长度（分块上传）的边读边数，超了就停
  let raw = "";
  const reader = request.body?.getReader();
  if (reader) {
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
      if (done || !value) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return "TOO_LARGE";
      }
      chunks.push(value);
    }
    raw = new TextDecoder().decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
  }
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
