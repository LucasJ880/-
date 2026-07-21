/**
 * GET/PATCH /api/product-content/jobs/[id]
 */

import { NextResponse } from "next/server";
import { withAuth, queryString, safeParseBody } from "@/lib/common/api-helpers";
import {
  getProductContentJobDetail,
  updateJobDocumentPurpose,
} from "@/lib/product-content/jobs/service";
import {
  mapProductContentError,
  resolveProductContentOrg,
} from "@/lib/product-content/api-route-helpers";

export const GET = withAuth<{ id: string }>(async (request, ctx, user) => {
  const { id } = await ctx.params;
  const orgRes = await resolveProductContentOrg(user, queryString(request, "orgId"));
  if (!orgRes.ok) return orgRes.response;

  try {
    const job = await getProductContentJobDetail(orgRes.orgId, id, user.id);
    return NextResponse.json({ job });
  } catch (err) {
    const mapped = mapProductContentError(err);
    if (mapped) return mapped;
    throw err;
  }
});

export const PATCH = withAuth<{ id: string }>(async (request, ctx, user) => {
  const { id: jobId } = await ctx.params;
  const body = (await safeParseBody(request)) ?? {};
  const orgRes = await resolveProductContentOrg(
    user,
    typeof body.orgId === "string" ? body.orgId : null,
  );
  if (!orgRes.ok) return orgRes.response;

  try {
    if (typeof body.documentPurpose === "string") {
      const job = await updateJobDocumentPurpose({
        orgId: orgRes.orgId,
        userId: user.id,
        jobId,
        documentPurpose: body.documentPurpose,
      });
      return NextResponse.json({ job });
    }
    return NextResponse.json({ error: "未提供可更新字段" }, { status: 400 });
  } catch (err) {
    const mapped = mapProductContentError(err);
    if (mapped) return mapped;
    throw err;
  }
});
