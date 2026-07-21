/**
 * POST /api/product-content/jobs/[id]/analyze
 */

import { NextResponse } from "next/server";
import { withAuth, safeParseBody } from "@/lib/common/api-helpers";
import { analyzeJobInputs } from "@/lib/product-content/intake/analyze";
import {
  mapProductContentError,
  resolveProductContentOrg,
} from "@/lib/product-content/api-route-helpers";

export const POST = withAuth<{ id: string }>(async (request, ctx, user) => {
  const { id: jobId } = await ctx.params;
  const body = (await safeParseBody(request)) ?? {};
  const orgRes = await resolveProductContentOrg(
    user,
    typeof body.orgId === "string" ? body.orgId : null,
  );
  if (!orgRes.ok) return orgRes.response;

  try {
    const result = await analyzeJobInputs(orgRes.orgId, jobId, user.id);
    return NextResponse.json(result);
  } catch (err) {
    const mapped = mapProductContentError(err);
    if (mapped) return mapped;
    throw err;
  }
});
