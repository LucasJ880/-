import { NextResponse, type NextRequest } from "next/server";
import { requireSupplierIntelAccess } from "@/lib/supplier-intel/access";
import { SupplierIntelError } from "@/lib/supplier-intel/errors";
import {
  getSignal,
  linkSignalToSupplier,
  rejectSignal,
  reviewSignal,
} from "@/lib/supplier-intel/signal-service";

type Ctx = { params: Promise<{ id: string }> };

function mapDomainError(err: unknown): NextResponse | null {
  if (err instanceof SupplierIntelError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.httpStatus });
  }
  return null;
}

export async function GET(request: NextRequest, ctx: Ctx) {
  const tenant = await requireSupplierIntelAccess(request);
  if (tenant instanceof NextResponse) return tenant;

  const { id } = await ctx.params;
  const signal = await getSignal({ orgId: tenant.orgId, userId: tenant.userId }, id);
  if (!signal) return NextResponse.json({ error: "发现信号不存在" }, { status: 404 });
  return NextResponse.json({ signal });
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const tenant = await requireSupplierIntelAccess(request);
  if (tenant instanceof NextResponse) return tenant;

  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = typeof body?.action === "string" ? body.action : null;

  const actor = { orgId: tenant.orgId, userId: tenant.userId };
  try {
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
    const mapped = mapDomainError(err);
    if (mapped) return mapped;
    throw err;
  }
}
