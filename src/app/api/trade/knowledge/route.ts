import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { listKnowledge, createKnowledge } from "@/lib/trade/knowledge-service";

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get("orgId") ?? "default";
  const category = searchParams.get("category") ?? undefined;

  const items = await listKnowledge(orgId, { category });
  return NextResponse.json(items);
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json();
  if (!body.title || !body.content || !body.category) {
    return NextResponse.json({ error: "title, content, category 必填" }, { status: 400 });
  }

  const item = await createKnowledge({
    orgId: body.orgId ?? "default",
    category: body.category,
    title: body.title,
    content: body.content,
    tags: body.tags,
    language: body.language ?? "zh",
    createdById: auth.user.id,
  });
  return NextResponse.json(item, { status: 201 });
}
