/**
 * GET / PUT /api/trade/booth-cards/styles — 组织的款号参考表（款号 → 品类名）
 *
 * PUT JSON：{ orgId?, text }，text 为一行一个「款号, 品类名」；整表替换，发布为新版本。
 */

import { NextRequest, NextResponse } from "next/server";
import {
  resolveTradeOrgId,
  TRADE_MANAGE_KEYS,
  TRADE_READ_KEYS,
  requireTradePermission,
} from "@/lib/trade/access";
import {
  formatStyleReferenceText,
  loadStyleReferences,
  parseStyleReferenceText,
  saveStyleReferences,
} from "@/lib/trade/style-references";

export async function GET(request: NextRequest) {
  const auth = await requireTradePermission(request, TRADE_READ_KEYS);
  if (auth instanceof NextResponse) return auth;
  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const refs = await loadStyleReferences(orgRes.orgId);
  return NextResponse.json({ count: refs.length, refs, text: formatStyleReferenceText(refs) });
}

export async function PUT(request: NextRequest) {
  const auth = await requireTradePermission(request, TRADE_MANAGE_KEYS);
  if (auth instanceof NextResponse) return auth;
  const body = (await request.json().catch(() => null)) as { orgId?: unknown; text?: unknown } | null;
  if (!body || typeof body.text !== "string") {
    return NextResponse.json({ error: "缺少 text" }, { status: 400 });
  }
  const orgRes = await resolveTradeOrgId(request, auth.user, {
    bodyOrgId: typeof body.orgId === "string" ? body.orgId : null,
  });
  if (!orgRes.ok) return orgRes.response;

  const { refs, errors } = parseStyleReferenceText(body.text);
  if (errors.length) {
    return NextResponse.json({ error: errors[0], errors }, { status: 422 });
  }
  const { version } = await saveStyleReferences(orgRes.orgId, refs, auth.user.id);
  return NextResponse.json({ count: refs.length, version, text: formatStyleReferenceText(refs) });
}
