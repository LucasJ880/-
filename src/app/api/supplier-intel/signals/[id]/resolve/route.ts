import { NextResponse, type NextRequest } from "next/server";
import { requireSupplierIntelAccess } from "@/lib/supplier-intel/access";
import { resolveSignalEntity } from "@/lib/supplier-intel/entity-resolution";
import { mapSupplierIntelError } from "@/lib/supplier-intel/http";

type Ctx = { params: Promise<{ id: string }> };

/** 实体解析预填：只算不动状态；LINKED 仍由人工在 signals/[id] PATCH link 完成 */
export async function POST(request: NextRequest, ctx: Ctx) {
  const tenant = await requireSupplierIntelAccess(request);
  if (tenant instanceof NextResponse) return tenant;

  const { id } = await ctx.params;
  try {
    const result = await resolveSignalEntity({ orgId: tenant.orgId, userId: tenant.userId }, id);
    return NextResponse.json({ result });
  } catch (err) {
    const mapped = mapSupplierIntelError(err);
    if (mapped) return mapped;
    throw err;
  }
}
