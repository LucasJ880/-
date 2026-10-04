import { NextResponse, type NextRequest } from "next/server";
import { requireProjectReadAccess, requireProjectWriteAccess } from "@/lib/projects/access";
import { requireSupplierIntelAccess } from "@/lib/supplier-intel/access";
import {
  createProjectEvaluationRun,
  listCommercialEvidenceOptions,
  listProjectEvaluationRuns,
} from "@/lib/supplier-intel/evaluation-run-service";
import { mapSupplierIntelError } from "@/lib/supplier-intel/http";

type Ctx = { params: Promise<{ projectId: string }> };

/**
 * S4-A：评估运行（EVALUATION_ONLY）。
 *
 * POST 只接受三个指针：supplierId / offeringId / sourceDiscoveryRunId。
 * requirements、mandatory、evaluationVersion、scoreVersion、originSource、requirementRefId
 * 一律服务端推导——请求体里带了也不会被读。
 * 顺序：flag → 租户 → canonical 项目写权限 → 服务端 canonical 需求读取（fail closed）→ 建 Run。
 * 评估运行不外呼任何 provider。
 */
export async function POST(request: NextRequest, ctx: Ctx) {
  const tenant = await requireSupplierIntelAccess(request);
  if (tenant instanceof NextResponse) return tenant;
  const { projectId } = await ctx.params;
  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  if (access.project.orgId !== tenant.orgId) return NextResponse.json({ error: "项目不存在" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  const actor = { orgId: tenant.orgId, userId: tenant.userId };
  try {
    const { run, candidate } = await createProjectEvaluationRun(actor, {
      projectId,
      supplierId: typeof body.supplierId === "string" ? body.supplierId : "",
      offeringId: typeof body.offeringId === "string" ? body.offeringId : null,
      sourceDiscoveryRunId: typeof body.sourceDiscoveryRunId === "string" ? body.sourceDiscoveryRunId : null,
      // FR1：只是一个指针；是否有效由服务端重验（同项目 / 同供应商 / 已确认），通过才冻结
      commercialInquiryItemId: typeof body.commercialInquiryItemId === "string" ? body.commercialInquiryItemId : null,
    });
    return NextResponse.json({ run: { id: run.id, status: run.status }, candidate: { id: candidate.id } }, { status: 201 });
  } catch (err) {
    const mapped = mapSupplierIntelError(err);
    if (mapped) return mapped;
    throw err;
  }
}

/** 本项目的评估运行列表（?supplierId= 可选过滤）；先项目读权限 */
export async function GET(request: NextRequest, ctx: Ctx) {
  const tenant = await requireSupplierIntelAccess(request);
  if (tenant instanceof NextResponse) return tenant;
  const { projectId } = await ctx.params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  if (access.project.orgId !== tenant.orgId) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  const url = new URL(request.url);
  try {
    const actor = { orgId: tenant.orgId, userId: tenant.userId };
    const supplierId = url.searchParams.get("supplierId");
    const runs = await listProjectEvaluationRuns(actor, projectId, { supplierId });
    // FR1：给「开始评估」的绑定选择器——本项目里这家供应商的已确认报价（服务端算，客户端只能选）
    const commercialEvidenceOptions = supplierId ? await listCommercialEvidenceOptions(actor, projectId, supplierId) : [];
    return NextResponse.json({ runs, commercialEvidenceOptions });
  } catch (err) {
    const mapped = mapSupplierIntelError(err);
    if (mapped) return mapped;
    throw err;
  }
}
