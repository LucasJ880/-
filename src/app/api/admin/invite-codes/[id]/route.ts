import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/auth/guards";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const auth = await requireSuperAdmin(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await ctx.params;
  const body = await request.json();

  const data: Record<string, unknown> = {};
  if (body.isActive !== undefined) data.isActive = body.isActive;
  if (body.label !== undefined) data.label = body.label?.trim() || null;
  if (body.maxUses !== undefined) data.maxUses = body.maxUses;
  if (body.expiresAt !== undefined) {
    data.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
  }

  try {
    const updated = await db.inviteCode.update({
      where: { id },
      data,
    });
    return NextResponse.json({ inviteCode: updated });
  } catch {
    return NextResponse.json({ error: "邀请码不存在" }, { status: 404 });
  }
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const auth = await requireSuperAdmin(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await ctx.params;

  try {
    await db.inviteCode.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "邀请码不存在" }, { status: 404 });
  }
}
