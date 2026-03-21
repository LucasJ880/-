import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectReadAccess } from "@/lib/projects/access";

type Ctx = { params: Promise<{ id: string; agentId: string; versionId: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const { id: projectId, agentId, versionId } = await ctx.params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const agent = await db.agent.findFirst({ where: { id: agentId, projectId } });
  if (!agent) return NextResponse.json({ error: "Agent 不存在" }, { status: 404 });

  const version = await db.agentVersion.findFirst({
    where: { id: versionId, agentId },
    include: { createdBy: { select: { id: true, name: true } } },
  });
  if (!version) return NextResponse.json({ error: "版本不存在" }, { status: 404 });

  let configSnapshot = null;
  try {
    configSnapshot = JSON.parse(version.configSnapshotJson);
  } catch {
    configSnapshot = version.configSnapshotJson;
  }

  return NextResponse.json({
    version: {
      id: version.id,
      version: version.version,
      configSnapshot,
      changeNote: version.changeNote,
      createdBy: version.createdBy,
      createdAt: version.createdAt,
    },
  });
}
