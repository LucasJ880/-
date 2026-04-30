/**
 * PATCH /api/trade/watch-targets/[id]?orgId=
 * DELETE /api/trade/watch-targets/[id]?orgId=
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { deleteWatchTarget, setWatchTargetActive } from "@/lib/trade/watch-service";
import { db } from "@/lib/db";
import { resolveTradeOrgId } from "@/lib/trade/access";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => null);
  const orgRes = await resolveTradeOrgId(request, auth.user, { bodyOrgId: body?.orgId });
  if (!orgRes.ok) return orgRes.response;

  const { id } = await params;
  if (typeof body?.isActive !== "boolean") {
    return NextResponse.json({ error: "需要 isActive: boolean" }, { status: 400 });
  }

  const t = await db.tradeWatchTarget.findFirst({
    where: { id, orgId: orgRes.orgId },
    select: { id: true },
  });
  if (!t) {
    return NextResponse.json({ error: "监控目标不存在" }, { status: 404 });
  }

  try {
    const row = await setWatchTargetActive(orgRes.orgId, id, body.isActive);
    return NextResponse.json({ item: row });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "更新失败";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const { id } = await params;

  const t = await db.tradeWatchTarget.findFirst({
    where: { id, orgId: orgRes.orgId },
    select: { id: true },
  });
  if (!t) {
    return NextResponse.json({ error: "监控目标不存在" }, { status: 404 });
  }

  try {
    await deleteWatchTarget(orgRes.orgId, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "删除失败";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
