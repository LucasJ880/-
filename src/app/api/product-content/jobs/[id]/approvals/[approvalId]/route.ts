/**
 * POST /api/product-content/jobs/[id]/approvals/[approvalId]
 */

import { NextResponse } from "next/server";
import { withAuth, safeParseBody } from "@/lib/common/api-helpers";
import { decideApproval } from "@/lib/product-content/jobs/service";
import {
  mapProductContentError,
  resolveProductContentOrg,
} from "@/lib/product-content/api-route-helpers";

export const POST = withAuth<{ id: string; approvalId: string }>(
  async (request, ctx, user) => {
    const { id: jobId, approvalId } = await ctx.params;
    const body = (await safeParseBody(request)) ?? {};
    const orgRes = await resolveProductContentOrg(
      user,
      typeof body.orgId === "string" ? body.orgId : null,
    );
    if (!orgRes.ok) return orgRes.response;

    const decision = body.decision === "rejected" ? "rejected" : "approved";
    if (body.decision !== "approved" && body.decision !== "rejected") {
      return NextResponse.json(
        { error: "decision 必须是 approved 或 rejected" },
        { status: 400 },
      );
    }

    try {
      const approval = await decideApproval({
        orgId: orgRes.orgId,
        jobId,
        userId: user.id,
        approvalId,
        decision,
        reason: typeof body.reason === "string" ? body.reason : undefined,
      });
      return NextResponse.json({ approval });
    } catch (err) {
      const mapped = mapProductContentError(err);
      if (mapped) return mapped;
      throw err;
    }
  },
);
