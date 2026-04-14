import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { recordAdoption } from "@/lib/sales/coaching-service";

export const PATCH = withAuth(async (request, ctx, user) => {
  const { id } = await ctx.params;
  const body = await request.json();

  if (typeof body.adopted === "boolean") {
    await recordAdoption(id, body.adopted);
    return NextResponse.json({ success: true, adopted: body.adopted });
  }

  return NextResponse.json({ error: "需要 adopted: boolean" }, { status: 400 });
});
