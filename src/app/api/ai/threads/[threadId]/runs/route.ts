/**
 * GET /api/ai/threads/[threadId]/runs
 * 按 metadata.threadId + 当前 org 恢复助手任务 Run（七态 DTO）
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import {
  findOwnedThreadInOrg,
  resolveAssistantOrgId,
  threadNotFoundResponse,
} from "@/lib/assistant/thread-org";
import { listAssistantRunsForThread } from "@/lib/assistant/run-status";

export const GET = withAuth(async (request, ctx, user) => {
  const { threadId } = await ctx.params;
  const orgRes = await resolveAssistantOrgId(request, user);
  if (!orgRes.ok) return orgRes.response;

  const thread = await findOwnedThreadInOrg(threadId, user.id, orgRes.orgId, {
    id: true,
  });
  if (!thread) return threadNotFoundResponse();

  const runs = await listAssistantRunsForThread({
    orgId: orgRes.orgId,
    threadId,
    userId: user.id,
    take: 10,
  });

  return NextResponse.json({ runs, orgId: orgRes.orgId });
});
