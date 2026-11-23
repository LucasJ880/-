/**
 * GET /api/projects/[id]/inquiries/[inquiryId]/compare/matrix（项目读权限）
 *
 * 落地价比价矩阵（P1-6）：代码算的落地价（CAD，到目的地，含关税，不含 GST/HST；DDP 以供应商报价为准）+ 合规检查 + 推荐 + 一句话结论。
 * 不调 LLM；不改 isSelected（推荐只是建议，选定仍由人点）。
 * CHAIN-2e：落地价只给对本项目有财务查看权的人（与成本核算同一判定）；没有的人拿到裁剪后的矩阵，响应带 costHidden
 * 与提示原因 hintReason（没有真人负责人 no_owner / 授权查询出错 unconfirmed；默认不带）。
 */

import { NextRequest, NextResponse } from "next/server";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { loadCompareMatrix } from "@/lib/tender-rfq/compare-service";
import { compareMatrixFinanceView } from "@/lib/tender-rfq/compare";
import { resolveFinanceHintReason, resolveFinanceViewSafe } from "@/lib/project-finance/access";
import { hintReasonField } from "@/lib/project-finance/view-hint";

type Params = { params: Promise<{ id: string; inquiryId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id: projectId, inquiryId } = await params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const r = await loadCompareMatrix({ projectId, inquiryId });
  if (!r.ok) {
    if (r.errorCode === "NO_QUOTES") {
      return NextResponse.json({ matrix: null, message: r.message, inquiryId: r.inquiryId, roundNumber: r.roundNumber });
    }
    return NextResponse.json({ error: r.errorCode === "NO_INQUIRY" ? "询价轮次不存在" : r.message }, { status: 404 });
  }
  const finance = await resolveFinanceViewSafe(access.user, access.project.orgId, access.project.ownerId);
  const matrix = compareMatrixFinanceView(r.matrix, { canView: finance.canReadAll, firstTierQty: r.firstTierQty });
  return NextResponse.json({ matrix, inquiryId: r.inquiryId, roundNumber: r.roundNumber, ...(matrix.costHidden ? { costHidden: true, ...hintReasonField(await resolveFinanceHintReason(finance, access.project.ownerId)) } : {}) });
}
