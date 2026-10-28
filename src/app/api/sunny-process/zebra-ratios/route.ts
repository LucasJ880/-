import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";
import { getOrgMembership, type AuthUser } from "@/lib/auth";
import { authorize, humanPrincipal } from "@/lib/authorization";
import { hasOrgRole, isAdmin } from "@/lib/rbac/roles";
import { resolveSalesOrgIdForRequest } from "@/lib/sales/org-context";
import {
  AUDIT_ACTION_ZEBRA_RATIOS,
  MAX_ZEBRA_RATIO_ENTRIES,
  readZebraRatios,
  sanitizeZebraRatios,
  withZebraRatios,
} from "@/lib/sunny-process/zebra-ratios";

/**
 * GET /api/sunny-process/zebra-ratios —— 当前组织的斑马帘「面料编码 → 布:纱」对照表（没保存过时返回原件种子）
 * PUT /api/sunny-process/zebra-ratios —— 整表保存到 Organization.settingsJson.sunnyProcess.zebraRatios，记 AuditLog
 *
 * 组织按销售模块同一规则解析（activeOrgId；平台管理员须带 ?orgId=）。只影响之后生成 / 退回自产的工艺单，
 * 已生成的工艺单布纱比不回写。整表影响全组织之后所有斑马帘裁剪位 → 保存需出工艺单的人（出单岗位，
 * 持 orders.fulfillment.update）或 org_admin 及以上 / 平台管理员（2026-10-27 Lucas：权限给出工艺单的人），其余成员只读。
 * PERM-3 起出单键按品类拆分：斑马帘属 shades → 持 orders.fulfillment.update.shades（出单·Roller/Zebra/Roman）
 * 或全品类键 orders.fulfillment.update（老板）。
 */
async function canEditOrgTable(user: AuthUser, orgId: string): Promise<boolean> {
  if (isAdmin(user.role)) return true;
  const m = await getOrgMembership(user.id, orgId);
  if (!m || m.status !== "active") return false;
  if (hasOrgRole(m.role, "org_admin")) return true;
  for (const permission of ["orders.fulfillment.update.shades", "orders.fulfillment.update"]) {
    if ((await authorize({ principal: humanPrincipal(user, orgId), orgId, permission })).allowed) return true;
  }
  return false;
}

export const GET = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveSalesOrgIdForRequest(request, user);
  if (!orgRes.ok) return orgRes.response;
  const org = await db.organization.findUnique({ where: { id: orgRes.orgId }, select: { settingsJson: true } });
  if (!org) return NextResponse.json({ error: "组织不存在" }, { status: 404 });
  return NextResponse.json({ orgId: orgRes.orgId, canEdit: await canEditOrgTable(user, orgRes.orgId), ...readZebraRatios(org.settingsJson) });
});

export const PUT = withAuth(async (request, _ctx, user) => {
  const body = (await request.json().catch(() => null)) as { entries?: unknown; orgId?: unknown } | null;
  if (!body || !Array.isArray(body.entries)) return NextResponse.json({ error: "参数格式错误" }, { status: 400 });
  if (body.entries.length > MAX_ZEBRA_RATIO_ENTRIES) {
    return NextResponse.json({ error: `对照表最多 ${MAX_ZEBRA_RATIO_ENTRIES} 条` }, { status: 400 });
  }
  const orgRes = await resolveSalesOrgIdForRequest(request, user, { bodyOrgId: typeof body.orgId === "string" ? body.orgId : null });
  if (!orgRes.ok) return orgRes.response;
  if (!(await canEditOrgTable(user, orgRes.orgId))) {
    return NextResponse.json({ error: "需要出单岗位或组织管理员才能修改布纱比对照表" }, { status: 403 });
  }
  const entries = sanitizeZebraRatios(body.entries);
  const saved = await db.$transaction(async (tx) => {
    // 行锁：settingsJson 是整对象读改写，防止与其它设置并发保存互相覆盖
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${orgRes.orgId} FOR UPDATE`;
    const org = await tx.organization.findUnique({ where: { id: orgRes.orgId }, select: { settingsJson: true } });
    if (!org) return null;
    const before = readZebraRatios(org.settingsJson);
    await tx.organization.update({
      where: { id: orgRes.orgId },
      data: { settingsJson: withZebraRatios(org.settingsJson, entries) as Prisma.InputJsonValue },
    });
    await tx.auditLog.create({
      data: {
        userId: user.id,
        orgId: orgRes.orgId,
        action: AUDIT_ACTION_ZEBRA_RATIOS,
        targetType: "organization",
        targetId: orgRes.orgId,
        beforeData: JSON.stringify({ seeded: before.seeded, count: before.entries.length }),
        afterData: JSON.stringify(entries),
      },
    });
    return entries;
  });
  if (!saved) return NextResponse.json({ error: "组织不存在" }, { status: 404 });
  return NextResponse.json({ orgId: orgRes.orgId, canEdit: true, entries: saved, seeded: false, dropped: body.entries.length - saved.length });
});
