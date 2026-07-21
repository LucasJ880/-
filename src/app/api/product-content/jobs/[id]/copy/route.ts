/**
 * POST/PATCH /api/product-content/jobs/[id]/copy
 */

import { NextResponse } from "next/server";
import { withAuth, safeParseBody } from "@/lib/common/api-helpers";
import type { AuthUser } from "@/lib/auth";
import { generateProductCopy } from "@/lib/product-content/copy/generate";
import { updateProductCopyFields } from "@/lib/product-content/jobs/service";
import {
  mapProductContentError,
  resolveProductContentOrg,
} from "@/lib/product-content/api-route-helpers";

async function resolveOrgFromBody(user: AuthUser, body: Record<string, unknown>) {
  return resolveProductContentOrg(
    user,
    typeof body.orgId === "string" ? body.orgId : null,
  );
}

export const POST = withAuth<{ id: string }>(async (request, ctx, user) => {
  const { id: jobId } = await ctx.params;
  const body = (await safeParseBody(request)) ?? {};
  const orgRes = await resolveOrgFromBody(user, body);
  if (!orgRes.ok) return orgRes.response;

  try {
    const copy = await generateProductCopy(orgRes.orgId, jobId, user.id);
    return NextResponse.json({ copy });
  } catch (err) {
    const mapped = mapProductContentError(err);
    if (mapped) return mapped;
    throw err;
  }
});

export const PATCH = withAuth<{ id: string }>(async (request, ctx, user) => {
  const { id: jobId } = await ctx.params;
  const body = (await safeParseBody(request)) ?? {};
  const orgRes = await resolveOrgFromBody(user, body);
  if (!orgRes.ok) return orgRes.response;

  try {
    const copy = await updateProductCopyFields({
      orgId: orgRes.orgId,
      userId: user.id,
      jobId,
      patch: body,
      action:
        body.action === "lock" ||
        body.action === "unlock" ||
        body.action === "approve"
          ? body.action
          : undefined,
    });
    return NextResponse.json({ copy });
  } catch (err) {
    const mapped = mapProductContentError(err);
    if (mapped) return mapped;
    throw err;
  }
});
