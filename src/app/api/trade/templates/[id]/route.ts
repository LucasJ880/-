import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { updateTemplate, deleteTemplate } from "@/lib/trade/templates";
import { loadTradeEmailTemplateForOrg, resolveTradeOrgId } from "@/lib/trade/access";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const { id } = await params;
  const loaded = await loadTradeEmailTemplateForOrg(id, orgRes.orgId);
  if (loaded instanceof NextResponse) return loaded;
  return NextResponse.json(loaded.template);
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
  const loaded = await loadTradeEmailTemplateForOrg(id, orgRes.orgId);
  if (loaded instanceof NextResponse) return loaded;

  const template = await updateTemplate(id, body);
  return NextResponse.json(template);
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
  const loaded = await loadTradeEmailTemplateForOrg(id, orgRes.orgId);
  if (loaded instanceof NextResponse) return loaded;

  await deleteTemplate(id);
  return NextResponse.json({ success: true });
}
