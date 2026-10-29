/**
 * GET / PUT /api/install/warranty-settings?orgId
 * INSTALL-2c：组织质保设置（Organization.settingsJson.sunnyWarranty）。
 * - 读：当前企业 ORG 范围持 accounting.read / install.balance.confirm / sales.settings.manage 任一；返回 canEdit
 * - 写：sales.settings.manage（老板）；整份校验（年限 0–50 整数、部件四种、邮箱 / 网址）；只替换 sunnyWarranty 键；记审计
 * 从未保存 = 种子（报价单口径）。
 */
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { holdsOrgPermissions } from "@/lib/accounting/access";
import type { AuthUser } from "@/lib/auth";
import { readWarrantySettings, validateWarrantySettings, withWarrantySettings } from "@/lib/install/warranty";

const AUDIT_ACTION = "install.warranty.settings";
const READ_KEYS = ["accounting.read", "install.balance.confirm", "sales.settings.manage"];
const EDIT_KEY = "sales.settings.manage";

async function canRead(user: AuthUser, orgId: string): Promise<boolean> {
  for (const k of READ_KEYS) if (await holdsOrgPermissions(user, orgId, [k])) return true;
  return false;
}

export const GET = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveRequestOrgIdForUser(user, request.nextUrl.searchParams.get("orgId"));
  if (!orgRes.ok) return orgRes.response;
  if (!(await canRead(user, orgRes.orgId))) return NextResponse.json({ error: "无权查看质保设置" }, { status: 403 });
  const org = await db.organization.findUnique({ where: { id: orgRes.orgId }, select: { settingsJson: true } });
  if (!org) return NextResponse.json({ error: "组织不存在" }, { status: 404 });
  const { settings, saved } = readWarrantySettings(org.settingsJson);
  return NextResponse.json({ orgId: orgRes.orgId, canEdit: await holdsOrgPermissions(user, orgRes.orgId, [EDIT_KEY]), saved, settings });
});

export const PUT = withAuth(async (request, _ctx, user) => {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "需要 JSON 请求体" }, { status: 400 });
  }
  const orgRes = await resolveRequestOrgIdForUser(user, typeof body.orgId === "string" ? body.orgId : request.nextUrl.searchParams.get("orgId"));
  if (!orgRes.ok) return orgRes.response;
  if (!(await holdsOrgPermissions(user, orgRes.orgId, [EDIT_KEY]))) {
    return NextResponse.json({ error: "只有老板可以修改质保设置" }, { status: 403 });
  }
  const v = validateWarrantySettings(body.settings);
  if (!v.ok) return NextResponse.json({ error: v.errors.join("；"), errors: v.errors }, { status: 400 });
  const saved = await db.$transaction(async (tx) => {
    // 行锁：settingsJson 整对象读改写，防止与其它设置并发保存互相覆盖
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${orgRes.orgId} FOR UPDATE`;
    const org = await tx.organization.findUnique({ where: { id: orgRes.orgId }, select: { settingsJson: true } });
    if (!org) return null;
    const before = readWarrantySettings(org.settingsJson);
    await tx.organization.update({
      where: { id: orgRes.orgId },
      data: { settingsJson: withWarrantySettings(org.settingsJson, v.settings) as Prisma.InputJsonValue },
    });
    await tx.auditLog.create({
      data: {
        userId: user.id,
        orgId: orgRes.orgId,
        action: AUDIT_ACTION,
        targetType: "organization",
        targetId: orgRes.orgId,
        beforeData: JSON.stringify({ saved: before.saved, settings: before.settings }),
        afterData: JSON.stringify(v.settings),
      },
    });
    return v.settings;
  });
  if (!saved) return NextResponse.json({ error: "组织不存在" }, { status: 404 });
  return NextResponse.json({ orgId: orgRes.orgId, canEdit: true, saved: true, settings: saved });
});
