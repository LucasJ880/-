import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { validateAdminInviteOrgBinding } from "@/lib/organizations/onboarding-rules";
import { findBindableOrg } from "@/lib/organizations/invite-org-binding";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const auth = await requireSuperAdmin(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await ctx.params;
  const body = await request.json();

  const data: Record<string, unknown> = {};
  if (body.isActive !== undefined) data.isActive = body.isActive;
  if (body.label !== undefined) data.label = body.label?.trim() || null;
  if (body.maxUses !== undefined) data.maxUses = body.maxUses;
  if (body.expiresAt !== undefined) {
    data.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
  }

  // USR-1：补绑 / 改绑 / 解绑企业（orgId: null 解绑并清空 orgRole）。只影响以后的注册，已注册的人不动。
  if (body.orgId !== undefined || body.orgRole !== undefined) {
    const current = await db.inviteCode.findUnique({
      where: { id },
      select: { role: true, orgId: true, orgRole: true },
    });
    if (!current) {
      return NextResponse.json({ error: "邀请码不存在" }, { status: 404 });
    }
    const nextOrgId = body.orgId !== undefined ? body.orgId : current.orgId;
    const nextOrgRole = body.orgRole !== undefined ? body.orgRole : body.orgId !== undefined ? undefined : current.orgRole;
    const binding = validateAdminInviteOrgBinding({ role: current.role, orgId: nextOrgId, orgRole: nextOrgRole });
    if (!binding.ok) {
      return NextResponse.json({ error: binding.error }, { status: 400 });
    }
    const boundOrg = binding.orgId ? await findBindableOrg(binding.orgId) : null;
    if (binding.orgId && !boundOrg) {
      return NextResponse.json({ error: "企业不存在或已停用" }, { status: 400 });
    }
    data.orgId = binding.orgId;
    data.orgRole = binding.orgRole;
    // 公司 logo 跟随企业：补绑 / 改绑时按该企业关联的公司写入；解绑不动
    if (boundOrg) data.companyIdsJson = boundOrg.companyId ? JSON.stringify([boundOrg.companyId]) : null;
  }

  try {
    const updated = await db.inviteCode.update({
      where: { id },
      data,
    });
    return NextResponse.json({ inviteCode: updated });
  } catch {
    return NextResponse.json({ error: "邀请码不存在" }, { status: 404 });
  }
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const auth = await requireSuperAdmin(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await ctx.params;

  try {
    await db.inviteCode.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "邀请码不存在" }, { status: 404 });
  }
}
