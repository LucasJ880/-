/**
 * POST /api/product-content/jobs/[id]/generate-suite
 * body: { orgId?, suiteId, aspectRatio?, resolution?, dryRun? }
 */

import { NextResponse } from "next/server";
import { withAuth, safeParseBody } from "@/lib/common/api-helpers";
import {
  mapProductContentError,
  resolveProductContentOrg,
} from "@/lib/product-content/api-route-helpers";
import {
  isAspectRatio,
  isResolution,
  runVisualTemplateSuite,
} from "@/lib/product-content/templates";

export const maxDuration = 300;

export const POST = withAuth<{ id: string }>(async (request, ctx, user) => {
  const { id: jobId } = await ctx.params;
  const body = (await safeParseBody(request)) ?? {};
  const orgRes = await resolveProductContentOrg(
    user,
    typeof body.orgId === "string" ? body.orgId : null,
  );
  if (!orgRes.ok) return orgRes.response;

  const suiteId =
    typeof body.suiteId === "string" && body.suiteId.trim()
      ? body.suiteId.trim()
      : "";
  if (!suiteId) {
    return NextResponse.json({ error: "缺少 suiteId" }, { status: 400 });
  }

  const aspectRatio = isAspectRatio(body.aspectRatio)
    ? body.aspectRatio
    : undefined;
  const resolution = isResolution(body.resolution)
    ? body.resolution
    : undefined;

  try {
    const result = await runVisualTemplateSuite({
      orgId: orgRes.orgId,
      jobId,
      userId: user.id,
      suiteId,
      aspectRatio,
      resolution,
      dryRun: body.dryRun === true,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const mapped = mapProductContentError(err);
    if (mapped) return mapped;
    throw err;
  }
});
