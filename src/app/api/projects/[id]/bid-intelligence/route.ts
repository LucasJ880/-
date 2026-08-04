import { NextRequest, NextResponse } from "next/server";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { db } from "@/lib/db";

/**
 * GET /api/projects/[id]/bid-intelligence
 * 读取调查室（不存在时 404，不自动创建）
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;

  try {
    const room = await db.bidIntelligenceRoom.findUnique({
      where: { projectId: id },
      include: {
        modules: { orderBy: { sortOrder: "asc" } },
        facts: {
          orderBy: { extractedAt: "desc" },
          take: 50,
        },
      },
    });
    if (!room) {
      return NextResponse.json({ room: null }, { status: 200 });
    }
    return NextResponse.json({ room });
  } catch (err) {
    // 表未迁移时仍允许项目页打开
    console.error("[bid-intelligence GET]", err);
    return NextResponse.json({
      room: null,
      unavailable: true,
      error: "调查室数据暂不可用",
    });
  }
}
