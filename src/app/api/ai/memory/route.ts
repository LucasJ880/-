import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
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

export const GET = withAuth(async (request, _ctx, user) => {
  const { searchParams } = new URL(request.url);
  const orgRes = await resolveRequestOrgIdForUser(
    user,
    searchParams.get("orgId"),
  );
  if (!orgRes.ok) return orgRes.response;

  const layer = searchParams.get("layer");
  const memoryType = searchParams.get("type");
  const search = searchParams.get("search");
  const limitStr = searchParams.get("limit");
  const offsetStr = searchParams.get("offset");

  const { items, total } = await listMemories(user.id, orgRes.orgId, {
    layer: layer !== null ? parseInt(layer) : undefined,
    memoryType: memoryType ?? undefined,
    search: search ?? undefined,
    limit: limitStr ? parseInt(limitStr) : 50,
    offset: offsetStr ? parseInt(offsetStr) : 0,
  });

  return NextResponse.json({ memories: items, total, orgId: orgRes.orgId });
});

export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json();
  const orgRes = await resolveRequestOrgIdForUser(
    user,
    body.orgId ?? new URL(request.url).searchParams.get("orgId"),
  );
  if (!orgRes.ok) return orgRes.response;

  const { memoryType, content, layer, tags, importance, action } = body;

  if (action === "backfill") {
    const count = await backfillEmbeddings(user.id, orgRes.orgId);
    return NextResponse.json({ backfilled: count, orgId: orgRes.orgId });
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
    orgId: orgRes.orgId,
    userId: user.id,
    memoryType: memoryType as MemoryType,
    content: content.trim(),
    layer: typeof layer === "number" ? layer : 1,
    tags: typeof tags === "string" ? tags : undefined,
    importance: typeof importance === "number" ? importance : 3,
  });

  return NextResponse.json(
    { id: record.id, orgId: orgRes.orgId },
    { status: 201 },
  );
});

export const PATCH = withAuth(async (request, _ctx, user) => {
  const body = await request.json();
  const orgRes = await resolveRequestOrgIdForUser(
    user,
    body.orgId ?? new URL(request.url).searchParams.get("orgId"),
  );
  if (!orgRes.ok) return orgRes.response;

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
    const updated = await updateMemory(
      user.id,
      orgRes.orgId,
      id,
      data as Parameters<typeof updateMemory>[3],
    );
    return NextResponse.json({ memory: updated });
  } catch {
    return NextResponse.json({ error: "更新失败" }, { status: 500 });
  }
});

export const DELETE = withAuth(async (request, _ctx, user) => {
  const { searchParams } = new URL(request.url);
  const orgRes = await resolveRequestOrgIdForUser(
    user,
    searchParams.get("orgId"),
  );
  if (!orgRes.ok) return orgRes.response;

  const id = searchParams.get("id");

  if (!id) return NextResponse.json({ error: "缺少 id 参数" }, { status: 400 });

  try {
    await deleteMemory(user.id, orgRes.orgId, id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "删除失败" }, { status: 500 });
  }
});
