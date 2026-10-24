import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireTenantContext } from "@/lib/tenancy";
import {
  listPanelCodeViews,
  validatePanelCodeInput,
} from "@/lib/vinyl/panel-code-store";
import { canManageVinylPanelCodes } from "@/lib/vinyl/permissions";

/**
 * GET /api/vinyl/panel-codes
 * 返回内置默认表 + 本组织自定义码的合并视图。
 */
export async function GET(request: NextRequest) {
  const tenant = await requireTenantContext(request);
  if (tenant instanceof NextResponse) return tenant;

  const codes = await listPanelCodeViews(tenant.orgId);
  return NextResponse.json({
    codes,
    canEdit: canManageVinylPanelCodes(tenant.orgRole, tenant.isPlatformAdmin),
  });
}

/**
 * POST /api/vinyl/panel-codes —— 新增一条自定义码
 * 同组织下「码 + 尺寸」唯一；重复直接 409，不静默覆盖。
 */
export async function POST(request: NextRequest) {
  const tenant = await requireTenantContext(request);
  if (tenant instanceof NextResponse) return tenant;

  if (!canManageVinylPanelCodes(tenant.orgRole, tenant.isPlatformAdmin)) {
    return NextResponse.json({ error: "无权维护开启状态编码表" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = validatePanelCodeInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const dup = await db.vinylPanelCode.findFirst({
    where: {
      orgId: tenant.orgId,
      code: parsed.value.code,
      louverSize: parsed.value.louverSize,
    },
    select: { id: true },
  });
  if (dup) {
    return NextResponse.json(
      { error: `编码 ${parsed.value.code}（${parsed.value.louverSize ?? "通用"}）已存在，请直接修改它` },
      { status: 409 },
    );
  }

  const created = await db.vinylPanelCode.create({
    data: { ...parsed.value, orgId: tenant.orgId, createdById: tenant.userId },
  });
  return NextResponse.json(created, { status: 201 });
}
