/**
 * /api/organizations/[orgId]/muse-bindings
 *   GET   列出绑定（org_admin）
 *   POST  { museUserRef, userId }       绑定（org_admin）
 *   DELETE { museUserRef }              解绑（org_admin）
 *
 * 登录态 + org_admin；绑定目标必须是该 org 的 active 成员（binding.ts 再校验一次）。
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireOrgRole } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit/logger";
import { readMuseBindings, setMuseBinding } from "@/lib/muse-bridge/binding";

type Params = { params: Promise<{ orgId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { orgId } = await params;
  const auth = await requireOrgRole(request, orgId, "org_admin");
  if (auth instanceof NextResponse) return auth;
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { settingsJson: true } });
  if (!org) return NextResponse.json({ error: "组织不存在" }, { status: 404 });
  const bindings = readMuseBindings(org.settingsJson);
  return NextResponse.json({
    bindings: Object.entries(bindings).map(([museUserRef, b]) => ({ museUserRef, ...b })),
  });
}

export async function POST(request: NextRequest, { params }: Params) {
  const { orgId } = await params;
  const auth = await requireOrgRole(request, orgId, "org_admin");
  if (auth instanceof NextResponse) return auth;

  const body = (await request.json().catch(() => null)) as { museUserRef?: unknown; userId?: unknown } | null;
  const museUserRef = typeof body?.museUserRef === "string" ? body.museUserRef.trim() : "";
  const userId = typeof body?.userId === "string" ? body.userId.trim() : "";
  if (!museUserRef || museUserRef.length > 200 || !userId) {
    return NextResponse.json({ error: "museUserRef 与 userId 必填" }, { status: 400 });
  }

  const result = await setMuseBinding({ orgId, museUserRef, userId, actorUserId: auth.user.id });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  await logAudit({
    userId: auth.user.id,
    orgId,
    action: "muse:bind",
    targetType: "muse_binding",
    targetId: museUserRef,
    afterData: { userId },
    request,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { orgId } = await params;
  const auth = await requireOrgRole(request, orgId, "org_admin");
  if (auth instanceof NextResponse) return auth;

  const body = (await request.json().catch(() => null)) as { museUserRef?: unknown } | null;
  const museUserRef = typeof body?.museUserRef === "string" ? body.museUserRef.trim() : "";
  if (!museUserRef) return NextResponse.json({ error: "museUserRef 必填" }, { status: 400 });

  const result = await setMuseBinding({ orgId, museUserRef, userId: null, actorUserId: auth.user.id });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  await logAudit({ userId: auth.user.id, orgId, action: "muse:unbind", targetType: "muse_binding", targetId: museUserRef, request });
  return NextResponse.json({ ok: true });
}
