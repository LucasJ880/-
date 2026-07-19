import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { reviewMarketSignal } from "@/lib/market-intelligence/service";

export const PATCH = withAuth<{ id: string }>(async (request, ctx, user) => {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const orgRes = await resolveRequestOrgIdForUser(
    user,
    typeof body?.orgId === "string" ? body.orgId : null,
  );
  if (!orgRes.ok) return orgRes.response;
  if (body?.status !== "reviewed" && body?.status !== "dismissed") {
    return NextResponse.json({ error: "status 必须为 reviewed 或 dismissed" }, { status: 400 });
  }
  const { id } = await ctx.params;
  try {
    const result = await reviewMarketSignal({
      orgId: orgRes.orgId,
      signalId: id,
      userId: user.id,
      status: body.status,
      note: typeof body.note === "string" ? body.note : undefined,
      sendToContent:
        typeof body.sendToContent === "boolean" ? body.sendToContent : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "审核失败" },
      { status: 400 },
    );
  }
});
