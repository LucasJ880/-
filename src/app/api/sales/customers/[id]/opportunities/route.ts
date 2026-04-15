import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { getActiveOpportunities } from "@/lib/sales/opportunity-lifecycle";

export const GET = withAuth(async (_request, ctx) => {
  const { id } = await ctx.params;
  const opportunities = await getActiveOpportunities(id);

  return NextResponse.json({ opportunities });
});
