/**
 * GET/POST /api/product-content/jobs
 */

import { NextResponse } from "next/server";
import { withAuth, safeParseBody, queryString } from "@/lib/common/api-helpers";
import {
  createProductContentJob,
  listProductContentJobs,
} from "@/lib/product-content/jobs/service";
import {
  mapProductContentError,
  resolveProductContentOrg,
} from "@/lib/product-content/api-route-helpers";
import type { ExecutionMode } from "@/lib/product-content/types";

export const GET = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveProductContentOrg(user, queryString(request, "orgId"));
  if (!orgRes.ok) return orgRes.response;

  try {
    const jobs = await listProductContentJobs(orgRes.orgId, user.id);
    return NextResponse.json({ jobs });
  } catch (err) {
    const mapped = mapProductContentError(err);
    if (mapped) return mapped;
    throw err;
  }
});

export const POST = withAuth(async (request, _ctx, user) => {
  const body = (await safeParseBody(request)) ?? {};
  const orgRes = await resolveProductContentOrg(
    user,
    typeof body.orgId === "string" ? body.orgId : null,
  );
  if (!orgRes.ok) return orgRes.response;

  const title = String(body.title ?? "").trim();
  if (!title) {
    return NextResponse.json({ error: "title 不能为空" }, { status: 400 });
  }

  const executionMode = body.executionMode as ExecutionMode | undefined;
  if (
    executionMode &&
    executionMode !== "AUTOPILOT" &&
    executionMode !== "ALWAYS_ASK"
  ) {
    return NextResponse.json(
      { error: "executionMode 必须是 AUTOPILOT 或 ALWAYS_ASK" },
      { status: 400 },
    );
  }

  try {
    const job = await createProductContentJob({
      orgId: orgRes.orgId,
      userId: user.id,
      title,
      executionMode,
      industryPack:
        typeof body.industryPack === "string" ? body.industryPack : undefined,
      selectedSku:
        typeof body.selectedSku === "string" ? body.selectedSku : undefined,
    });
    return NextResponse.json({ job }, { status: 201 });
  } catch (err) {
    const mapped = mapProductContentError(err);
    if (mapped) return mapped;
    throw err;
  }
});
