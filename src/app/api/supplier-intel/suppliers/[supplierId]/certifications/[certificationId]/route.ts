import { NextResponse, type NextRequest } from "next/server";
import { requireSupplierIntelAccess } from "@/lib/supplier-intel/access";
import {
  updateCertificationStatus,
  verifyCertification,
} from "@/lib/supplier-intel/certification-service";
import { db } from "@/lib/db";
import { assertProjectAccessForActor } from "@/lib/supplier-intel/access";
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
    // 资质必须属于 URL 里这家供应商——防止借 A 的页面去核验 / 驳回 B 的资质
    const owned = await db.supplierCertification.findFirst({
      where: { id: certificationId, orgId: actor.orgId, supplierId },
      select: { id: true },
    });
    if (!owned) return NextResponse.json({ error: "认证记录不存在" }, { status: 404 });

    if (action === "verify") {
      const archiveItemId = typeof body?.archiveItemId === "string" ? body.archiveItemId.trim() : "";
      // 档案是项目级证据：拿你看不见的项目里的档案来核验，等于借用你无权读取的材料。
      // 服务层只校验 org 归属；这里补上与能力证据一致的项目门（不存在与无权一律同一响应）。
      if (archiveItemId) {
        const item = await db.tenderArchiveItem.findFirst({
          where: { id: archiveItemId, orgId: actor.orgId },
          select: { projectId: true },
        });
        if (!item) {
          return NextResponse.json(
            { error: "证据档案不存在", code: "ARCHIVE_EVIDENCE_NOT_FOUND" },
            { status: 422 },
          );
        }
        try {
          await assertProjectAccessForActor(actor, item.projectId, "read");
        } catch {
          return NextResponse.json(
            { error: "证据档案不存在", code: "ARCHIVE_EVIDENCE_NOT_FOUND" },
            { status: 422 },
          );
        }
      }
      const cert = await verifyCertification(actor, certificationId, {
        archiveItemId: archiveItemId || null,
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
