import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { recordAdoption } from "@/lib/sales/coaching-service";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await ctx.params;
  const body = await request.json();

  if (typeof body.adopted === "boolean") {
    await recordAdoption(id, body.adopted);
    return NextResponse.json({ success: true, adopted: body.adopted });
  }

  return NextResponse.json({ error: "需要 adopted: boolean" }, { status: 400 });
}
