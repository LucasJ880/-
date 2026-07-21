/**
 * PATCH /api/product-content/jobs/[id]/facts/[factId]
 */

import { NextResponse } from "next/server";
import { withAuth, safeParseBody } from "@/lib/common/api-helpers";
import { updateProductFact } from "@/lib/product-content/jobs/service";
import {
  mapProductContentError,
  resolveProductContentOrg,
} from "@/lib/product-content/api-route-helpers";

const ACTIONS = ["confirm", "reject", "lock"] as const;

export const PATCH = withAuth<{ id: string; factId: string }>(
  async (request, ctx, user) => {
    const { factId } = await ctx.params;
    const body = (await safeParseBody(request)) ?? {};
    const orgRes = await resolveProductContentOrg(
      user,
      typeof body.orgId === "string" ? body.orgId : null,
    );
    if (!orgRes.ok) return orgRes.response;

    const action = body.action as (typeof ACTIONS)[number] | undefined;
    if (action && !ACTIONS.includes(action)) {
      return NextResponse.json(
        { error: "action 必须是 confirm / reject / lock" },
        { status: 400 },
      );
    }
    if (!action && body.value === undefined) {
      return NextResponse.json(
        { error: "请提供 action 或 value" },
        { status: 400 },
      );
    }

    try {
      const fact = await updateProductFact({
        orgId: orgRes.orgId,
        userId: user.id,
        factId,
        action,
        value: body.value,
      });
      return NextResponse.json({ fact });
    } catch (err) {
      const mapped = mapProductContentError(err);
      if (mapped) return mapped;
      throw err;
    }
  },
);
