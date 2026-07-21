/**
 * PATCH /api/product-content/jobs/[id]/visuals/[outputId]
 */

import { NextResponse } from "next/server";
import { withAuth, safeParseBody } from "@/lib/common/api-helpers";
import { updateVisualOutput } from "@/lib/product-content/jobs/service";
import {
  mapProductContentError,
  resolveProductContentOrg,
} from "@/lib/product-content/api-route-helpers";

const ACTIONS = ["approve", "reject", "lock", "unlock"] as const;

export const PATCH = withAuth<{ id: string; outputId: string }>(
  async (request, ctx, user) => {
    const { outputId } = await ctx.params;
    const body = (await safeParseBody(request)) ?? {};
    const orgRes = await resolveProductContentOrg(
      user,
      typeof body.orgId === "string" ? body.orgId : null,
    );
    if (!orgRes.ok) return orgRes.response;

    const action = body.action as (typeof ACTIONS)[number];
    if (!ACTIONS.includes(action)) {
      return NextResponse.json(
        { error: "action 必须是 approve / reject / lock / unlock" },
        { status: 400 },
      );
    }

    try {
      const output = await updateVisualOutput({
        orgId: orgRes.orgId,
        userId: user.id,
        outputId,
        action,
      });
      return NextResponse.json({ output });
    } catch (err) {
      const mapped = mapProductContentError(err);
      if (mapped) return mapped;
      throw err;
    }
  },
);
