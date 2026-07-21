/**
 * POST /api/product-content/jobs/[id]/inputs
 */

import { NextResponse } from "next/server";
import { withAuth, safeParseBody } from "@/lib/common/api-helpers";
import { addJobInput } from "@/lib/product-content/jobs/service";
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

  const inputType = String(body.inputType ?? "").trim();
  if (!inputType) {
    return NextResponse.json({ error: "inputType 不能为空" }, { status: 400 });
  }

  try {
    const input = await addJobInput({
      orgId: orgRes.orgId,
      userId: user.id,
      jobId,
      inputType,
      blobPathname:
        typeof body.blobPathname === "string" ? body.blobPathname : undefined,
      mimeType: typeof body.mimeType === "string" ? body.mimeType : undefined,
      fileName: typeof body.fileName === "string" ? body.fileName : undefined,
      textContent:
        typeof body.textContent === "string" ? body.textContent : undefined,
      url: typeof body.url === "string" ? body.url : undefined,
      purpose: typeof body.purpose === "string" ? body.purpose : undefined,
      transcriptText:
        typeof body.transcriptText === "string" ? body.transcriptText : undefined,
    });
    return NextResponse.json({ input }, { status: 201 });
  } catch (err) {
    const mapped = mapProductContentError(err);
    if (mapped) return mapped;
    throw err;
  }
});
