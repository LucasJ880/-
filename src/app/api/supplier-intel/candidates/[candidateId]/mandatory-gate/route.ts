import { NextResponse, type NextRequest } from "next/server";
import { requireSupplierIntelAccess } from "@/lib/supplier-intel/access";
import { requireCandidateProjectWrite } from "@/lib/supplier-intel/candidate-route-access";
import { computeCandidateMandatoryGate } from "@/lib/supplier-intel/evaluation-run-service";
import { mapSupplierIntelError } from "@/lib/supplier-intel/http";

type Ctx = { params: Promise<{ candidateId: string }> };

/** S4-A：计算候选的强制项硬门（事务 + Run 锁；终态 Run 拒绝重算）。无请求体。 */
export async function POST(request: NextRequest, ctx: Ctx) {
  const tenant = await requireSupplierIntelAccess(request);
  if (tenant instanceof NextResponse) return tenant;
  const { candidateId } = await ctx.params;
  const gate = await requireCandidateProjectWrite(request, tenant.orgId, candidateId);
  if (gate instanceof NextResponse) return gate;
  try {
    const outcome = await computeCandidateMandatoryGate({ orgId: tenant.orgId, userId: tenant.userId }, candidateId);
    return NextResponse.json({ gate: outcome.snapshot, recommendation: outcome.recommendation, rejectionReason: outcome.rejectionReason });
  } catch (err) {
    const mapped = mapSupplierIntelError(err);
    if (mapped) return mapped;
    throw err;
  }
}
