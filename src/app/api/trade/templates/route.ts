/**
 * GET /api/trade/templates — 列表
 * POST /api/trade/templates — 创建（或初始化默认模板）
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import {
  listTemplates,
  createTemplate,
  seedDefaultTemplates,
} from "@/lib/trade/templates";
import { resolveTradeOrgId } from "@/lib/trade/access";

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category") ?? undefined;

  const templates = await listTemplates(orgRes.orgId, category);

  if (templates.length === 0) {
    await seedDefaultTemplates(orgRes.orgId);
    const seeded = await listTemplates(orgRes.orgId, category);
    return NextResponse.json(seeded);
  }

  return NextResponse.json(templates);
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json();
  const orgRes = await resolveTradeOrgId(request, auth.user, { bodyOrgId: body.orgId });
  if (!orgRes.ok) return orgRes.response;

  if (body.action === "seed") {
    const result = await seedDefaultTemplates(orgRes.orgId);
    return NextResponse.json(result);
  }

  if (!body.name || !body.subject || !body.body || !body.category) {
    return NextResponse.json(
      { error: "name, category, subject, body 必填" },
      { status: 400 },
    );
  }

  const template = await createTemplate({
    orgId: orgRes.orgId,
    name: body.name,
    category: body.category,
    language: body.language ?? "en",
    subject: body.subject,
    body: body.body,
    variables: body.variables,
    createdById: auth.user.id,
  });

  return NextResponse.json(template, { status: 201 });
}
