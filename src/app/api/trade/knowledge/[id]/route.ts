import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { updateKnowledge, deleteKnowledge } from "@/lib/trade/knowledge-service";
import { loadTradeKnowledgeForOrg, resolveTradeOrgId } from "@/lib/trade/access";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const { id } = await params;
  const loaded = await loadTradeKnowledgeForOrg(id, orgRes.orgId);
  if (loaded instanceof NextResponse) return loaded;
  return NextResponse.json(loaded.item);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json();
  const orgRes = await resolveTradeOrgId(request, auth.user, { bodyOrgId: body.orgId });
  if (!orgRes.ok) return orgRes.response;

  const { id } = await params;
  const loaded = await loadTradeKnowledgeForOrg(id, orgRes.orgId);
  if (loaded instanceof NextResponse) return loaded;

  const { orgId: _o, id: _i, ...safe } = body as Record<string, unknown>;
  const item = await updateKnowledge(id, safe);
  return NextResponse.json(item);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const { id } = await params;
  const loaded = await loadTradeKnowledgeForOrg(id, orgRes.orgId);
  if (loaded instanceof NextResponse) return loaded;

  await deleteKnowledge(id);
  return NextResponse.json({ success: true });
}
