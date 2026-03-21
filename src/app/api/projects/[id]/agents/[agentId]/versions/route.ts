import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectReadAccess } from "@/lib/projects/access";

type Ctx = { params: Promise<{ id: string; agentId: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const { id: projectId, agentId } = await ctx.params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const agent = await db.agent.findFirst({ where: { id: agentId, projectId } });
  if (!agent) return NextResponse.json({ error: "Agent 不存在" }, { status: 404 });

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") ?? "20", 10) || 20));

  const [total, versions] = await Promise.all([
    db.agentVersion.count({ where: { agentId } }),
    db.agentVersion.findMany({
      where: { agentId },
      include: { createdBy: { select: { id: true, name: true } } },
      orderBy: { version: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return NextResponse.json({
    versions: versions.map((v) => ({
      id: v.id,
      version: v.version,
      changeNote: v.changeNote,
      createdBy: v.createdBy,
      createdAt: v.createdAt,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}
