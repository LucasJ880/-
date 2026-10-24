import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireTenantContext } from "@/lib/tenancy";
import { validatePanelCodeInput } from "@/lib/vinyl/panel-code-store";
import { canManageVinylPanelCodes } from "@/lib/vinyl/permissions";

type Ctx = { params: Promise<{ id: string }> };

/** 只允许操作本组织的记录——用 orgId 一起筛，不靠 id 猜 */
async function findOwned(orgId: string, id: string) {
  return db.vinylPanelCode.findFirst({ where: { id, orgId }, select: { id: true } });
}

export async function PUT(request: NextRequest, ctx: Ctx) {
  const tenant = await requireTenantContext(request);
  if (tenant instanceof NextResponse) return tenant;
  if (!canManageVinylPanelCodes(tenant.orgRole, tenant.isPlatformAdmin)) {
    return NextResponse.json({ error: "无权维护开启状态编码表" }, { status: 403 });
  }

  const { id } = await ctx.params;
  if (!(await findOwned(tenant.orgId, id))) {
    return NextResponse.json({ error: "编码不存在" }, { status: 404 });
  }

  const parsed = validatePanelCodeInput(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const clash = await db.vinylPanelCode.findFirst({
    where: {
      orgId: tenant.orgId,
      code: parsed.value.code,
      louverSize: parsed.value.louverSize,
      NOT: { id },
    },
    select: { id: true },
  });
  if (clash) {
    return NextResponse.json(
      { error: `编码 ${parsed.value.code}（${parsed.value.louverSize ?? "通用"}）已被另一条占用` },
      { status: 409 },
    );
  }

  const updated = await db.vinylPanelCode.update({ where: { id }, data: parsed.value });
  return NextResponse.json(updated);
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const tenant = await requireTenantContext(request);
  if (tenant instanceof NextResponse) return tenant;
  if (!canManageVinylPanelCodes(tenant.orgRole, tenant.isPlatformAdmin)) {
    return NextResponse.json({ error: "无权维护开启状态编码表" }, { status: 403 });
  }

  const { id } = await ctx.params;
  if (!(await findOwned(tenant.orgId, id))) {
    return NextResponse.json({ error: "编码不存在" }, { status: 404 });
  }

  // 删自定义项 = 回落到内置默认表（如果该码有内置项），不是"这个码从此消失"
  await db.vinylPanelCode.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
