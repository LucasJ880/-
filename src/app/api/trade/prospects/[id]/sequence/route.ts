/**
 * GET /api/trade/prospects/[id]/sequence
 * POST /api/trade/prospects/[id]/sequence  { action: "ensure" }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { loadTradeProspectForOrg, resolveTradeOrgId } from "@/lib/trade/access";
import { ensureOutreachSequence, listOutreachSequence } from "@/lib/trade/outreach-sequence";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const { id } = await params;
  const loaded = await loadTradeProspectForOrg(id, orgRes.orgId);
  if (loaded instanceof NextResponse) return loaded;

  const steps = await listOutreachSequence(orgRes.orgId, id);
  return NextResponse.json({ steps });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveTradeOrgId(request, auth.user, { bodyOrgId: body.orgId });
  if (!orgRes.ok) return orgRes.response;

  const { id } = await params;
  const loaded = await loadTradeProspectForOrg(id, orgRes.orgId);
  if (loaded instanceof NextResponse) return loaded;

  const steps = await ensureOutreachSequence({ orgId: orgRes.orgId, prospectId: id });
  return NextResponse.json({ steps });
}
