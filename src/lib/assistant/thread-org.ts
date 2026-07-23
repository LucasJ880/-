/**
 * Phase 3B-A：AiThread 租户解析与访问控制
 *
 * - 可信 orgId 仅来自服务端 activeOrg（或唯一 membership fallback）
 * - query.orgId / body.orgId 只作交叉校验，不得选组织
 * - 跨组织 threadId → 404（不暴露存在性）
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { AuthUser } from "@/lib/auth";
import { getOrgMembership } from "@/lib/auth";
import { db } from "@/lib/db";
import { getUserActiveOrgId } from "@/lib/organizations/active-org";

export type AssistantOrgResolution =
  | { ok: true; orgId: string }
  | { ok: false; response: NextResponse };

export type TrustedAssistantOrgResult =
  | { ok: true; orgId: string }
  | {
      ok: false;
      code: "NO_MEMBERSHIP" | "TENANT_CONTEXT_REQUIRED" | "ORG_CONTEXT_MISMATCH";
    };

/**
 * 纯函数：解析可信助手组织（Security-1 对齐）。
 * activeOrg 优先；query/body 仅交叉校验。
 */
export function resolveTrustedAssistantOrg(input: {
  activeOrgId: string | null;
  memberOrgIds: string[];
  queryOrgId?: string | null;
  bodyOrgId?: string | null;
}): TrustedAssistantOrgResult {
  const memberOrgIds = Array.from(
    new Set(input.memberOrgIds.filter((id) => typeof id === "string" && id)),
  );

  if (memberOrgIds.length === 0) {
    return { ok: false, code: "NO_MEMBERSHIP" };
  }

  let orgId: string | null = null;
  if (input.activeOrgId && memberOrgIds.includes(input.activeOrgId)) {
    orgId = input.activeOrgId;
  } else if (memberOrgIds.length === 1) {
    orgId = memberOrgIds[0];
  }

  if (!orgId) {
    return { ok: false, code: "TENANT_CONTEXT_REQUIRED" };
  }

  const queryOrgId = input.queryOrgId?.trim() || null;
  const bodyOrgId = input.bodyOrgId?.trim() || null;
  for (const claimed of [queryOrgId, bodyOrgId]) {
    if (claimed && claimed !== orgId) {
      return { ok: false, code: "ORG_CONTEXT_MISMATCH" };
    }
  }

  return { ok: true, orgId };
}

export function threadNotFoundResponse(): NextResponse {
  return NextResponse.json(
    { error: "对话不存在", code: "THREAD_NOT_FOUND" },
    { status: 404 },
  );
}

function rejectionResponse(
  code: Exclude<TrustedAssistantOrgResult, { ok: true }>["code"],
): NextResponse {
  if (code === "NO_MEMBERSHIP") {
    return NextResponse.json(
      { error: "未加入任何企业，无法使用助手对话", code },
      { status: 403 },
    );
  }
  if (code === "ORG_CONTEXT_MISMATCH") {
    return NextResponse.json(
      {
        error: "请求组织与当前工作组织不一致",
        code,
      },
      { status: 403 },
    );
  }
  return NextResponse.json(
    {
      error: "缺少可信组织上下文，请先选择当前企业",
      code: "TENANT_CONTEXT_REQUIRED",
    },
    { status: 403 },
  );
}

/**
 * 解析助手线程 API 的可信 orgId。
 * 仅信任服务端 activeOrg / 唯一 membership；query/body 只交叉校验。
 */
export async function resolveAssistantOrgId(
  request: NextRequest,
  user: AuthUser,
  claimedBodyOrgId?: string | null,
): Promise<AssistantOrgResolution> {
  const queryOrgId =
    request.nextUrl.searchParams.get("orgId")?.trim() || null;
  const activeOrgId = await getUserActiveOrgId(user.id);
  const memberships = await db.organizationMember.findMany({
    where: { userId: user.id, status: "active" },
    select: { orgId: true },
  });
  const memberOrgIds = memberships.map((m) => m.orgId);

  const resolved = resolveTrustedAssistantOrg({
    activeOrgId,
    memberOrgIds,
    queryOrgId,
    bodyOrgId: claimedBodyOrgId,
  });

  if (!resolved.ok) {
    return { ok: false, response: rejectionResponse(resolved.code) };
  }

  const membership = await getOrgMembership(user.id, resolved.orgId);
  if (!membership || membership.status !== "active") {
    return {
      ok: false,
      response: rejectionResponse("NO_MEMBERSHIP"),
    };
  }

  return { ok: true, orgId: resolved.orgId };
}

/** 当前组织下可见的线程（排除未归属 / 其他组织 / 已归档） */
export function visibleThreadWhere(userId: string, orgId: string) {
  return {
    userId,
    orgId,
    archived: false,
  };
}

export type FindOwnedThreadOptions = {
  /** PATCH/DELETE 管理操作可包含已归档线程；普通读写默认 false */
  includeArchived?: boolean;
};

/**
 * 按 id + userId + orgId 加载线程；找不到则 null（调用方返回 404）。
 * - 默认不返回 archived 线程（消息/详情/发送）
 * - includeArchived=true：允许管理归档/取消归档/删除
 * - 永远要求 orgId 非空匹配（orgId=null 历史线程不可经普通 API 恢复）
 */
export async function findOwnedThreadInOrg<
  TSelect extends Record<string, boolean | object>,
>(
  threadId: string,
  userId: string,
  orgId: string,
  select: TSelect,
  options?: FindOwnedThreadOptions,
) {
  return db.aiThread.findFirst({
    where: {
      id: threadId,
      userId,
      orgId,
      ...(options?.includeArchived ? {} : { archived: false }),
    },
    select,
  });
}

/** 列表/创建用的标准 where（不含归档） */
export function ownedThreadWhere(
  threadId: string,
  userId: string,
  orgId: string,
  options?: FindOwnedThreadOptions,
) {
  return {
    id: threadId,
    userId,
    orgId,
    ...(options?.includeArchived ? {} : { archived: false as const }),
  };
}

/** 归档访问策略：纯函数，供单测 */
export function threadAccessAllowsArchived(input: {
  operation: "list" | "read" | "message" | "patch" | "delete";
}): boolean {
  return input.operation === "patch" || input.operation === "delete";
}
