import { NextResponse, type NextRequest } from "next/server";
import { requireProjectReadAccess, requireProjectWriteAccess } from "@/lib/projects/access";
import { requireSupplierIntelAccess } from "@/lib/supplier-intel/access";
import { mapSupplierIntelError } from "@/lib/supplier-intel/http";
import { resolveSignalProjectScope } from "@/lib/supplier-intel/signal-scope";
import {
  getSignal,
  linkSignalToSupplier,
  rejectSignal,
  reviewSignal,
} from "@/lib/supplier-intel/signal-service";

type Ctx = { params: Promise<{ id: string }> };

/**
 * R1（Trust-Boundary Closure）：单条读取/写入按**有效项目归属**收口。
 * 顺序不变量：flag → 租户 → 归属解析（只读 projectId/tenderId/searchRunId 元数据，
 * 不返回正文）→ canonical 项目门（read / write 按操作区分）→ org 交叉校验 → 服务层再断言。
 * signal.projectId 为空但挂在项目绑定 Run 上的信号继承 Run 归属，不是组织公共线索。
 */

export async function GET(request: NextRequest, ctx: Ctx) {
  const tenant = await requireSupplierIntelAccess(request);
  if (tenant instanceof NextResponse) return tenant;

  const { id } = await ctx.params;
  const actor = { orgId: tenant.orgId, userId: tenant.userId };
  try {
    const scope = await resolveSignalProjectScope(actor, id);
    for (const projectId of scope.projectIds) {
      const access = await requireProjectReadAccess(request, projectId);
      if (access instanceof NextResponse) return access;
      if (access.project.orgId !== tenant.orgId) {
        return NextResponse.json({ error: "发现信号不存在" }, { status: 404 });
      }
    }
    const signal = await getSignal(actor, id);
    if (!signal) return NextResponse.json({ error: "发现信号不存在" }, { status: 404 });
    return NextResponse.json({ signal });
  } catch (err) {
    const mapped = mapSupplierIntelError(err);
    if (mapped) return mapped;
    throw err;
  }
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const tenant = await requireSupplierIntelAccess(request);
  if (tenant instanceof NextResponse) return tenant;

  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = typeof body?.action === "string" ? body.action : null;

  const actor = { orgId: tenant.orgId, userId: tenant.userId };
  try {
    // review / reject / link 都会改状态与关联 → 写门必须先于任何业务写入
    const scope = await resolveSignalProjectScope(actor, id);
    for (const projectId of scope.projectIds) {
      const access = await requireProjectWriteAccess(request, projectId);
      if (access instanceof NextResponse) return access;
      if (access.project.orgId !== tenant.orgId) {
        return NextResponse.json({ error: "发现信号不存在" }, { status: 404 });
      }
    }

    if (action === "review") {
      return NextResponse.json({ signal: await reviewSignal(actor, id) });
    }
    if (action === "reject") {
      return NextResponse.json({ signal: await rejectSignal(actor, id) });
    }
    if (action === "link") {
      const supplierId = typeof body?.supplierId === "string" ? body.supplierId : "";
      const note = typeof body?.note === "string" ? body.note : null;
      return NextResponse.json({
        signal: await linkSignalToSupplier(actor, id, { supplierId, note }),
      });
    }
    return NextResponse.json(
      { error: "action 必须是 review | link | reject" },
      { status: 400 },
    );
  } catch (err) {
    const mapped = mapSupplierIntelError(err);
    if (mapped) return mapped;
    throw err;
  }
}
