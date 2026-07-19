import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import {
  requireProjectReadAccess,
  requireProjectWriteAccess,
} from "@/lib/projects/access";
import {
  listProjectSimilaritiesForApi,
  recomputeProjectSimilarities,
} from "@/lib/projects/similarity";

export const GET = withAuth(async (request, ctx) => {
  const { id: projectId } = await ctx.params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const items = await listProjectSimilaritiesForApi(projectId);
  return NextResponse.json({ similarities: items });
});

export const POST = withAuth(async (request, ctx, user) => {
  const { id: projectId } = await ctx.params;
  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const count = await recomputeProjectSimilarities({
    projectId,
    userId: user.id,
    role: user.role,
  });
  const items = await listProjectSimilaritiesForApi(projectId);
  return NextResponse.json({ count, similarities: items });
});
