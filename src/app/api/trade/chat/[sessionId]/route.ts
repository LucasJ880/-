import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { resolveTradeOrgId } from "@/lib/trade/access";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const { sessionId } = await params;
  const session = await db.tradeChatSession.findFirst({
    where: { id: sessionId, userId: auth.user.id, orgId: orgRes.orgId },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!session) {
    return NextResponse.json({ error: "对话不存在" }, { status: 404 });
  }

  return NextResponse.json(session);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const { sessionId } = await params;

  const updated = await db.tradeChatSession.updateMany({
    where: { id: sessionId, userId: auth.user.id, orgId: orgRes.orgId },
    data: { status: "archived" },
  });

  if (updated.count === 0) {
    return NextResponse.json({ error: "对话不存在" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
