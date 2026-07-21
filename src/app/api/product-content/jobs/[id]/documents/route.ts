/**
 * POST /api/product-content/jobs/[id]/documents
 */

import { NextResponse } from "next/server";
import { withAuth, safeParseBody } from "@/lib/common/api-helpers";
import { generateProductDocuments } from "@/lib/product-content/documents/generate";
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
    const purpose =
      typeof body.purpose === "string" ? body.purpose : undefined;
    const documents = await generateProductDocuments(
      orgRes.orgId,
      jobId,
      user.id,
      {
        formalOnly: body.formalDocuments === true,
        purpose: purpose as "INTERNAL_DRAFT" | "CUSTOMER_REVIEW" | "FORMAL_EXTERNAL" | undefined,
      },
    );
    return NextResponse.json({ documents });
  } catch (err) {
    const mapped = mapProductContentError(err);
    if (mapped) return mapped;
    throw err;
  }
});
