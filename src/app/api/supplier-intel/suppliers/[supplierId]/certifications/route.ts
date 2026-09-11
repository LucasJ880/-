import { NextResponse, type NextRequest } from "next/server";
import { requireSupplierIntelAccess } from "@/lib/supplier-intel/access";
import { createCertification } from "@/lib/supplier-intel/certification-service";
import { mapSupplierIntelError } from "@/lib/supplier-intel/http";
import { assertSupplierAccessForActor } from "@/lib/supplier-intel/supplier-capability-view";

type Ctx = { params: Promise<{ supplierId: string }> };

function parseDate(v: unknown): Date | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * 登记一条**声称的**资质。
 *
 * 这个入口永远只产出 CLAIMED：状态不接受客户端指定。想变 VERIFIED 必须走
 * PATCH 的 verify 动作，并提供独立证据（archive 档案项或官方登记库 URL）——
 * 服务层 fail-closed 强制，不是前端约定。
 */
export async function POST(request: NextRequest, ctx: Ctx) {
  const tenant = await requireSupplierIntelAccess(request);
  if (tenant instanceof NextResponse) return tenant;

  const { supplierId } = await ctx.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });

  const actor = { orgId: tenant.orgId, userId: tenant.userId };
  try {
    await assertSupplierAccessForActor(actor, supplierId);
    const cert = await createCertification(actor, {
      supplierId,
      offeringId: typeof body.offeringId === "string" ? body.offeringId : null,
      scope: typeof body.scope === "string" ? body.scope : "",
      certificationType: typeof body.certificationType === "string" ? body.certificationType : "",
      certificateNumber: typeof body.certificateNumber === "string" ? body.certificateNumber : null,
      issuer: typeof body.issuer === "string" ? body.issuer : null,
      validFrom: parseDate(body.validFrom),
      expiresAt: parseDate(body.expiresAt),
      sourceKind: typeof body.sourceKind === "string" ? body.sourceKind : "USER_ENTRY",
      sourceUrl: typeof body.sourceUrl === "string" ? body.sourceUrl : null,
      sourceSignalId: typeof body.sourceSignalId === "string" ? body.sourceSignalId : null,
      // 建档入口不接受 archive 证据：证据只在 verify 时提交，避免「建档即已核验」的错觉
      archiveItemId: null,
      verificationNote: typeof body.verificationNote === "string" ? body.verificationNote : null,
    });
    return NextResponse.json({ certification: cert }, { status: 201 });
  } catch (err) {
    const mapped = mapSupplierIntelError(err);
    if (mapped) return mapped;
    throw err;
  }
}
