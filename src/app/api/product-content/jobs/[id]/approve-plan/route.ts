/**
 * POST /api/product-content/jobs/[id]/approve-plan
 */

import { NextResponse } from "next/server";
import { withAuth, safeParseBody } from "@/lib/common/api-helpers";
import {
  approveExecutionPlan,
  decideApproval,
} from "@/lib/product-content/jobs/service";
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
    if (typeof body.approvalId === "string" && body.decision) {
      const decision = body.decision === "rejected" ? "rejected" : "approved";
      await decideApproval({
        orgId: orgRes.orgId,
        jobId,
        userId: user.id,
        approvalId: body.approvalId,
        decision,
        reason: typeof body.reason === "string" ? body.reason : undefined,
      });
      if (decision === "rejected") {
        return NextResponse.json({ status: "rejected" });
      }
    }

    const job = await approveExecutionPlan({
      orgId: orgRes.orgId,
      jobId,
      userId: user.id,
    });
    return NextResponse.json({ job });
  } catch (err) {
    const mapped = mapProductContentError(err);
    if (mapped) return mapped;
    throw err;
  }
});
