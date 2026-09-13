import { NextResponse, type NextRequest } from "next/server";
import { requireSupplierIntelAccess } from "@/lib/supplier-intel/access";
import { mapSupplierIntelError } from "@/lib/supplier-intel/http";
import { createCapabilitySignal } from "@/lib/supplier-intel/signal-service";
import { assertSupplierAccessForActor } from "@/lib/supplier-intel/supplier-capability-view";

type Ctx = { params: Promise<{ supplierId: string }> };

/**
 * 记录一条**能力声明**，必须挂在一条已归属到本供应商的线索上。
 *
 * 为什么强制要出处：能力是后面做强制项判定（S4 gate）的输入之一。
 * 一条没有出处的能力，到了「这家为什么算合规」的时候没人能回答。
 * 服务层还会拒绝 VERIFIED（social 写路径永远产不出 VERIFIED）。
 */
export async function POST(request: NextRequest, ctx: Ctx) {
  const tenant = await requireSupplierIntelAccess(request);
  if (tenant instanceof NextResponse) return tenant;

  const { supplierId } = await ctx.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });

  const discoverySignalId = typeof body.discoverySignalId === "string" ? body.discoverySignalId : "";
  if (!discoverySignalId) {
    return NextResponse.json({ error: "discoverySignalId 必填（能力声明必须有出处）" }, { status: 400 });
  }

  const actor = { orgId: tenant.orgId, userId: tenant.userId };
  try {
    await assertSupplierAccessForActor(actor, supplierId);

    // 出处必须是**本 org、且已归属到这家供应商**的线索——否则等于给 A 的能力挂 B 的证据
    const { db } = await import("@/lib/db");
    const source = await db.supplierDiscoverySignal.findFirst({
      where: {
        id: discoverySignalId,
        orgId: actor.orgId,
        linkedSupplierId: supplierId,
        status: "LINKED",
      },
      select: { id: true },
    });
    if (!source) {
      return NextResponse.json(
        { error: "出处线索不存在，或尚未归属到这家供应商", code: "SOURCE_SIGNAL_NOT_LINKED" },
        { status: 422 },
      );
    }

    const capability = await createCapabilitySignal(actor, {
      discoverySignalId,
      type: typeof body.type === "string" ? body.type : "",
      value: typeof body.value === "string" ? body.value : null,
      evidenceStatus: typeof body.evidenceStatus === "string" ? body.evidenceStatus : "CLAIMED",
      confidence: typeof body.confidence === "number" ? body.confidence : null,
      explanation: typeof body.explanation === "string" ? body.explanation : null,
      // 这个入口是人手录的；AI_ASSISTED 由抽取流程自己写，不由客户端声明
      extractedBy: "HUMAN",
    });
    return NextResponse.json({ capability }, { status: 201 });
  } catch (err) {
    const mapped = mapSupplierIntelError(err);
    if (mapped) return mapped;
    throw err;
  }
}
