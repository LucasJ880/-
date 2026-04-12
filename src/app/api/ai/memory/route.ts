import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  saveMemory,
  listMemories,
  updateMemory,
  deleteMemory,
  backfillEmbeddings,
  type MemoryType,
} from "@/lib/ai/user-memory";

const VALID_TYPES = new Set([
  "decision", "preference", "milestone", "problem", "insight", "fact",
]);

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const layer = searchParams.get("layer");
  const memoryType = searchParams.get("type");
  const search = searchParams.get("search");
  const limitStr = searchParams.get("limit");
  const offsetStr = searchParams.get("offset");

  const { items, total } = await listMemories(user.id, {
    layer: layer !== null ? parseInt(layer) : undefined,
    memoryType: memoryType ?? undefined,
    search: search ?? undefined,
    limit: limitStr ? parseInt(limitStr) : 50,
    offset: offsetStr ? parseInt(offsetStr) : 0,
  });

  return NextResponse.json({ memories: items, total });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = await request.json();
  const { memoryType, content, layer, tags, importance, action } = body;

  if (action === "backfill") {
    const count = await backfillEmbeddings(user.id);
    return NextResponse.json({ backfilled: count });
  }

  if (!content || typeof content !== "string" || content.trim().length < 2) {
    return NextResponse.json({ error: "内容不能为空" }, { status: 400 });
  }
  if (!VALID_TYPES.has(memoryType)) {
    return NextResponse.json(
      { error: `无效类型，可选: ${[...VALID_TYPES].join(", ")}` },
      { status: 400 },
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

export async function PATCH(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = await request.json();
  const { id, content, memoryType, layer, tags, importance } = body;

  if (!id) return NextResponse.json({ error: "缺少 id" }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (typeof content === "string" && content.trim().length >= 2) data.content = content.trim();
  if (memoryType && VALID_TYPES.has(memoryType)) data.memoryType = memoryType;
  if (typeof layer === "number" && layer >= 0 && layer <= 2) data.layer = layer;
  if (typeof tags === "string") data.tags = tags;
  if (typeof importance === "number" && importance >= 1 && importance <= 5) data.importance = importance;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "无有效更新字段" }, { status: 400 });
  }

  try {
    const updated = await updateMemory(user.id, id, data as Parameters<typeof updateMemory>[2]);
    return NextResponse.json({ memory: updated });
  } catch {
    return NextResponse.json({ error: "更新失败" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) return NextResponse.json({ error: "缺少 id 参数" }, { status: 400 });

  try {
    await deleteMemory(user.id, id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "删除失败" }, { status: 500 });
  }
}
