/**
 * Phase 3B-A：AiThread 租户解析与访问控制
 *
 * - orgId 以服务端 activeOrg / query / 唯一 membership 为准
 * - body.orgId 仅交叉校验
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

export function threadNotFoundResponse(): NextResponse {
  return NextResponse.json(
    { error: "对话不存在", code: "THREAD_NOT_FOUND" },
    { status: 404 },
  );
}

/**
 * 解析助手线程 API 的可信 orgId。
 * 顺序：query.orgId（须 membership）→ activeOrgId → 唯一 membership。
 */
export async function resolveAssistantOrgId(
  request: NextRequest,
  user: AuthUser,
  claimedBodyOrgId?: string | null,
): Promise<AssistantOrgResolution> {
  const queryOrg = request.nextUrl.searchParams.get("orgId")?.trim() || null;
  const activeOrg = await getUserActiveOrgId(user.id);
  const memberships = await db.organizationMember.findMany({
    where: { userId: user.id, status: "active" },
    select: { orgId: true },
  });
  const memberOrgIds = memberships.map((m) => m.orgId);

  if (memberOrgIds.length === 0) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "未加入任何企业，无法使用助手对话", code: "NO_MEMBERSHIP" },
        { status: 403 },
      ),
    };
  }

  let orgId: string | null = null;
  if (queryOrg && memberOrgIds.includes(queryOrg)) {
    orgId = queryOrg;
  } else if (activeOrg && memberOrgIds.includes(activeOrg)) {
    orgId = activeOrg;
  } else if (memberOrgIds.length === 1) {
    orgId = memberOrgIds[0];
  }

  if (!orgId) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "缺少可信组织上下文，请先选择当前企业",
          code: "TENANT_CONTEXT_REQUIRED",
        },
        { status: 403 },
      ),
    };
  }

  const claimed = claimedBodyOrgId?.trim() || null;
  if (claimed && claimed !== orgId) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "请求组织与当前工作组织不一致",
          code: "ORG_CONTEXT_MISMATCH",
        },
        { status: 403 },
      ),
    };
  }

  const membership = await getOrgMembership(user.id, orgId);
  if (!membership || membership.status !== "active") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "无权以企业成员身份访问助手对话", code: "NO_MEMBERSHIP" },
        { status: 403 },
      ),
    };
  }

  return { ok: true, orgId };
}

/** 当前组织下可见的线程（排除未归属 / 其他组织 / 已归档） */
export function visibleThreadWhere(userId: string, orgId: string) {
  return {
    userId,
    orgId,
    archived: false,
  };
}

/**
 * 按 id + userId + orgId 加载线程；找不到则 null（调用方返回 404）。
 * 不返回 orgId=null / archived 历史线程。
 */
export async function findOwnedThreadInOrg<
  TSelect extends Record<string, boolean | object>,
>(threadId: string, userId: string, orgId: string, select: TSelect) {
  return db.aiThread.findFirst({
    where: {
      id: threadId,
      userId,
      orgId,
      archived: false,
    },
    select,
  });
}

/** 列表/创建用的标准 where */
export function ownedThreadWhere(
  threadId: string,
  userId: string,
  orgId: string,
) {
  return {
    id: threadId,
    userId,
    orgId,
    archived: false as const,
  };
}
