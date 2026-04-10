import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { saveMemory, type MemoryType } from "@/lib/ai";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const layer = searchParams.get("layer");
  const memoryType = searchParams.get("type");

  const where: Record<string, unknown> = { userId: user.id };
  if (layer !== null) where.layer = parseInt(layer);
  if (memoryType) where.memoryType = memoryType;

  const memories = await db.userMemory.findMany({
    where,
    orderBy: [{ layer: "asc" }, { importance: "desc" }, { updatedAt: "desc" }],
    take: 50,
    select: {
      id: true,
      memoryType: true,
      layer: true,
      content: true,
      tags: true,
      importance: true,
      accessCount: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ memories });
}

const VALID_TYPES = new Set([
  "decision", "preference", "milestone", "problem", "insight", "fact",
]);

export async function POST(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = await request.json();
  const { memoryType, content, layer, tags, importance } = body;

  if (!content || typeof content !== "string" || content.trim().length < 2) {
    return NextResponse.json({ error: "内容不能为空" }, { status: 400 });
  }
  if (!VALID_TYPES.has(memoryType)) {
    return NextResponse.json(
      { error: `无效类型，可选: ${[...VALID_TYPES].join(", ")}` },
      { status: 400 }
    );
  }

  const record = await saveMemory({
    userId: user.id,
    memoryType: memoryType as MemoryType,
    content: content.trim(),
    layer: typeof layer === "number" ? layer : 1,
    tags: typeof tags === "string" ? tags : undefined,
    importance: typeof importance === "number" ? importance : 3,
  });

  return NextResponse.json({ id: record.id }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "缺少 id 参数" }, { status: 400 });
  }

  const memory = await db.userMemory.findUnique({
    where: { id },
    select: { userId: true },
  });

  if (!memory || memory.userId !== user.id) {
    return NextResponse.json({ error: "记忆不存在" }, { status: 404 });
  }

  await db.userMemory.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
