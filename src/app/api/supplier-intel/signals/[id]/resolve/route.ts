import { NextResponse, type NextRequest } from "next/server";
import { requireProjectWriteAccess } from "@/lib/projects/access";
import { requireSupplierIntelAccess } from "@/lib/supplier-intel/access";
import { resolveSignalEntity } from "@/lib/supplier-intel/entity-resolution";
import { mapSupplierIntelError } from "@/lib/supplier-intel/http";
import { resolveSignalProjectScope } from "@/lib/supplier-intel/signal-scope";

type Ctx = { params: Promise<{ id: string }> };

/**
 * 实体解析预填：只算不动状态；LINKED 仍由人工在 signals/[id] PATCH link 完成。
 *
 * R1：预填会 append resolutionJson，属**写**操作，按有效项目归属过 canonical 写门
 *（不是无副作用读取）。身份宇宙扫描仍是 org 全量——项目可见性不得裁剪身份裁决，
 * 详见 entity-resolution.ts 的 R1 不变量注释。
 */
export async function POST(request: NextRequest, ctx: Ctx) {
  const tenant = await requireSupplierIntelAccess(request);
  if (tenant instanceof NextResponse) return tenant;

  const { id } = await ctx.params;
  const actor = { orgId: tenant.orgId, userId: tenant.userId };
  try {
    const scope = await resolveSignalProjectScope(actor, id);
    for (const projectId of scope.projectIds) {
      const access = await requireProjectWriteAccess(request, projectId);
      if (access instanceof NextResponse) return access;
      if (access.project.orgId !== tenant.orgId) {
        return NextResponse.json({ error: "发现信号不存在" }, { status: 404 });
      }
    }
    const result = await resolveSignalEntity(actor, id);
    return NextResponse.json({ result });
  } catch (err) {
    const mapped = mapSupplierIntelError(err);
    if (mapped) return mapped;
    throw err;
  }
}
