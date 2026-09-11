import { NextResponse, type NextRequest } from "next/server";
import { requireSupplierIntelAccess } from "@/lib/supplier-intel/access";
import {
  updateCertificationStatus,
  verifyCertification,
} from "@/lib/supplier-intel/certification-service";
import { mapSupplierIntelError } from "@/lib/supplier-intel/http";
import { assertSupplierAccessForActor } from "@/lib/supplier-intel/supplier-capability-view";

type Ctx = { params: Promise<{ supplierId: string; certificationId: string }> };

/** 人工可执行的资质动作。VERIFIED 不在这里凭一个状态字符串直接写入。 */
const ACTIONS = ["verify", "reject", "expire"] as const;

/**
 * verify：必须带独立证据（archiveItemId 或官方登记库 sourceUrl），
 *         否则 certification-service 直接拒绝（CERT_VERIFY_REQUIRES_EVIDENCE）。
 * reject / expire：人工裁决，不需要证据，但同样走状态机校验。
 */
export async function PATCH(request: NextRequest, ctx: Ctx) {
  const tenant = await requireSupplierIntelAccess(request);
  if (tenant instanceof NextResponse) return tenant;

  const { supplierId, certificationId } = await ctx.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = typeof body?.action === "string" ? body.action : "";
  if (!(ACTIONS as readonly string[]).includes(action)) {
    return NextResponse.json({ error: `action 只支持 ${ACTIONS.join(" / ")}` }, { status: 400 });
  }

  const actor = { orgId: tenant.orgId, userId: tenant.userId };
  try {
    await assertSupplierAccessForActor(actor, supplierId);
    if (action === "verify") {
      const cert = await verifyCertification(actor, certificationId, {
        archiveItemId: typeof body?.archiveItemId === "string" ? body.archiveItemId : null,
        sourceUrl: typeof body?.sourceUrl === "string" ? body.sourceUrl : null,
        note: typeof body?.note === "string" ? body.note : null,
      });
      return NextResponse.json({ certification: cert });
    }
    const cert = await updateCertificationStatus(
      actor,
      certificationId,
      action === "reject" ? "REJECTED" : "EXPIRED",
      typeof body?.note === "string" ? body.note : null,
    );
    return NextResponse.json({ certification: cert });
  } catch (err) {
    const mapped = mapSupplierIntelError(err);
    if (mapped) return mapped;
    throw err;
  }
}
