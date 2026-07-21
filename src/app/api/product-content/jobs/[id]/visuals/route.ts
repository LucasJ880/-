/**
 * GET/POST /api/product-content/jobs/[id]/visuals
 */

import { NextResponse } from "next/server";
import { withAuth, safeParseBody, queryString } from "@/lib/common/api-helpers";
import { listJobVisuals } from "@/lib/product-content/jobs/service";
import {
  mapProductContentError,
  resolveProductContentOrg,
} from "@/lib/product-content/api-route-helpers";

export const GET = withAuth<{ id: string }>(async (request, ctx, user) => {
  const { id: jobId } = await ctx.params;
  const orgRes = await resolveProductContentOrg(user, queryString(request, "orgId"));
  if (!orgRes.ok) return orgRes.response;

  try {
    const visualJobs = await listJobVisuals(orgRes.orgId, jobId, user.id);
    return NextResponse.json({ visualJobs });
  } catch (err) {
    const mapped = mapProductContentError(err);
    if (mapped) return mapped;
    throw err;
  }
});

export const POST = GET;
