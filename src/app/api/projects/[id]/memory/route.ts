import { NextRequest, NextResponse } from "next/server";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { getProjectAiMemory } from "@/lib/ai/memory";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;

  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;

  const memory = await getProjectAiMemory(id);
  return NextResponse.json(memory);
}
