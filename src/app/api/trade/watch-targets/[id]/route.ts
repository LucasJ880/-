/**
 * PATCH /api/trade/watch-targets/[id]?orgId=
 * DELETE /api/trade/watch-targets/[id]?orgId=
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { deleteWatchTarget, setWatchTargetActive } from "@/lib/trade/watch-service";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const orgId = new URL(request.url).searchParams.get("orgId");
  if (!orgId) {
    return NextResponse.json({ error: "缺少 orgId" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  if (typeof body?.isActive !== "boolean") {
    return NextResponse.json({ error: "需要 isActive: boolean" }, { status: 400 });
  }

  try {
    const row = await setWatchTargetActive(orgId, id, body.isActive);
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

  const { id } = await params;
  const orgId = new URL(request.url).searchParams.get("orgId");
  if (!orgId) {
    return NextResponse.json({ error: "缺少 orgId" }, { status: 400 });
  }

  try {
    await deleteWatchTarget(orgId, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "删除失败";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
