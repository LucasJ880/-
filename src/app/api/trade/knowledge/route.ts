import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { listKnowledge, createKnowledge } from "@/lib/trade/knowledge-service";
import { resolveTradeOrgId } from "@/lib/trade/access";

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category") ?? undefined;

  const items = await listKnowledge(orgRes.orgId, { category });
  return NextResponse.json(items);
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json();
  const orgRes = await resolveTradeOrgId(request, auth.user, { bodyOrgId: body.orgId });
  if (!orgRes.ok) return orgRes.response;

  if (!body.title || !body.content || !body.category) {
    return NextResponse.json({ error: "title, content, category 必填" }, { status: 400 });
  }

  const item = await createKnowledge({
    orgId: orgRes.orgId,
    category: body.category,
    title: body.title,
    content: body.content,
    tags: body.tags,
    language: body.language ?? "zh",
    createdById: auth.user.id,
  });
  return NextResponse.json(item, { status: 201 });
}
