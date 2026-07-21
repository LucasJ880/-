/**
 * POST /api/product-content/jobs/[id]/visuals/[outputId]/regenerate
 */

import { NextResponse } from "next/server";
import { withAuth, safeParseBody } from "@/lib/common/api-helpers";
import { regenerateVisualOutput } from "@/lib/product-content/jobs/runtime";
import {
  mapProductContentError,
  resolveProductContentOrg,
} from "@/lib/product-content/api-route-helpers";

export const POST = withAuth<{ id: string; outputId: string }>(
  async (request, ctx, user) => {
    const { id: jobId, outputId } = await ctx.params;
    const body = (await safeParseBody(request)) ?? {};
    const orgRes = await resolveProductContentOrg(
      user,
      typeof body.orgId === "string" ? body.orgId : null,
    );
    if (!orgRes.ok) return orgRes.response;

    try {
      const result = await regenerateVisualOutput({
        orgId: orgRes.orgId,
        jobId,
        userId: user.id,
        outputId,
        dryRunVisuals: body.dryRunVisuals === true,
      });
      return NextResponse.json(result);
    } catch (err) {
      const mapped = mapProductContentError(err);
      if (mapped) return mapped;
      throw err;
    }
  },
);
