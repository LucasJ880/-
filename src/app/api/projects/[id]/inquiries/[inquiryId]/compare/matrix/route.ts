/**
 * GET /api/projects/[id]/inquiries/[inquiryId]/compare/matrix（项目读权限）
 *
 * 落地价比价矩阵（P1-6）：代码算的落地价（CAD，到目的地含税）+ 合规检查 + 推荐 + 一句话结论。
 * 不调 LLM；不改 isSelected（推荐只是建议，选定仍由人点）。
 */

import { NextRequest, NextResponse } from "next/server";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { loadCompareMatrix } from "@/lib/tender-rfq/compare-service";

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
  return NextResponse.json({ matrix: r.matrix, inquiryId: r.inquiryId, roundNumber: r.roundNumber });
}
