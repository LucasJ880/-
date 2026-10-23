/**
 * POST /api/projects/[id]/inquiries/[inquiryId]/compare/analysis（项目读权限）
 *
 * P1-6：先用代码出落地价比价矩阵（compare-service），LLM 只拿矩阵写"解读"——
 * 不再把原始报价行交给 LLM 自己算。summary / recommendedSupplier 来自矩阵（代码），
 * priceAnalysis / deliveryAnalysis / risks / recommendation 来自 LLM 的解读。
 * 响应结构与 QuoteAnalysisPanel 兼容，另附 matrix。
 */

import { NextRequest, NextResponse } from "next/server";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { toPrismaHttpError } from "@/lib/inquiry/service";
import { createCompletion } from "@/lib/ai/client";
import { isAIConfigured } from "@/lib/ai/config";
import { loadCompareMatrix } from "@/lib/tender-rfq/compare-service";
import { buildMatrixInterpretationPrompt } from "@/lib/tender-rfq/compare";

type Params = { params: Promise<{ id: string; inquiryId: string }> };

type Interpretation = { priceAnalysis: string; deliveryAnalysis: string; risks: string; recommendation: string };

function readInterpretation(raw: string): Interpretation | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    return { priceAnalysis: str(o.priceAnalysis), deliveryAnalysis: str(o.deliveryAnalysis), risks: str(o.risks), recommendation: str(o.recommendation) };
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id: projectId, inquiryId } = await params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  if (!isAIConfigured()) {
    return NextResponse.json({ error: "AI 功能未配置" }, { status: 503 });
  }

  try {
    const r = await loadCompareMatrix({ projectId, inquiryId });
    if (!r.ok) {
      if (r.errorCode === "NO_QUOTES") {
        return NextResponse.json({ error: "暂无已报价的供应商，无法进行分析" }, { status: 400 });
      }
      return NextResponse.json({ error: "询价轮次不存在" }, { status: 404 });
    }

    const { matrix } = r;
    const prompt = buildMatrixInterpretationPrompt(matrix, { projectName: r.projectName, roundNumber: r.roundNumber, closeDate: r.closeDate });
    const raw = await createCompletion({ ...prompt, mode: "normal", temperature: 0.2, workflow: "tender_rfq_compare_interpret" });
    const interpretation = readInterpretation(raw);
    if (!interpretation) {
      // 解读失败不影响矩阵：数字与推荐都来自代码
      return NextResponse.json({ error: "AI 解读返回格式异常", matrix, raw }, { status: 502 });
    }

    const recommended = matrix.recommendedItemId ? matrix.rows.find((x) => x.itemId === matrix.recommendedItemId) : null;
    return NextResponse.json({
      analysis: {
        summary: matrix.summaryZh,
        recommendedSupplier: recommended?.supplierName ?? "",
        ...interpretation,
      },
      matrix,
      quotesCount: matrix.rows.length,
      generatedAt: matrix.generatedAt,
    });
  } catch (err) {
    const { msg, status } = toPrismaHttpError(err);
    return NextResponse.json({ error: msg }, { status });
  }
}
